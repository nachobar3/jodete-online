// Arma una mesa real (host + N guests) sobre el server Colyseus de dev, y expone
// helpers para sembrar estado (__setup) y guionar acciones por la UI o por mensajes.
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { Viewport } from "./viewports.ts";

export interface Card { id: string; suit: string; rank: string }

export interface Table {
  contexts: BrowserContext[];
  pages: Page[];          // [host, guest1, guest2, ...]
  ids: string[];          // sessionIds alineados con pages
  hostId: string;
  code: string;
  send: (pageIdx: number, type: string, payload?: unknown) => Promise<void>;
  state: (pageIdx?: number) => Promise<any>;
  close: () => Promise<void>;
}

const ORIGIN = process.env.JODETE_URL ?? "http://localhost:5173";
const BASE = `${ORIGIN}/?e2e=1`;

// n = total de jugadores (incluye host). Si recordVideoDir, graba video de cada contexto.
export async function createTable(browser: Browser, vp: Viewport, n: number, recordVideoDir?: string): Promise<Table> {
  const viewport = { width: vp.width, height: vp.height };
  const ctxOpts = recordVideoDir
    ? { viewport, recordVideo: { dir: recordVideoDir, size: viewport } }
    : { viewport };

  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  const hostCtx = await browser.newContext(ctxOpts);
  contexts.push(hostCtx);
  const host = await hostCtx.newPage();
  pages.push(host);
  await host.goto(BASE);
  await host.getByTestId("name-input").fill("Vos");
  await host.getByTestId("create-btn").click();
  const code = (await host.getByTestId("room-code").textContent())!.trim();

  const names = ["Walter", "Ana", "Beto", "Caro", "Deb", "Edu", "Fran"];
  for (let i = 1; i < n; i++) {
    const ctx = await browser.newContext(ctxOpts);
    contexts.push(ctx);
    const pg = await ctx.newPage();
    pages.push(pg);
    await pg.goto(BASE);
    await pg.getByTestId("name-input").fill(names[i - 1]);
    await pg.getByTestId("code-input").fill(code);
    await pg.getByTestId("join-btn").click();
  }

  const send = (idx: number, type: string, payload?: unknown) =>
    pages[idx].evaluate((a) => (window as any).__room.send(a.type, a.payload), { type, payload: payload ?? {} });

  const state = (idx = 0) =>
    pages[idx].evaluate(() => {
      const r = (window as any).__room;
      return {
        phase: r.state.phase,
        current: r.state.currentPlayerId,
        top: r.state.top?.id,
        topRank: r.state.top?.rank,
        topSuit: r.state.top?.suit,
        activeSuit: r.state.activeSuit,
        pendingDraw: r.state.pendingDraw,
        sessionId: r.sessionId,
      };
    });

  const close = async () => { for (const c of contexts) await c.close().catch(() => {}); };

  return { contexts, pages, ids: [], hostId: "", code, send, state, close } as Table;
}

// Lleva la mesa hasta 'playing' (ready + start) y captura los sessionIds ordenados.
export async function startGame(t: Table): Promise<void> {
  for (const pg of t.pages) await pg.getByTestId("ready-btn").click();
  await t.pages[0].getByTestId("start-btn").click();
  await t.pages[0].getByTestId("hand").locator(".card").first().waitFor();
  const ids: string[] = [];
  for (const pg of t.pages) ids.push(await pg.evaluate(() => (window as any).__room.sessionId));
  t.ids = ids;
  t.hostId = ids[0];
}

// Siembra estado determinístico. hands: por índice de jugador (0=host).
export async function seed(t: Table, opts: {
  top: Card;
  handsByIdx: Record<number, Card[]>;
  currentIdx?: number;
  deckN?: number;
  activeSuit?: string;
  direction?: 1 | -1;
}): Promise<void> {
  const hands: Record<string, Card[]> = {};
  for (const [idx, cards] of Object.entries(opts.handsByIdx)) hands[t.ids[Number(idx)]] = cards;
  const deck = Array.from({ length: opts.deckN ?? 30 }, (_, i) => ({ id: `z${i}`, suit: "D", rank: "3" }));
  const setup: any = {
    top: opts.top,
    hands,
    deck,
    turnOrder: t.ids,
    currentPlayerId: t.ids[opts.currentIdx ?? 0],
    direction: opts.direction ?? 1,
  };
  if (opts.activeSuit) setup.activeSuit = opts.activeSuit;
  await t.send(0, "__setup", setup);
  // esperar a que el tope sembrado esté en la pila
  await t.pages[0].getByTestId("pile").getByTestId(`card-${opts.top.id}`).waitFor();
}

// helpers de mano
export const hand = (...cards: [string, string, string][]): Card[] =>
  cards.map(([id, suit, rank]) => ({ id, suit, rank }));
export const filler = (n: number, p: string): Card[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, suit: "D", rank: "3" }));
