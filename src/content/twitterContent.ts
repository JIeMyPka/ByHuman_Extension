/**
 * ByHuman content script for X / Twitter.
 *
 * Architecture
 * ────────────
 *
 *   - ProvenanceTracker per composer: text changes flow through
 *     applyChange(newText, hint) — same as the web editor.
 *   - MutationObserver on the composer subtree is the primary trigger.
 *   - Side channels (paste / Ctrl-Z / Ctrl-Y) set the next change hint.
 *
 * Auto-saving receipts
 * ────────────────────
 *
 * The user does NOT click a "Save proof" button. Instead:
 *
 *   1. tweetInterceptor.ts is injected into the PAGE world. It patches
 *      window.fetch / XMLHttpRequest and watches for successful CreateTweet
 *      GraphQL calls. On success it dispatches a `byhuman:tweet-posted`
 *      CustomEvent containing { tweetId, text }.
 *   2. This file (isolated world) listens for that event. When it fires:
 *        - find the AttachedComposer whose tracker.snapshot().text equals
 *          the published text (or whose tracker has any text at all if
 *          there's exactly one composer — the common case)
 *        - POST /api/posts with the tracker's events + sessionStats and
 *          the receipt source set to "twitter"
 *        - reset the tracker so the next tweet starts fresh
 *
 * Privacy: the tweet text is NOT transmitted. Only a receipt (events,
 * stats, verdict) plus the tweet ID + URL. The server derives textHash
 * from the text it receives, which we still send so the server can verify
 * the hash matches — but the server stores only the hash for Twitter
 * receipts, never the text. See src/app/api/posts/route.ts.
 */

import { ProvenanceTracker, type ChangeHint } from "@core/tracker";
import { POSTS_URL } from "@shared/config";

// ── Inject the page-world interceptor ─────────────────────────────────────

(function inject() {
  // Path resolved by the build script — see extension/scripts/build.mjs
  const url = chrome.runtime.getURL("content/tweetInterceptor.js");
  const script = document.createElement("script");
  script.src = url;
  script.async = false;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
})();

// ── Composer detection ────────────────────────────────────────────────────

const COMPOSER_SELECTORS = [
  '[data-testid="tweetTextarea_0"]',
  '[data-testid^="tweetTextarea_"]',
  'div[role="textbox"][contenteditable="true"]',
];

interface AttachedComposer {
  composer: HTMLElement;
  indicator: HTMLDivElement;
  tracker: ProvenanceTracker | null;
  pendingHint: ChangeHint;
  /** last text we have already fed into the tracker; needed to skip no-ops */
  lastSeenText: string;
  startedAt: number;
  textObserver: MutationObserver | null;
  cleanup: () => void;
}

const attached: WeakMap<HTMLElement, AttachedComposer> = new WeakMap();
const attachedNodes: Set<HTMLElement> = new Set();

function findComposers(root: ParentNode): HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const selector of COMPOSER_SELECTORS) {
    const matches = root.querySelectorAll<HTMLElement>(selector);
    matches.forEach((el) => {
      if (el.getAttribute("contenteditable") !== "true") return;
      found.add(el);
    });
  }
  return [...found];
}

function readComposerText(composer: HTMLElement): string {
  const raw = composer.textContent ?? "";
  return raw.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
}

// ── Attach / detach ───────────────────────────────────────────────────────

