import { test } from "@playwright/test";

const filler = (n: number, p: string) =>
  Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, suit: "D", rank: "3" }));

test("screenshot mesa 3 jugadores", async ({ browser }) => {
  const ctxs = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: { width: 1040, height: 780 } })));
  const [hp, ap, bp] = await Promise.all(ctxs.map((c) => c.newPage()));

  await hp.goto("/?e2e=1");
  await hp.getByTestId("name-input").fill("Vos");
  await hp.getByTestId("create-btn").click();
  const code = (await hp.getByTestId("room-code").textContent())!.trim();

  for (const [pg, nm] of [[ap, "Walter"], [bp, "Ana"]] as const) {
    await pg.goto("/?e2e=1");
    await pg.getByTestId("name-input").fill(nm);
    await pg.getByTestId("code-input").fill(code);
    await pg.getByTestId("join-btn").click();
  }
  await hp.getByTestId("ready-btn").click();
  await ap.getByTestId("ready-btn").click();
  await bp.getByTestId("ready-btn").click();
  await hp.getByTestId("start-btn").click();
  await hp.getByTestId("hand").locator(".card").first().waitFor();

  const ids = await hp.evaluate(() => {
    const r = (window as any).__room;
    const players: string[] = [];
    r.state.players.forEach((p: any) => players.push(p.id));
    return { me: r.sessionId, players };
  });
  const H = ids.me as string;
  const [A, B] = ids.players.filter((x: string) => x !== H);

  await hp.evaluate((s) => (window as any).__room.send("__setup", s), {
    top: { id: "TOP", suit: "S", rank: "7" },
    currentPlayerId: H,
    hands: {
      [H]: [
        { id: "cAs", suit: "S", rank: "A" }, { id: "cKs", suit: "S", rank: "K" },
        { id: "cQs", suit: "S", rank: "Q" }, { id: "cJs", suit: "S", rank: "J" },
        { id: "c10s", suit: "S", rank: "10" }, { id: "c7h", suit: "H", rank: "7" },
        { id: "c2d", suit: "D", rank: "2" },
      ],
      [A]: filler(4, "a"),
      [B]: filler(2, "b"),
    },
    deck: filler(30, "z"),
  });

  await hp.getByTestId("pile").getByTestId("card-TOP").waitFor();
  await hp.waitForTimeout(400);
  await hp.screenshot({ path: "test-results/mesa.png" });

  // Tras 10s aparece el glow del turno (acá, en mi mano, porque soy el current).
  await hp.waitForTimeout(10300);
  await hp.screenshot({ path: "test-results/mesa-turno.png" });

  for (const c of ctxs) await c.close();
});
