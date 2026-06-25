/**
 * ByHuman floating indicator — shared across all content scripts.
 *
 * Matches the editorial design system from the landing page:
 * white card, hairline border, indigo accent, mono type.
 */

import type { ProvenanceTracker } from "@core/tracker";

// Brand tokens (hardcoded — CSS vars not available in content scripts)
const T = {
  ink:           "#0e1130",
  ink2:          "#2a2e55",
  muted:         "#6b6f92",
  line:          "#e4e5ee",
  surface:       "#ffffff",
  indigo:        "#2826b8",
  verified:      "#1f8a5b",
  verifiedSoft:  "#ddf1e6",
  amber:         "#b8742a",
  coral:         "#b83a2a",
  mono:          '"JetBrains Mono", ui-monospace, Menlo, monospace',
  serif:         'Newsreader, Georgia, "Times New Roman", serif',
} as const;

export function createIndicator(): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-byhuman", "indicator");
  Object.assign(el.style, {
    position:      "fixed",
    zIndex:        "2147483646",
    minWidth:      "196px",
    maxWidth:      "256px",
    padding:       "11px 13px",
    background:    T.surface,
    border:        `1px solid ${T.line}`,
    borderRadius:  "6px",
    boxShadow:     `0 24px 70px -44px rgba(14,17,48,0.22), 0 2px 8px -2px rgba(14,17,48,0.06)`,
    fontFamily:    T.mono,
    fontSize:      "11px",
    lineHeight:    "1.55",
    color:         T.ink,
    pointerEvents: "none",
    userSelect:    "none",
  } as CSSStyleDeclaration);

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid ${T.line};">
      <span style="font-size:12px;letter-spacing:-0.01em;">
        <span style="color:${T.muted};font-weight:400;">[</span><span style="color:${T.indigo};font-style:italic;font-family:${T.serif};font-weight:400;font-size:12.5px;">by</span><span style="color:${T.muted};font-weight:400;">:</span><span style="color:${T.ink};font-weight:700;">human</span><span style="color:${T.muted};font-weight:400;">]</span>
      </span>
      <span data-bh-state style="margin-left:auto;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:${T.muted};">idle</span>
    </div>
    <div data-bh-stats style="color:${T.muted};font-size:10.5px;">Start typing to begin a session.</div>
  `;
  return el;
}

export function positionIndicator(el: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const margin = 10;
  const iw = el.getBoundingClientRect().width || 210;
  const spaceRight = window.innerWidth - rect.right;
  if (spaceRight >= iw + margin * 2) {
    el.style.top  = `${Math.max(margin, rect.top)}px`;
    el.style.left = `${rect.right + margin}px`;
  } else {
    el.style.top  = `${rect.bottom + margin}px`;
    el.style.left = `${Math.max(margin, rect.left)}px`;
  }
}

export function setIndicatorState(el: HTMLElement, msg: string, tone: "idle" | "active" | "saving" | "ok" | "error" | "warn"): void {
  const s = el.querySelector<HTMLElement>("[data-bh-state]");
  if (!s) return;
  s.textContent = msg;
  s.style.color = {
    idle:   T.muted,
    active: T.verified,
    saving: T.amber,
    ok:     T.verified,
    error:  T.coral,
    warn:   T.amber,
  }[tone];
}

export function renderStats(
  el: HTMLElement,
  snap: ReturnType<ProvenanceTracker["snapshot"]>,
): void {
  const target = el.querySelector<HTMLElement>("[data-bh-stats]");
  if (!target) return;
  const s = snap.sessionStats;
  const verdictColor =
    snap.verdict === "Mostly typed"  ? T.verified :
    snap.verdict === "Mostly pasted" ? T.coral    :
    snap.verdict === "Mixed"         ? T.amber    : T.muted;
  const verdictBg =
    snap.verdict === "Mostly typed"  ? T.verifiedSoft :
    snap.verdict === "Mostly pasted" ? "#f5ddd7"      :
    snap.verdict === "Mixed"         ? "#f5e9d7"      : "transparent";

  const largeBadge = s.largePasteEvents > 0
    ? `<span style="color:${T.amber};"> (${s.largePasteEvents} large)</span>`
    : "";

  target.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:3px;">
      <div style="display:flex;justify-content:space-between;">
        <span style="color:${T.muted};">typed</span>
        <strong style="color:${T.ink};">${s.typedChars}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="color:${T.muted};">pasted${largeBadge}</span>
        <strong style="color:${s.pastedChars > 0 ? T.amber : T.ink};">${s.pastedChars}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="color:${T.muted};">deleted</span>
        <strong style="color:${T.ink};">${s.deletedChars}</strong>
      </div>
    </div>
    <div style="margin-top:8px;padding:4px 8px;border-radius:4px;background:${verdictBg};display:inline-block;">
      <span style="color:${verdictColor};font-weight:600;font-size:10.5px;letter-spacing:0.03em;">${snap.verdict}</span>
    </div>
  `;
}