function attachToComposer(composer: HTMLElement): void {
  if (attached.has(composer)) return;

  const indicator = createIndicator();
  document.body.appendChild(indicator);

  const state: AttachedComposer = {
    composer,
    indicator,
    tracker: null,
    pendingHint: "typed",
    lastSeenText: "",
    startedAt: 0,
    textObserver: null,
    cleanup: () => {},
  };

  const reposition = () => positionIndicator(indicator, composer);
  reposition();
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);

  let userInteracted = false;
  const startIfNeeded = () => {
    if (state.tracker) return;
    if (!userInteracted) return;
    const initial = readComposerText(composer);
    state.tracker = new ProvenanceTracker(initial);
    state.lastSeenText = initial;
    state.startedAt = Date.now();
    setIndicatorActive(indicator, true);
    renderStats(indicator, state.tracker.snapshot());
  };

  const markInteracted = () => {
    userInteracted = true;
    startIfNeeded();
  };

  const syncTextToTracker = () => {
    if (!state.tracker) return;
    const next = readComposerText(composer);
    if (next === state.lastSeenText) return;
    const hint = state.pendingHint;
    state.pendingHint = "typed";
    state.tracker.applyChange(next, hint);
    state.lastSeenText = next;
    renderStats(indicator, state.tracker.snapshot());
  };

  const onPaste = (ev: ClipboardEvent) => {
    markInteracted();
    if (ev.clipboardData) state.pendingHint = "pasted";
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key.length === 0) return;
    markInteracted();
    const isCtrl = ev.ctrlKey || ev.metaKey;
    if (!isCtrl) return;
    const k = ev.key.toLowerCase();
    if (k === "z" && !ev.shiftKey) state.pendingHint = "undo";
    else if ((k === "z" && ev.shiftKey) || k === "y") state.pendingHint = "redo";
  };

  const onPointerDown = () => markInteracted();
  const onInput = () => {
    markInteracted();
    queueMicrotask(syncTextToTracker);
  };

  composer.addEventListener("paste", onPaste);
  composer.addEventListener("keydown", onKeyDown);
  composer.addEventListener("pointerdown", onPointerDown);
  composer.addEventListener("input", onInput);

  const textObserver = new MutationObserver(() => {
    if (!userInteracted) return;
    queueMicrotask(syncTextToTracker);
  });
  textObserver.observe(composer, { characterData: true, childList: true, subtree: true });
  state.textObserver = textObserver;

  state.cleanup = () => {
    composer.removeEventListener("paste", onPaste);
    composer.removeEventListener("keydown", onKeyDown);
    composer.removeEventListener("pointerdown", onPointerDown);
    composer.removeEventListener("input", onInput);
    state.textObserver?.disconnect();
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    indicator.remove();
  };

  attached.set(composer, state);
  attachedNodes.add(composer);
}

function detachComposer(composer: HTMLElement): void {
  const state = attached.get(composer);
  if (!state) return;
  state.cleanup();
  attached.delete(composer);
  attachedNodes.delete(composer);
}

// ── Indicator UI ──────────────────────────────────────────────────────────

