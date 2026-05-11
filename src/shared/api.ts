import { ME_URL, FALLBACK_ME_URL, API_BASE_URL, API_FALLBACK_URL } from "./config";
import type { MeResponse } from "./types";

export type MeResult = MeResponse & { resolvedUrl: string };

export async function safeJsonFetch<T>(
    input: string,
    init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new TypeError(                          // ← TypeError, не Error
        `Network error reaching ${input}: ${reason}. ` +
        `Is the backend running, and is its origin listed in manifest host_permissions?`,
    );
  }

  const raw = await response.text();
  let parsed: unknown = undefined;
  let parseFailed = false;
  try {
    parsed = raw.length === 0 ? null : JSON.parse(raw);
  } catch {
    parseFailed = true;
  }

  if (parseFailed) {
    const preview = raw.slice(0, 120).replace(/\s+/g, " ").trim();
    throw new Error(
        `Backend returned non-JSON response (status ${response.status}). ` +
        `Preview: "${preview}${raw.length > 120 ? "…" : ""}". ` +
        `URL: ${input}`,
    );
  }

  if (!response.ok) {
    const message = pickErrorMessage(parsed) ?? `HTTP ${response.status}`;
    throw new Error(message);
  }

  return parsed as T;
}

function pickErrorMessage(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const candidate = (parsed as Record<string, unknown>).error;
  return typeof candidate === "string" ? candidate : undefined;
}

const FETCH_OPTS: RequestInit = {
  method: "GET",
  credentials: "include",
  headers: { Accept: "application/json" },
  cache: "no-store",
};

export async function getMe(): Promise<MeResult> {
  try {
    const res = await safeJsonFetch<MeResponse>(ME_URL, FETCH_OPTS);
    return { ...res, resolvedUrl: API_BASE_URL };
  } catch (err) {
    // Fallback только на сетевую ошибку (сервер не запущен).
    // Если localhost ответил "не авторизован" — это валидный ответ, не делаем fallback.
    const isNetworkError = err instanceof TypeError;

    if (isNetworkError && API_BASE_URL !== API_FALLBACK_URL) {
      const res = await safeJsonFetch<MeResponse>(FALLBACK_ME_URL, FETCH_OPTS);
      return { ...res, resolvedUrl: API_FALLBACK_URL };
    }

    throw err;
  }
}