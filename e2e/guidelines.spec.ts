// Tests de las reglas de GUIDELINES.md (G9-G12) + latencia (G5).
// Assertan el comportamiento DESEADO. Los que fallan documentan la brecha vs el engine actual:
//   G9  fuera-de-turno  → hoy el server rechaza ("no es tu turno")  → se espera FAIL hasta implementar
//   G10 última ilegal   → hoy no valida legalidad al cortar          → se espera FAIL hasta implementar
//   G11 acusar UNA       → implementado                               → se espera PASS
//   G12 jodete en falso  → implementado (caso simple)                 → se espera PASS
import { test, expect, type Browser, type Page } from "@playwright/test";

interface Card { id: string; suit: string; rank: string }
const filler = (n: number, p: string): Card[] => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, suit: "D", rank: "3" }));

async function makeTable(browser: Browser, n: number) {
  const pages: Page[] = [];
  const ctxs = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 720 } });
    ctxs.push(ctx);
    pages.push(await ctx.newPage());
  }
  await pages[0].goto("/?e2e=1");
  await pages[0].getByTestId("name-input").fill("Vos");
  await pages[0].getByTestId("create-btn").click();
  const code = (await pages[0].getByTestId("room-code").textContent())!.trim();
  const names = ["Walter", "Ana", "Beto"];
  for (let i = 1; i < n; i++) {
    await pages[i].goto("/?e2e=1");
    await pages[i].getByTestId("name-input").fill(names[i - 1]);
    await pages[i].getByTestId("code-input").fill(code);
    await pages[i].getByTestId("join-btn").click();
  }
  for (const p of pages) await p.getByTestId("ready-btn").click();
  await pages[0].getByTestId("start-btn").click();
  await pages[0].getByTestId("hand").locator(".card").first().waitFor();
  const ids: string[] = [];
  for (const p of pages) ids.push(await p.evaluate(() => (window as any).__room.sessionId));
  const send = (i: number, type: string, payload?: unknown) => pages[i].evaluate((a) => (window as any).__room.send(a.type, a.payload), { type, payload: payload ?? {} });
  const st = (i = 0) => pages[i].evaluate(() => { const r = (window as any).__room; return { phase: r.state.phase, current: r.state.currentPlayerId, top: r.state.top?.id, pending: r.state.pendingDraw }; });
  const handCount = (i: number): Promise<number | null> => pages[i].evaluate(() => {
    const r = (window as any).__room; let me: any;
    r.state.players.forEach((p: any) => { if (p.id === r.sessionId) me = p; });
    return me?.handCount ?? null;
  });
  const seed = async (o: { top: Card; hands: Record<number, Card[]>; currentIdx?: number }) => {
    const hands: Record<string, Card[]> = {};
    for (const [k, v] of Object.entries(o.hands)) hands[ids[Number(k)]] = v;
    await send(0, "__setup", { top: o.top, hands, deck: filler(40, "z"), turnOrder: ids, currentPlayerId: ids[o.currentIdx ?? 0] });
    await pages[0].getByTestId("pile").getByTestId(`card-${o.top.id}`).waitFor();
  };
  const close = async () => { for (const c of ctxs) await c.close().catch(() => {}); };
  return { pages, ids, send, st, seed, handCount, close };
}

// G11 — acusar UNA: el acusado con 1 carta sin UNA roba 3. (esperado PASS)
test("G11: acusar UNA hace robar 3 al que no cantó", async ({ browser }) => {
  const t = await makeTable(browser, 3);
  try {
    await t.seed({ top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0, hands: { 0: filler(5, "h"), 1: [{ id: "solo", suit: "H", rank: "9" }], 2: filler(3, "b") } });
    await t.pages[0].waitForTimeout(200);
    await t.send(0, "accuseUna", { targetId: t.ids[1] });
    await expect.poll(() => t.handCount(1), { timeout: 4000 }).toBe(4); // 1 + 3
  } finally { await t.close(); }
});

// G9 — jugar fuera de turno debe ser ACEPTADO como ilegal/challengeable, NO rechazado por turno. (hoy FAIL)
test("G9: se puede tirar fuera de turno (ilegal, challengeable)", async ({ browser }) => {
  const t = await makeTable(browser, 3);
  try {
    // turno del host (idx0); guest1 (idx1) intenta jugar aunque NO es su turno
    await t.seed({ top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0, hands: { 0: filler(5, "h"), 1: [{ id: "g7h", suit: "H", rank: "7" }, ...filler(3, "a")], 2: filler(2, "b") } });
    await t.pages[0].waitForTimeout(1200); // pasar la ventana de permanencia
    const before = await t.st();
    await t.send(1, "playCards", { cardIds: ["g7h"], observedVersion: 0 });
    await t.pages[0].waitForTimeout(600);
    const after = await t.st();
    // DESEADO: la carta quedó en la mesa (challengeable), no se rechazó por "no es tu turno"
    expect(after.top, "la jugada fuera de turno debería quedar en la mesa").not.toBe(before.top);
  } finally { await t.close(); }
});

