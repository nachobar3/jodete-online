// Checks objetivos: se calculan en la página (sin LLM), son deterministas y son el
// piso de calidad. Devuelven {metric, value, pass, detail}. Los thresholds dependen
// de si el viewport es mobile.
import type { Page } from "@playwright/test";
import type { Viewport } from "./viewports.ts";

export interface ObjResult { metric: string; value: number | null; pass: boolean; detail?: string }

// Se ejecuta dentro del browser: junta datos crudos de layout/contraste.
function inPage() {
  const vw = window.innerWidth, vh = window.innerHeight;

  const rectsOutside = (sel: string) => {
    const out: string[] = [];
    document.querySelectorAll(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1) out.push(`${r.left | 0},${r.top | 0} ${r.width | 0}x${r.height | 0}`);
    });
    return out;
  };

  // tap targets chicos en zona interactiva
  const smallTargets: string[] = [];
  document.querySelectorAll("button, [data-testid^='card-'], .card").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.width < 44 || r.height < 44) smallTargets.push(`${(el as HTMLElement).dataset.testid ?? el.className}:${r.width | 0}x${r.height | 0}`);
  });

  // contraste de textos clave contra su fondo efectivo
  const lum = (c: string) => {
    const m = c.match(/[\d.]+/g);
    if (!m) return 1;
    const [r, g, b] = m.map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const bgOf = (el: Element): string => {
    let n: Element | null = el;
    while (n) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
      n = n.parentElement;
    }
    return "rgb(255,255,255)";
  };
  const contrast = (sel: string): number | null => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const fg = lum(getComputedStyle(el).color);
    const bg = lum(bgOf(el));
    const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg];
    return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
  };

  // solapamiento de bounding boxes de textos de asientos (nombres/contadores encimados)
  const seatEls = [...document.querySelectorAll("[data-testid^='seat-']")].map((e) => e.getBoundingClientRect());
  let overlaps = 0;
  for (let i = 0; i < seatEls.length; i++)
    for (let j = i + 1; j < seatEls.length; j++) {
      const a = seatEls[i], b = seatEls[j];
      const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (ox * oy > 100) overlaps++;
    }

  // G2/G3: los botones de acción no deben quedar tapados por cartas de la mano.
  const actionBtns = [...document.querySelectorAll("[data-testid='draw-btn'],[data-testid='pass-btn'],[data-testid='una-btn'],[data-testid='jodete-btn']")];
  const handCards = [...document.querySelectorAll("[data-testid='hand'] .card")];
  const coveredBtns: string[] = [];
  for (const b of actionBtns) {
    const br = b.getBoundingClientRect();
    const barea = br.width * br.height;
    if (barea === 0) continue;
    let ov = 0;
    for (const c of handCards) {
      const cr = c.getBoundingClientRect();
      const ox = Math.max(0, Math.min(br.right, cr.right) - Math.max(br.left, cr.left));
      const oy = Math.max(0, Math.min(br.bottom, cr.bottom) - Math.max(br.top, cr.top));
      ov += ox * oy;
    }
    if (ov / barea > 0.3) coveredBtns.push((b as HTMLElement).dataset.testid ?? "btn");
  }

  // G14: ninguna carta puede tener transparencia (opacity != 1) en ningún estado.
  const cardOpacity: string[] = [];
  document.querySelectorAll(".card").forEach((el) => {
    const op = getComputedStyle(el).opacity;
    if (op !== "1") cardOpacity.push(`${(el as HTMLElement).className.split(" ").slice(0, 2).join(".")}:${op}`);
  });

  // G15: no se marcan las jugables ni se atenúan las no-jugables (mano homogénea).
  const playableMarks: string[] = [];
  const nPlayable = document.querySelectorAll(".card.playable").length;
  if (nPlayable > 0) playableMarks.push(`playable×${nPlayable}`);
  document.querySelectorAll("[data-testid='hand'] .card").forEach((el) => {
    const f = getComputedStyle(el).filter;
    if (f && f !== "none") playableMarks.push(`filter:${f}`);
  });

  // G16: sin indicador permanente de turno (banner/texto/wait-hint ni clase de turno en la mano).
  const turnIndicators: string[] = [];
  if (document.querySelector(".turn-banner")) turnIndicators.push("turn-banner");
  if (document.querySelector(".wait-hint")) turnIndicators.push("wait-hint");
  const myhand = document.querySelector(".myhand");
  if (myhand && (myhand.classList.contains("is-myturn") || myhand.classList.contains("not-myturn"))) turnIndicators.push("myhand-turn-class");

  return {
    scrollW: document.documentElement.scrollWidth,
    innerW: vw,
    cardOpacity,
    playableMarks,
    turnIndicators,
    offscreen: rectsOutside("[data-testid='hand'] .card, [data-testid='draw-btn'], [data-testid='pass-btn'], [data-testid='una-btn'], [data-testid='jodete-btn']"),
    coveredBtns,
    smallTargets,
    handCards: document.querySelectorAll("[data-testid='hand'] .card").length,
    contrastActiveSuit: contrast("[data-testid='active-suit']"),
    contrastRoomCode: contrast("[data-testid='room-code']"),
    contrastPending: contrast("[data-testid='pending']"),
    seatOverlaps: overlaps,
  };
}

export async function runObjectives(page: Page, vp: Viewport, consoleErrors: number): Promise<ObjResult[]> {
  const d = await page.evaluate(inPage);
  const res: ObjResult[] = [];
  const MIN_CONTRAST = 4.5; // WCAG AA texto normal

  res.push({ metric: "horizontal_overflow", value: d.scrollW - d.innerW, pass: d.scrollW <= d.innerW + 1, detail: `scrollW=${d.scrollW} vw=${d.innerW}` });
  res.push({ metric: "offscreen_elements", value: d.offscreen.length, pass: d.offscreen.length === 0, detail: d.offscreen.slice(0, 4).join(" | ") });
  res.push({ metric: "controls_covered_by_cards", value: d.coveredBtns.length, pass: d.coveredBtns.length === 0, detail: d.coveredBtns.join(", ") }); // G2/G3
  if (vp.mobile) res.push({ metric: "small_tap_targets", value: d.smallTargets.length, pass: d.smallTargets.length === 0, detail: d.smallTargets.slice(0, 6).join(" | ") });
  res.push({ metric: "seat_overlaps", value: d.seatOverlaps, pass: d.seatOverlaps === 0 });
  res.push({ metric: "console_errors", value: consoleErrors, pass: consoleErrors === 0 });
  // G14/G15/G16 — invariantes anti-pista (ver GUIDELINES.md sección F).
  res.push({ metric: "card_opacity", value: d.cardOpacity.length, pass: d.cardOpacity.length === 0, detail: d.cardOpacity.slice(0, 4).join(" | ") });
  res.push({ metric: "no_playable_marking", value: d.playableMarks.length, pass: d.playableMarks.length === 0, detail: d.playableMarks.slice(0, 4).join(" | ") });
  res.push({ metric: "no_turn_indicator", value: d.turnIndicators.length, pass: d.turnIndicators.length === 0, detail: d.turnIndicators.join(", ") });

  for (const [name, v] of [["contrast_active_suit", d.contrastActiveSuit], ["contrast_room_code", d.contrastRoomCode], ["contrast_pending", d.contrastPending]] as const) {
    if (v == null) continue; // elemento no presente en este momento
    res.push({ metric: name, value: v, pass: v >= MIN_CONTRAST, detail: `ratio ${v}` });
  }
  return res;
}
