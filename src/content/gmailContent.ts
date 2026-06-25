/**
 * ByHuman content script for Gmail.
 *
 * Architecture
 * ────────────
 *
 *   - MutationObserver detects compose windows opening / closing.
 *   - ProvenanceTracker per compose body: text changes flow through
 *     applyChange(newText, hint) — same as the web editor and Twitter script.
 *   - A single document-level click listener (capture phase) detects Send
 *     button clicks, walks up to find which compose window the button belongs
 *     to, and submits the matching tracker's receipt.
 *
 * No page-world injection needed — unlike Twitter, we don't need to patch
 * fetch/XHR because the Send action is observable from the DOM directly.
 *
 * Privacy
 * ───────
 *
 * Email body text is sent to /api/posts so the server can hash it. The
 * receipt is posted with visibility PRIVATE — it never appears on a public
 * proof page unless the user changes that explicitly.
 */

import { ProvenanceTracker, type ChangeHint } from "@core/tracker";
import { POSTS_URL } from "@shared/config";
import { createIndicator, positionIndicator, setIndicatorState, renderStats } from "@shared/indicator";

// ── Selectors ─────────────────────────────────────────────────────────────

// Gmail compose body (ordered most-specific first).
const BODY_SELECTORS = [
  'div[g_editable="true"][contenteditable="true"]',
  'div[role="textbox"][contenteditable="true"].LW-avf',
  'div[role="textbox"][contenteditable="true"][aria-label*="Message Body"]',
];

// Send button candidates — checked via .closest() on click targets.
const SEND_SELECTORS = [
  '[data-tooltip*="Send"]',
  '[aria-label="Send ⌘Enter"]',
  '[aria-label="Send"]',
];

// ── Types ─────────────────────────────────────────────────────────────────

interface AttachedCompose {
  body: HTMLElement;
  indicator: HTMLDivElement;
  tracker: ProvenanceTracker | null;
  pendingHint: ChangeHint;
  lastSeenText: string;
  startedAt: number;
  textObserver: MutationObserver | null;
  cleanup: () => void;
}

const attached: WeakMap<HTMLElement, AttachedCompose> = new WeakMap();
const attachedBodies: Set<HTMLElement> = new Set();

// ── DOM helpers ───────────────────────────────────────────────────────────

function findComposeBodies(root: ParentNode): HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const sel of BODY_SELECTORS) {
    root.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (el.getAttribute("contenteditable") === "true") found.add(el);
    });
  }
  return [...found];
}

function readBodyText(body: HTMLElement): string {
  return (body.textContent ?? "").replace(/[​‌‍﻿]/g, "");
}

// Indicator UI is provided by @shared/indicator

// ── Receipt submission ────────────────────────────────────────────────────

async function submitReceipt(state: AttachedCompose): Promise<void> {
  if (!state.tracker) return;
  const snapshot = state.tracker.snapshot();
  setIndicatorState(state.indicator, "saving…", "saving");

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
        source: "gmail",
        visibility: "PRIVATE",
      }),
    });

    if (res.status === 401) {
      setIndicatorState(state.indicator, "sign in to save", "warn");
      return;
    }
    if (!res.ok) {
      setIndicatorState(state.indicator, "save failed", "error");
      return;
    }

    setIndicatorState(state.indicator, "saved ✓", "ok");
    state.tracker = null;
    state.lastSeenText = "";
    state.startedAt = 0;
  } catch (err) {
    console.warn("[ByHuman] failed to submit Gmail receipt", err);
    setIndicatorState(state.indicator, "save failed", "#fb7185");
  }
}

// ── Send button detection (single document listener) ──────────────────────

// One capture-phase listener for the whole page. When a Send button is
// clicked we walk UP from it to find which compose window it belongs to,
// then submit the matching tracker's receipt.
document.addEventListener(
  "click",
  (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;

    const isSend = SEND_SELECTORS.some((sel) => target.closest(sel));
    if (!isSend) return;

    // Walk up from the clicked element to find a container that wraps
    // one of our tracked compose bodies.
    let el: HTMLElement | null = target;
    while (el && el !== document.body) {
      for (const body of attachedBodies) {
        if (el.contains(body)) {
          const state = attached.get(body);
          if (state) void submitReceipt(state);
          return;
        }
      }
      el = el.parentElement;
    }
  },
  true, // capture — fires before Gmail's own handler
);

// ── Attach / detach ───────────────────────────────────────────────────────

function attachToBody(body: HTMLElement): void {
  if (attached.has(body)) return;

  const indicator = createIndicator();
  document.body.appendChild(indicator);

  const state: AttachedCompose = {
    body,
    indicator,
    tracker: null,
    pendingHint: "typed",
    lastSeenText: "",
    startedAt: 0,
    textObserver: null,
    cleanup: () => {},
  };

  const reposition = () => positionIndicator(indicator, body);
  reposition();
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);

  let userInteracted = false;

  const startIfNeeded = () => {
    if (state.tracker || !userInteracted) return;
    const initial = readBodyText(body);
    state.tracker = new ProvenanceTracker(initial);
    state.lastSeenText = initial;
    state.startedAt = Date.now();
    setIndicatorState(indicator, "tracking", "active");
    renderStats(indicator, state.tracker.snapshot());
  };

  const markInteracted = () => { userInteracted = true; startIfNeeded(); };

  const syncText = () => {
    if (!state.tracker) return;
    const next = readBodyText(body);
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

  const onInput = () => { markInteracted(); queueMicrotask(syncText); };
  const onPointerDown = () => markInteracted();

  body.addEventListener("paste", onPaste);
  body.addEventListener("keydown", onKeyDown);
  body.addEventListener("input", onInput);
  body.addEventListener("pointerdown", onPointerDown);

  const textObserver = new MutationObserver(() => {
    if (!userInteracted) return;
    queueMicrotask(syncText);
  });
  textObserver.observe(body, { characterData: true, childList: true, subtree: true });
  state.textObserver = textObserver;

  state.cleanup = () => {
    body.removeEventListener("paste", onPaste);
    body.removeEventListener("keydown", onKeyDown);
    body.removeEventListener("input", onInput);
    body.removeEventListener("pointerdown", onPointerDown);
    state.textObserver?.disconnect();
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    indicator.remove();
  };

  attached.set(body, state);
  attachedBodies.add(body);
}

function detachBody(body: HTMLElement): void {
  const state = attached.get(body);
  if (!state) return;
  state.cleanup();
  attached.delete(body);
  attachedBodies.delete(body);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

function rescan(): void {
  const bodies = findComposeBodies(document);
  const seen = new Set(bodies);

  for (const node of [...attachedBodies]) {
    if (!seen.has(node) || !document.contains(node)) detachBody(node);
  }

  for (const body of bodies) {
    attachToBody(body);
  }
}

const domObserver = new MutationObserver(() => queueMicrotask(rescan));
domObserver.observe(document.body, { childList: true, subtree: true });

rescan();

console.info("[ByHuman] Gmail content script ready");
