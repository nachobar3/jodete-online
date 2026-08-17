import { test, expect } from "@playwright/test";

test("flujo real: el jugador de turno puede jugar por la UI", async ({ browser }) => {
  const hctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const gctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const hp = await hctx.newPage();
  const gp = await gctx.newPage();
  for (const p of [hp, gp]) {
    p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
    p.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE.ERROR:", m.text()); });
  }

  await hp.goto("/?e2e=1");
  await hp.getByTestId("name-input").fill("Host");
  await hp.getByTestId("create-btn").click();
  const code = (await hp.getByTestId("room-code").textContent())!.trim();
  await gp.goto("/?e2e=1");
  await gp.getByTestId("name-input").fill("Guest");
  await gp.getByTestId("code-input").fill(code);
  await gp.getByTestId("join-btn").click();
  await hp.getByTestId("ready-btn").click();
  await gp.getByTestId("ready-btn").click();
  await hp.getByTestId("start-btn").click();
  await expect(hp.getByTestId("hand").locator(".card")).toHaveCount(7);

  const H = await hp.evaluate(() => (window as any).__room.sessionId);
  const G = await gp.evaluate(() => (window as any).__room.sessionId);
  const pageOf = (id: string) => (id === H ? hp : gp);
  const st = (p = hp) => p.evaluate(() => {
    const r = (window as any).__room;
    return { current: r.state.currentPlayerId, top: r.state.top?.id, pending: r.state.pendingDraw, phase: r.state.phase };
  });

  // Ya no hay marca visual de jugables (el jugador puede equivocarse). Para avanzar
  // el juego probamos cada carta de la mano hasta que el tope cambie; el server
  // valida (las ilegales dentro de turno se rechazan por la regla de los 2s).
  const tryPlayAny = async (pg: typeof hp): Promise<boolean> => {
    const cards = pg.getByTestId("hand").locator(".card");
    const n = await cards.count();
    for (let j = 0; j < n; j++) {
      const before = (await st()).top;
      await cards.nth(j).click();
      if (await pg.getByTestId("suit-C").isVisible().catch(() => false)) await pg.getByTestId("suit-C").click();
      await hp.waitForTimeout(300);
      if ((await st()).top !== before) return true;
    }
    return false;
  };

  let plays = 0;
  for (let i = 0; i < 10; i++) {
    const s = await st();
    if (s.phase !== "playing") break;
    const pg = pageOf(s.current);
    console.log(`turno ${i}: current=${s.current === H ? "Host" : "Guest"} top=${s.top} pending=${s.pending}`);

    if (await tryPlayAny(pg)) {
      plays++;
      console.log(`   -> JUGÓ ok (top ${s.top} -> ${(await st()).top})`);
    } else {
      await pg.getByTestId("draw-btn").click();
      await hp.waitForTimeout(250);
      if (!(await tryPlayAny(pg))) {
        if (await pg.getByTestId("pass-btn").isVisible().catch(() => false)) {
          await pg.getByTestId("pass-btn").click();
          await hp.waitForTimeout(250);
        }
      } else {
        plays++;
      }
    }
  }

  console.log(`TOTAL jugadas exitosas por UI: ${plays}`);
  expect(plays).toBeGreaterThan(0);
  await hctx.close();
  await gctx.close();
});