// G10 — la última carta no puede jugarse ilegal: auto-JODETE, roba 3, carta devuelta, sigue jugando. (hoy FAIL)
test("G10: última carta ilegal → auto-JODETE y roba 3", async ({ browser }) => {
  const t = await makeTable(browser, 3);
  try {
    // host con 1 sola carta ILEGAL (9H sobre 7S: distinto palo y número). Dijo UNA para aislar la regla.
    await t.seed({ top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0, hands: { 0: [{ id: "last", suit: "H", rank: "9" }], 1: filler(4, "a"), 2: filler(3, "b") } });
    await t.send(0, "sayUna");
    await t.pages[0].waitForTimeout(1200);
    await t.pages[0].getByTestId("hand").getByTestId("card-last").click();
    await t.pages[0].waitForTimeout(700);
    const s = await t.st();
    expect(s.phase, "no debería cortar con una jugada ilegal").toBe("playing");
    await expect.poll(() => t.handCount(0), { timeout: 4000 }).toBe(4); // carta devuelta (1) + robo 3
  } finally { await t.close(); }
});

// G12 — JODETE sin jugada ilegal (y nadie en 1-sin-UNA): el que lo pidió roba 3. (esperado PASS, caso simple)
test("G12: JODETE en falso hace robar 3 al acusador", async ({ browser }) => {
  const t = await makeTable(browser, 3);
  try {
    // estado limpio: host juega una carta LEGAL, luego guest1 pide JODETE sin motivo
    await t.seed({ top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0, hands: { 0: [{ id: "h7d", suit: "D", rank: "7" }, ...filler(4, "h")], 1: filler(4, "a"), 2: filler(3, "b") } });
    await t.pages[0].waitForTimeout(300);
    await t.pages[0].getByTestId("hand").getByTestId("card-h7d").click(); // 7D sobre 7S: legal (mismo número)
    await t.pages[0].waitForTimeout(500);
    const g1Before = await t.handCount(1);
    await t.send(1, "callJodete", {});
    await expect.poll(() => t.handCount(1), { timeout: 4000 }).toBe((g1Before ?? 0) + 3);
  } finally { await t.close(); }
});

// G17 — tras usar JODETE, el botón queda deshabilitado hasta la próxima jugada real (no se spamea).
test("G17: JODETE se deshabilita hasta que haya otra jugada", async ({ browser }) => {
  const t = await makeTable(browser, 3);
  try {
    await t.seed({ top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0, hands: { 0: [{ id: "h7d", suit: "D", rank: "7" }, ...filler(4, "h")], 1: filler(4, "a"), 2: filler(3, "b") } });
    await t.pages[0].waitForTimeout(300);
    // host juega legal (7D sobre 7S) → el turno pasa a guest1
    await t.pages[0].getByTestId("hand").getByTestId("card-h7d").click();
    await t.pages[0].waitForTimeout(500);

    const jodete = t.pages[1].getByTestId("jodete-btn");
    await expect(jodete).toBeEnabled();

    // JODETE en falso: guest1 roba 3 y el botón queda deshabilitado
    const before = await t.handCount(1);
    await jodete.click();
    await expect.poll(() => t.handCount(1), { timeout: 4000 }).toBe((before ?? 0) + 3);
    await expect(jodete).toBeDisabled();

    // No se puede spamear: un segundo click (botón disabled) no roba más cartas
    const afterFirst = await t.handCount(1);
    await jodete.click({ force: true }).catch(() => {});
    await t.pages[1].waitForTimeout(300);
    expect(await t.handCount(1)).toBe(afterFirst);

    // Otra jugada real (guest1 juega 3D legal sobre 7D) reactiva el botón
    await t.pages[1].getByTestId("hand").getByTestId("card-a0").click();
    await expect(jodete).toBeEnabled();
  } finally { await t.close(); }
});

// G5 — latencia: tiempo jugada→observado por otro cliente. Reporta p50/p95 y exige p95 < 400ms local.
test("G5: latencia de jugada bajo 4 clientes", async ({ browser }) => {
  const t = await makeTable(browser, 4);
  try {
    const samples: number[] = [];
    for (let k = 0; k < 8; k++) {
      // host juega una carta legal; medimos hasta que guest1 observa el nuevo tope
      const cardId = `p${k}`;
      await t.seed({ top: { id: `T${k}`, suit: "S", rank: "7" }, currentIdx: 0, hands: { 0: [{ id: cardId, suit: "D", rank: "7" }, ...filler(3, "h")], 1: filler(3, "a"), 2: filler(3, "b"), 3: filler(3, "c") } });
      await t.pages[0].waitForTimeout(150);
      // Date.now() es reloj de sistema: comparable entre páginas (performance.now() no lo es).
      const start = await t.pages[0].evaluate(() => Date.now());
      await t.send(0, "playCards", { cardIds: [cardId], observedVersion: 0 });
      await t.pages[1].waitForFunction((cid) => (window as any).__room.state.top?.id === cid, cardId, { timeout: 3000 });
      const end = await t.pages[1].evaluate(() => Date.now());
      samples.push(end - start);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)];
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
    console.log(`G5 latencia jugada→broadcast: p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms n=${samples.length}`);
    expect(p95, "p95 de latencia local").toBeLessThan(400);
  } finally { await t.close(); }
});
