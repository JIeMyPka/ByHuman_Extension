/**
 * ByHuman tweet interceptor — runs in the PAGE world (not the isolated world).
 *
 * Content scripts live in an isolated world; they can't see `window.fetch`
 * monkey-patches done in the page world, and X uses its own bundled fetch
 * for the GraphQL CreateTweet request. To observe successful publish events
 * we have to run inside the page itself.
 *
 * What we do:
 *   - patch `window.fetch` and `XMLHttpRequest`
 *   - watch for requests to a URL containing "/CreateTweet"
 *   - on a successful response, parse the GraphQL payload to extract
 *     `tweet_results.result.rest_id` (the tweet ID) and the
 *     `legacy.full_text` field (so the content script can confirm the
 *     just-published text matches the tracker's last seen text)
 *   - dispatch a `byhuman:tweet-posted` CustomEvent on `document` with
 *     `{ tweetId, text }` for the content script to consume.
 *
 * We do NOT send anything to a server from here. The content script in
 * the isolated world is responsible for calling /api/posts with the
 * receipt — it has access to extension permissions and credentials.
 */

(function () {
  if ((window as unknown as { __byhumanInterceptor?: boolean }).__byhumanInterceptor) return;
  (window as unknown as { __byhumanInterceptor?: boolean }).__byhumanInterceptor = true;

  const CREATE_TWEET_RE = /\/CreateTweet(\?|$|\/)/;

  function notify(detail: { tweetId: string; text: string }) {
    document.dispatchEvent(new CustomEvent("byhuman:tweet-posted", { detail }));
  }

  /**
   * Find the tweet result inside a GraphQL CreateTweet response.
   * X's response shape (subject to change):
   *   data.create_tweet.tweet_results.result.rest_id          -- "1837..."
   *   data.create_tweet.tweet_results.result.legacy.full_text -- "the tweet"
   * We walk defensively because the shape has shifted historically.
   */
  function extractTweet(payload: unknown): { tweetId: string; text: string } | null {
    if (!payload || typeof payload !== "object") return null;
    const obj = payload as Record<string, unknown>;
    const data = obj.data as Record<string, unknown> | undefined;
    if (!data) return null;

    // Most common: data.create_tweet.tweet_results.result
    const createTweet = data.create_tweet as Record<string, unknown> | undefined;
    const results = createTweet?.tweet_results as Record<string, unknown> | undefined;
    const result = results?.result as Record<string, unknown> | undefined;
    if (!result) return null;

    const tweetId =
      (typeof result.rest_id === "string" && result.rest_id) ||
      (typeof (result.legacy as Record<string, unknown> | undefined)?.id_str === "string" &&
        ((result.legacy as Record<string, unknown>).id_str as string));
    const legacy = result.legacy as Record<string, unknown> | undefined;
    const text =
      (typeof legacy?.full_text === "string" && legacy.full_text) ||
      (typeof result.full_text === "string" && (result.full_text as string)) ||
      "";

    if (!tweetId) return null;
    return { tweetId, text };
  }

  // ---- patch fetch -------------------------------------------------------
  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const isCreateTweet = typeof url === "string" && CREATE_TWEET_RE.test(url);

    const response = await origFetch(input, init);

    if (isCreateTweet && response.ok) {
      // Clone so we don't consume the body the page expects to read.
      const clone = response.clone();
      clone
        .json()
        .then((payload) => {
          const t = extractTweet(payload);
          if (t) notify(t);
        })
        .catch(() => {
          /* not JSON or already consumed — ignore */
        });
    }

    return response;
  };

  // ---- patch XHR (X mostly uses fetch, but some flows still use XHR) -----
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR(this: XMLHttpRequest) {
    const xhr = new OrigXHR();
    let watchedUrl: string | null = null;

    const origOpen = xhr.open.bind(xhr);
    (xhr as unknown as { open: typeof xhr.open }).open = function (
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      watchedUrl = typeof url === "string" ? url : url.href;
      // @ts-expect-error — rest passes async, user, password through
      return origOpen(method, url, ...rest);
    };

    xhr.addEventListener("load", () => {
      if (!watchedUrl || !CREATE_TWEET_RE.test(watchedUrl)) return;
      if (xhr.status < 200 || xhr.status >= 300) return;
      try {
        const payload = JSON.parse(xhr.responseText);
        const t = extractTweet(payload);
        if (t) notify(t);
      } catch {
        /* ignore */
      }
    });

    return xhr;
  }
  // Preserve prototype chain so `instanceof XMLHttpRequest` still works.
  PatchedXHR.prototype = OrigXHR.prototype;
  (window as unknown as { XMLHttpRequest: typeof OrigXHR }).XMLHttpRequest =
    PatchedXHR as unknown as typeof OrigXHR;
})();
