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

// ── Indicator UI ──────────────────────────────────────────────────────────

function createIndicator(): HTMLDivElement {
  const el = document.createElement("div");
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
    opacity: "0.85",
  } as CSSStyleDeclaration);

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:999px;background:#6366f1;color:#fff;font-size:9px;font-weight:700;">bh</span>
      <span style="font-weight:600;letter-spacing:0.02em;">ByHuman</span>
      <span data-bh-state style="margin-left:auto;font-size:10px;color:#fbbf24;">idle</span>
    </div>
    <div data-bh-stats style="font-variant-numeric:tabular-nums;color:#cbd5f5;">Start typing to begin a session.</div>
  `;
  return el;
}

function positionIndicator(el: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const iw = el.getBoundingClientRect().width || 220;
  const spaceRight = window.innerWidth - rect.right;
  if (spaceRight >= iw + margin * 2) {
    el.style.top = `${Math.max(margin, rect.top)}px`;
    el.style.left = `${rect.right + margin}px`;
  } else {
    el.style.top = `${rect.bottom + margin}px`;
    el.style.left = `${Math.max(margin, rect.left)}px`;
  }
}

function setIndicatorState(el: HTMLElement, msg: string, color: string): void {
  const s = el.querySelector<HTMLElement>("[data-bh-state]");
  if (s) { s.textContent = msg; s.style.color = color; }
}

function renderStats(el: HTMLElement, snap: ReturnType<ProvenanceTracker["snapshot"]>): void {
  const target = el.querySelector<HTMLElement>("[data-bh-stats]");
  if (!target) return;
  const s = snap.sessionStats;
  const verdictColor =
    snap.verdict === "Mostly typed"  ? "#34d399" :
    snap.verdict === "Mostly pasted" ? "#fb7185" :
    snap.verdict === "Mixed"         ? "#fbbf24" : "#94a3b8";
  const largeBadge = s.largePasteEvents > 0
    ? ` <span style="color:#fbbf24;">(${s.largePasteEvents} large)</span>`
    : "";
  target.innerHTML = `
    <div>Typed: <strong>${s.typedChars}</strong></div>
    <div>Pasted: <strong>${s.pastedChars}</strong>${largeBadge}</div>
    <div>Deleted: <strong>${s.deletedChars}</strong></div>
    <div style="margin-top:4px;color:${verdictColor};font-weight:600;">${snap.verdict}</div>
  `;
}

// ── Receipt submission ────────────────────────────────────────────────────

async function submitReceipt(state: AttachedCompose): Promise<void> {
  if (!state.tracker) return;
  const snapshot = state.tracker.snapshot();
  setIndicatorState(state.indicator, "saving…", "#fbbf24");

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
      setIndicatorState(state.indicator, "sign in to save", "#fbbf24");
      return;
    }
    if (!res.ok) {
      setIndicatorState(state.indicator, "save failed", "#fb7185");
      return;
    }

    setIndicatorState(state.indicator, "saved ✓", "#34d399");
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
    setIndicatorState(indicator, "tracking", "#34d399");
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