function createIndicator(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "byhuman-indicator";
  el.setAttribute("data-byhuman", "indicator");
  Object.assign(el.style, {
    position: "fixed",
    zIndex: "2147483646",
    minWidth: "210px",
    maxWidth: "270px",
    padding: "8px 10px",
    background: "rgba(15, 23, 42, 0.92)",
    color: "#f8fafc",
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontSize: "11px",
    lineHeight: "1.4",
    borderRadius: "10px",
    boxShadow: "0 4px 14px rgba(15, 23, 42, 0.25)",
    pointerEvents: "none",
    userSelect: "none",
    transition: "opacity 120ms ease",
    opacity: "0.85",
  } as CSSStyleDeclaration);

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:999px;background:#6366f1;color:#fff;font-size:9px;font-weight:700;">bh</span>
      <span style="font-weight:600;letter-spacing:0.02em;">ByHuman</span>
      <span data-bh-state style="margin-left:auto;font-size:10px;color:#fbbf24;">idle</span>
    </div>
    <div data-bh-stats style="font-variant-numeric:tabular-nums;color:#cbd5f5;">Start typing or pasting to begin a session.</div>
  `;
  return el;
}

function setIndicatorActive(el: HTMLElement, active: boolean): void {
  const state = el.querySelector<HTMLElement>("[data-bh-state]");
  if (!state) return;
  state.textContent = active ? "tracking" : "idle";
  state.style.color = active ? "#34d399" : "#fbbf24";
}

function setIndicatorMessage(el: HTMLElement, msg: string, color: string): void {
  const state = el.querySelector<HTMLElement>("[data-bh-state]");
  if (state) {
    state.textContent = msg;
    state.style.color = color;
  }
}

function renderStats(
  el: HTMLElement,
  snapshot: ReturnType<ProvenanceTracker["snapshot"]>,
): void {
  const target = el.querySelector<HTMLElement>("[data-bh-stats]");
  if (!target) return;
  const s = snapshot.sessionStats;
  const verdictColor = verdictTone(snapshot.verdict);
  const largeBadge =
    s.largePasteEvents > 0
      ? ` <span style="color:#fbbf24;">(${s.largePasteEvents} large)</span>`
      : "";
  target.innerHTML = `
    <div>Typed: <strong>${s.typedChars}</strong></div>
    <div>Pasted: <strong>${s.pastedChars}</strong>${largeBadge}</div>
    <div>Deleted: <strong>${s.deletedChars}</strong> <span style="color:#94a3b8;">(${s.deleteEvents} ev)</span></div>
    <div>Total now: <strong>${s.totalChars}</strong></div>
    <div style="margin-top:4px;color:${verdictColor};font-weight:600;">${snapshot.verdict}</div>
  `;
}

function verdictTone(verdict: string): string {
  if (verdict === "Mostly typed") return "#34d399";
  if (verdict === "Mostly pasted") return "#fb7185";
  if (verdict === "Mixed") return "#fbbf24";
  return "#94a3b8";
}

function positionIndicator(el: HTMLElement, composer: HTMLElement): void {
  const rect = composer.getBoundingClientRect();
  const margin = 8;
  const indicatorRect = el.getBoundingClientRect();
  const spaceRight = window.innerWidth - rect.right;
  if (spaceRight >= indicatorRect.width + margin * 2) {
    el.style.top = `${Math.max(margin, rect.top)}px`;
    el.style.left = `${rect.right + margin}px`;
  } else {
    el.style.top = `${Math.min(
      window.innerHeight - indicatorRect.height - margin,
      rect.bottom + margin,
    )}px`;
    el.style.left = `${Math.max(margin, rect.left)}px`;
  }
}

// ── Receipt submission ────────────────────────────────────────────────────

/**
 * Pick the AttachedComposer that authored the just-published tweet.
 *
 *   - Prefer the composer whose lastSeenText starts with or contains the
 *     `publishedText` substring (X strips trailing whitespace but the
 *     leading portion matches).
 *   - Otherwise, if there's exactly one active tracker, use it.
 *   - Otherwise, give up — we'd rather miss the receipt than attribute the
 *     wrong session.
 */
function pickComposerForTweet(publishedText: string): AttachedComposer | null {
  const candidates: AttachedComposer[] = [];
  for (const node of attachedNodes) {
    const s = attached.get(node);
    if (s && s.tracker && s.lastSeenText.length > 0) candidates.push(s);
  }
  if (candidates.length === 0) return null;

  const trimmed = publishedText.trim();
  if (trimmed) {
    const exact = candidates.find((c) => c.lastSeenText.trim() === trimmed);
    if (exact) return exact;
    const prefix = candidates.find((c) =>
      trimmed.startsWith(c.lastSeenText.trim().slice(0, 60)),
    );
    if (prefix) return prefix;
  }

  return candidates.length === 1 ? candidates[0] : null;
}

async function submitReceipt(
  state: AttachedComposer,
  tweetId: string,
): Promise<void> {
  if (!state.tracker) return;
  const snapshot = state.tracker.snapshot();
  const tweetUrl = `https://x.com/i/web/status/${tweetId}`;

  setIndicatorMessage(state.indicator, "saving…", "#fbbf24");

  try {
    const res = await fetch(POSTS_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: state.lastSeenText,
        events: snapshot.events,
        kinds: snapshot.kinds,
        sessionStats: snapshot.sessionStats,
        startedAt: state.startedAt,
        source: "twitter",
        tweetId,
        tweetUrl,
      }),
    });

    if (res.status === 401) {
      setIndicatorMessage(state.indicator, "sign in to save", "#fbbf24");
      return;
    }
    if (!res.ok) {
      setIndicatorMessage(state.indicator, "save failed", "#fb7185");
      return;
    }

    setIndicatorMessage(state.indicator, "saved ✓", "#34d399");

    // Reset the tracker so the next tweet starts a fresh session.
    state.tracker = null;
    state.lastSeenText = "";
    state.startedAt = 0;
  } catch (err) {
    console.warn("[ByHuman] failed to submit receipt", err);
    setIndicatorMessage(state.indicator, "save failed", "#fb7185");
  }
}

document.addEventListener("byhuman:tweet-posted", (ev: Event) => {
  const detail = (ev as CustomEvent<{ tweetId: string; text: string }>).detail;
  if (!detail || !detail.tweetId) return;
  const state = pickComposerForTweet(detail.text);
  if (!state) {
    console.info("[ByHuman] tweet posted but no matching tracker found");
    return;
  }
  void submitReceipt(state, detail.tweetId);
});

// ── Bootstrap ─────────────────────────────────────────────────────────────

function rescan(): void {
  const composers = findComposers(document);
  const seen = new Set(composers);

  for (const node of [...attachedNodes]) {
    if (!seen.has(node) || !document.contains(node)) {
      detachComposer(node);
    }
  }

  for (const composer of composers) {
    attachToComposer(composer);
  }
}

const observer = new MutationObserver(() => {
  queueMicrotask(rescan);
});
observer.observe(document.body, { childList: true, subtree: true });

rescan();

console.info("[ByHuman] content script ready on", location.origin);
