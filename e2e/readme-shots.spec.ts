import { test } from "@playwright/test";

// Capturas para el README: pantalla de inicio y lobby con bots.
test("screenshots inicio + lobby", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1040, height: 780 } });
  const pg = await ctx.newPage();

  // 1) Inicio: crear / unirse por código
  await pg.goto("/?e2e=1");
  await pg.getByTestId("name-input").fill("Walter");
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: "test-results/inicio.png" });

  // 2) Lobby con bots (host)
  await pg.getByTestId("create-btn").click();
  await pg.getByTestId("room-code").waitFor();
  // Sumar 3 bots para que la mesa se vea poblada.
  for (let i = 0; i < 3; i++) await pg.getByTestId("bot-plus").click();
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: "test-results/lobby.png" });

  await ctx.close();
});
