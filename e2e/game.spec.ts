import { test, expect, Browser, Page } from "@playwright/test";

const filler = Array.from({ length: 24 }, (_, i) => ({ id: `F${i}`, suit: "D", rank: "3" }));

async function setupGame(browser: Browser) {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hp = await hostCtx.newPage();
  const gp = await guestCtx.newPage();

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

  // Arrancó y repartió (el turno ya no se muestra hasta pasados 8s).
  await expect(hp.getByTestId("hand").locator(".card")).toHaveCount(7);
  await expect(gp.getByTestId("hand").locator(".card")).toHaveCount(7);

  const ids = await hp.evaluate(() => {
    const r = (window as any).__room;
    const players: string[] = [];
    r.state.players.forEach((p: any) => players.push(p.id));
    return { me: r.sessionId, players };
  });
  const H = ids.me as string;
  const G = ids.players.find((x: string) => x !== H) as string;
  return { hp, gp, H, G, hostCtx, guestCtx };
}

async function devSetup(page: Page, setup: unknown) {
  await page.evaluate((s) => (window as any).__room.send("__setup", s), setup);
}

// Arrastra (pointer) una carta de la mano hasta el pozo, como un jugador real.
async function dragToPile(page: Page, cardTestId: string) {
  const card = await page.getByTestId(cardTestId).boundingBox();
  const pile = await page.getByTestId("pile").boundingBox();
  if (!card || !pile) throw new Error("sin boundingBox");
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2 - 40, { steps: 4 });
  await page.mouse.move(pile.x + pile.width / 2, pile.y + pile.height / 2, { steps: 6 });
  await page.mouse.up();
}

test("lobby: crear, unirse por código, listos y arrancar reparte 7 cartas", async ({ browser }) => {
  const { hp, gp, hostCtx, guestCtx } = await setupGame(browser);
  await expect(hp.getByTestId("hand").locator(".card")).toHaveCount(7);
  await expect(gp.getByTestId("hand").locator(".card")).toHaveCount(7);
  await hostCtx.close();
  await guestCtx.close();
});

test("jugar con drag & drop baja una carta y cambia el tope", async ({ browser }) => {
  const { hp, gp, H, hostCtx, guestCtx } = await setupGame(browser);
  // Escenario determinista: turno de Host, con una carta jugable clara (5♣ sobre 5♣).
  await devSetup(hp, {
    top: { id: "T5", suit: "C", rank: "5" },
    currentPlayerId: H,
    hands: {
      [H]: [{ id: "p5d", suit: "D", rank: "5" }, { id: "px", suit: "H", rank: "9" }],
      [(await gp.evaluate(() => (window as any).__room.sessionId))]: [{ id: "gx", suit: "H", rank: "8" }],
    },
    deck: filler,
  });
  // Esperar a que el patch de estado (tope/turno) llegue, no solo la mano.
  await expect(hp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  await expect(hp.getByTestId("card-p5d")).toBeVisible();

  // Drag & drop del 5♦ sobre el pozo (pointer, la carta sigue al cursor).
  await dragToPile(hp, "card-p5d");
  await expect(hp.getByTestId("pile").getByTestId("card-p5d")).toBeVisible();
  await expect(hp.getByTestId("hand").locator(".card")).toHaveCount(1);
  await hostCtx.close();
  await guestCtx.close();
});

test("jugar con doble-click baja la carta", async ({ browser }) => {
  const { hp, gp, H, hostCtx, guestCtx } = await setupGame(browser);
  await devSetup(hp, {
    top: { id: "T5", suit: "C", rank: "5" },
    currentPlayerId: H,
    hands: {
      [H]: [{ id: "p5d", suit: "D", rank: "5" }, { id: "px", suit: "H", rank: "9" }],
      [(await gp.evaluate(() => (window as any).__room.sessionId))]: [{ id: "gx", suit: "H", rank: "8" }],
    },
    deck: filler,
  });
  await expect(hp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  await hp.getByTestId("card-p5d").dblclick();
  await expect(hp.getByTestId("pile").getByTestId("card-p5d")).toBeVisible();
  await expect(hp.getByTestId("hand").locator(".card")).toHaveCount(1);
  await hostCtx.close();
  await guestCtx.close();
});

test("espejito: jugar carta idéntica fuera de turno", async ({ browser }) => {
  const { hp, gp, H, G, hostCtx, guestCtx } = await setupGame(browser);
  await devSetup(hp, {
    top: { id: "T6", suit: "C", rank: "6" },
    currentPlayerId: H, // turno de Host; Guest se adelanta con espejito
    hands: {
      [H]: [{ id: "h9", suit: "S", rank: "9" }],
      [G]: [{ id: "g6", suit: "C", rank: "6" }, { id: "g7", suit: "H", rank: "7" }],
    },
    deck: filler,
  });
  // Esperar el patch: ambos deben ver el tope forzado 6♣ y el guest su carta.
  await expect(hp.getByTestId("pile").getByTestId("card-T6")).toBeVisible();
  await expect(gp.getByTestId("pile").getByTestId("card-T6")).toBeVisible();
  await expect(gp.getByTestId("card-g6")).toBeVisible();
  // Guest (fuera de turno) clickea su 6♣ idéntico al tope -> espejito.
  await gp.getByTestId("card-g6").click();
  // El HOST debe ver la carta del espejito VIAJANDO.
  let sawFlying = false;
  for (let i = 0; i < 20 && !sawFlying; i++) {
    if ((await hp.getByTestId("flying").count()) > 0) sawFlying = true;
    await hp.waitForTimeout(40);
  }
  await expect(hp.getByTestId("pile").getByTestId("card-g6")).toBeVisible();
  await expect(gp.getByTestId("hand").locator(".card")).toHaveCount(1);
  expect(sawFlying).toBe(true);
  await hostCtx.close();
  await guestCtx.close();
});

test("regla 2s: jugada mal muy rápida se rechaza y nadie la ve", async ({ browser }) => {
  const { hp, gp, H, G, hostCtx, guestCtx } = await setupGame(browser);
  await devSetup(hp, {
    top: { id: "T5", suit: "C", rank: "5" },
    currentPlayerId: H,
    hands: {
      [H]: [{ id: "h9", suit: "H", rank: "9" }, { id: "hx", suit: "H", rank: "10" }],
      [G]: [{ id: "gz", suit: "H", rank: "9" }],
    },
    deck: filler,
  });
  await expect(hp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  // Sin esperar: 9♥ ilegal sobre 5♣ apenas se puso la carta -> rechazo silencioso.
  await dragToPile(hp, "card-h9");
  await expect(hp.getByTestId("error")).toContainText("muy rápido");
  // La carta sigue en la mano de Host y el tope no cambió para nadie.
  await expect(hp.getByTestId("hand").locator(".card")).toHaveCount(2);
  await expect(hp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  await expect(gp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  await expect(gp.getByTestId("pile").getByTestId("card-h9")).toHaveCount(0);
  await hostCtx.close();
  await guestCtx.close();
});

test("animación: la carta del oponente viaja al centro", async ({ browser }) => {
  const { hp, gp, H, G, hostCtx, guestCtx } = await setupGame(browser);
  await devSetup(hp, {
    top: { id: "T5", suit: "C", rank: "5" },
    currentPlayerId: G, // juega Guest; Host debe ver la animación
    hands: { [H]: [{ id: "hx", suit: "H", rank: "9" }], [G]: [{ id: "g5", suit: "D", rank: "5" }, { id: "gy", suit: "H", rank: "9" }] },
    deck: filler,
  });
  await expect(hp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  await gp.evaluate(() => (window as any).__room.send("playCards", { cardIds: ["g5"], observedVersion: 0 }));
  // En la pantalla de Host aparece la carta viajando (data-testid="flying").
  await expect(hp.getByTestId("flying")).toBeVisible({ timeout: 1500 });
  // Y un glow amarillo (clase just-played) sobre el asiento del que jugó.
  await expect(hp.getByTestId(`seat-${G}`)).toHaveClass(/just-played/);
  await hostCtx.close();
  await guestCtx.close();
});

test("animación: mi jugada por click también viaja", async ({ browser }) => {
  const { hp, gp, H, hostCtx, guestCtx } = await setupGame(browser);
  await devSetup(hp, {
    top: { id: "T5", suit: "C", rank: "5" },
    currentPlayerId: H,
    hands: {
      [H]: [{ id: "h5d", suit: "D", rank: "5" }, { id: "hx", suit: "H", rank: "9" }],
      [(await gp.evaluate(() => (window as any).__room.sessionId))]: [{ id: "gx", suit: "H", rank: "8" }],
    },
    deck: filler,
  });
  await expect(hp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  // Click (no drag): en mi propia pantalla la carta debe viajar al centro.
  await hp.getByTestId("card-h5d").click();
  await expect(hp.getByTestId("flying")).toBeVisible({ timeout: 1500 });
  await hostCtx.close();
  await guestCtx.close();
});

test("UNA: glow especial sobre quien dijo UNA", async ({ browser }) => {
  const { hp, gp, H, G, hostCtx, guestCtx } = await setupGame(browser);
  await devSetup(hp, {
    top: { id: "T5", suit: "C", rank: "5" },
    currentPlayerId: G,
    hands: { [H]: [{ id: "h9", suit: "H", rank: "9" }], [G]: [{ id: "g7", suit: "C", rank: "7" }] },
    deck: filler,
  });
  await expect(hp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  // Antes de cantar UNA no hay glow de una.
  await expect(hp.getByTestId(`seat-${G}`)).not.toHaveClass(/una/);
  await gp.evaluate(() => (window as any).__room.send("sayUna"));
  // Tras cantar UNA (y con 1 carta) aparece el glow especial hasta que robe.
  await expect(hp.getByTestId(`seat-${G}`)).toHaveClass(/una/);
  await hostCtx.close();
  await guestCtx.close();
});

test("As de pic cancela el efecto de un 2", async ({ browser }) => {
  const { hp, gp, H, G, hostCtx, guestCtx } = await setupGame(browser);
  const st = () => hp.evaluate(() => {
    const r = (window as any).__room;
    return { pending: r.state.pendingDraw, current: r.state.currentPlayerId };
  });
  await devSetup(hp, {
    top: { id: "T2", suit: "C", rank: "2" },
    currentPlayerId: H,
    hands: {
      [H]: [{ id: "h2h", suit: "H", rank: "2" }, { id: "hx", suit: "D", rank: "4" }],
      [G]: [{ id: "gap", suit: "S", rank: "A" }, { id: "gy", suit: "H", rank: "9" }],
    },
    deck: filler,
  });
  await expect(hp.getByTestId("pile").getByTestId("card-T2")).toBeVisible();
  // Host juega 2♥ (efecto): el siguiente debería robar 2.
  await hp.evaluate(() => (window as any).__room.send("playCards", { cardIds: ["h2h"], observedVersion: 0 }));
  await expect.poll(async () => (await st()).pending).toBe(2);
  // Guest tira su As de pic por la UI (está resaltado): cancela el robo.
  await gp.getByTestId("card-gap").click();
  await expect.poll(async () => (await st()).pending).toBe(0);
  expect((await st()).current).toBe(G);
  // Robó 1 al tirar el As de pic: 2 (gap, gy) - gap + 1 = 2.
  await expect(gp.getByTestId("hand").locator(".card")).toHaveCount(2);
  await hostCtx.close();
  await guestCtx.close();
});

test("bot: se agrega a la mesa y juega solo en su turno", async ({ browser }) => {
  const ctx = await browser.newContext();
  const hp = await ctx.newPage();
  await hp.goto("/?e2e=1");
  await hp.getByTestId("name-input").fill("Humano");
  await hp.getByTestId("create-btn").click();
  await hp.getByTestId("room-code").waitFor();

  await hp.getByTestId("bot-plus").click();
  await expect(hp.getByTestId("bot-count")).toHaveText("1"); // el counter refleja 1 bot
  await hp.getByTestId("ready-btn").click();
  await hp.getByTestId("start-btn").click();
  await expect(hp.getByTestId("hand").locator(".card")).toHaveCount(7);

  const botId = await hp.evaluate(() => {
    let id = "";
    (window as any).__room.state.players.forEach((p: any) => { if (p.isBot) id = p.id; });
    return id;
  });
  const H = await hp.evaluate(() => (window as any).__room.sessionId);
  // Escenario: le toca al bot, con una carta legal en mano.
  await devSetup(hp, {
    top: { id: "T5", suit: "C", rank: "5" },
    currentPlayerId: botId,
    hands: { [H]: [{ id: "h9", suit: "H", rank: "9" }], [botId]: [{ id: "b5", suit: "D", rank: "5" }, { id: "bx", suit: "H", rank: "9" }] },
    deck: filler,
  });
  // El bot juega solo dentro de su demora y, en el camino, aparece la carta VIAJANDO.
  // Muestreamos desde ya (la animación es transitoria) durante unos segundos.
  let sawFlying = false;
  for (let i = 0; i < 70 && !sawFlying; i++) {
    if ((await hp.getByTestId("flying").count()) > 0) sawFlying = true;
    await hp.waitForTimeout(45);
  }
  expect(sawFlying).toBe(true);
  await expect
    .poll(async () => hp.evaluate(() => (window as any).__room.state.top.id), { timeout: 4000 })
    .not.toBe("T5");
  await ctx.close();
});

test("bots: cada uno con nombre distinto", async ({ browser }) => {
  const ctx = await browser.newContext();
  const hp = await ctx.newPage();
  await hp.goto("/?e2e=1");
  await hp.getByTestId("name-input").fill("Humano");
  await hp.getByTestId("create-btn").click();
  await hp.getByTestId("room-code").waitFor();
  await hp.getByTestId("bot-plus").click();
  await hp.getByTestId("bot-plus").click();
  await hp.getByTestId("bot-plus").click();
  await expect(hp.getByTestId("bot-count")).toHaveText("3");
  // El badge de la fila colapsada refleja el estado real del server: esperamos a
  // que los 3 bots estén efectivamente en la mesa antes de leer sus nombres.
  await expect(hp.locator(".badge.bot")).toHaveText("3");
  const names: string[] = await hp.evaluate(() => {
    const ns: string[] = [];
    (window as any).__room.state.players.forEach((p: any) => { if (p.isBot) ns.push(p.name); });
    return ns;
  });
  expect(names.length).toBe(3);
  expect(new Set(names).size).toBe(3); // todos distintos
  await ctx.close();
});

test("challenge (JODETE): jugada ilegal queda en pie y se revierte", async ({ browser }) => {
  const { hp, gp, H, G, hostCtx, guestCtx } = await setupGame(browser);
  await devSetup(hp, {
    top: { id: "T5", suit: "C", rank: "5" },
    currentPlayerId: H,
    hands: {
      [H]: [{ id: "h9", suit: "H", rank: "9" }, { id: "hx", suit: "H", rank: "10" }],
      [G]: [{ id: "gz", suit: "H", rank: "9" }],
    },
    deck: filler,
  });
  // Esperar el patch: Host ve el tope 5♣.
  await expect(hp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  // Dejar pasar la ventana de 2s (900ms en tests) para que la jugada mal quede en pie.
  await hp.waitForTimeout(1200);
  // Host juega 9♥ (ilegal sobre 5♣). En modo permisivo, queda en pie.
  await dragToPile(hp, "card-h9");
  await expect(hp.getByTestId("pile").getByTestId("card-h9")).toBeVisible();
  // Guest grita JODETE -> rollback: vuelve el 5♣ y Host roba 3 (2 + 3 = 5).
  await gp.getByTestId("jodete-btn").click();
  await expect(hp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  await expect(hp.getByTestId("hand").locator(".card")).toHaveCount(5);
  await hostCtx.close();
  await guestCtx.close();
});

test("8 diferido: la carta se juega YA y el modal de palo aparece después", async ({ browser }) => {
  const { hp, gp, H, G, hostCtx, guestCtx } = await setupGame(browser);
  await devSetup(hp, {
    top: { id: "T5", suit: "C", rank: "5" },
    currentPlayerId: H,
    hands: {
      [H]: [{ id: "h8", suit: "H", rank: "8" }, { id: "hx", suit: "S", rank: "9" }],
      [G]: [{ id: "gz", suit: "D", rank: "4" }],
    },
    deck: filler,
  });
  await expect(hp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  // Host juega el 8♥: la carta baja al pozo AL INSTANTE (antes de elegir palo) y
  // el Guest ya la ve; recién entonces aparece el modal de palo para el Host.
  await hp.getByTestId("card-h8").dblclick();
  await expect(hp.getByTestId("pile").getByTestId("card-h8")).toBeVisible();
  await expect(gp.getByTestId("pile").getByTestId("card-h8")).toBeVisible();
  // Palo abierto para todos + modal para el Host.
  await expect(gp.getByTestId("suit-open")).toBeVisible();
  await expect(hp.getByTestId("suit-H")).toBeVisible();
  // El Host elige corazones -> palo en vigor y modal cerrado.
  await hp.getByTestId("suit-H").click();
  await expect(hp.getByTestId("active-suit")).toBeVisible();
  await expect(gp.getByTestId("suit-open")).toHaveCount(0);
  await hostCtx.close();
  await guestCtx.close();
});

test("8 diferido: el siguiente tira cualquier palo con el palo abierto y gana la carrera", async ({ browser }) => {
  const { hp, gp, H, G, hostCtx, guestCtx } = await setupGame(browser);
  await devSetup(hp, {
    top: { id: "T5", suit: "C", rank: "5" },
    currentPlayerId: H,
    hands: {
      [H]: [{ id: "h8", suit: "H", rank: "8" }, { id: "hx", suit: "S", rank: "9" }],
      // Guest tiene un 7♦: sin palo abierto sería ilegal sobre un 8♥, pero con
      // el palo abierto vale.
      [G]: [{ id: "g7d", suit: "D", rank: "7" }],
    },
    deck: filler,
  });
  await expect(hp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  await hp.getByTestId("card-h8").dblclick();
  await expect(gp.getByTestId("suit-open")).toBeVisible();
  // Ahora es turno del Guest (el 8 saltea el turno hacia él). Tira su 7♦: válido
  // por el palo abierto. Gana la carrera y define el palo.
  await gp.waitForTimeout(1100); // pasar la ventana de permanencia (900ms en tests)
  await dragToPile(gp, "card-g7d");
  await expect(gp.getByTestId("pile").getByTestId("card-g7d")).toBeVisible();
  await expect(hp.getByTestId("pile").getByTestId("card-g7d")).toBeVisible();
  // El palo dejó de estar abierto y el modal del Host desapareció (perdió la elección).
  await expect(hp.getByTestId("suit-open")).toHaveCount(0);
  await expect(hp.getByTestId("suit-h")).toHaveCount(0);
  await hostCtx.close();
  await guestCtx.close();
});

test("robar: clic en el mazo roba una carta", async ({ browser }) => {
  const { hp, gp, H, G, hostCtx, guestCtx } = await setupGame(browser);
  await devSetup(hp, {
    top: { id: "T5", suit: "C", rank: "5" },
    currentPlayerId: H,
    hands: {
      [H]: [{ id: "hx", suit: "S", rank: "9" }],
      [G]: [{ id: "gz", suit: "D", rank: "4" }],
    },
    deck: filler,
  });
  await expect(hp.getByTestId("pile").getByTestId("card-T5")).toBeVisible();
  await expect(hp.getByTestId("hand").locator(".card")).toHaveCount(1);
  // Clic en el mazo -> roba 1 (sin usar el botón Robar).
  await hp.getByTestId("deck").click();
  await expect(hp.getByTestId("hand").locator(".card")).toHaveCount(2);
  await hostCtx.close();
  await guestCtx.close();
});
