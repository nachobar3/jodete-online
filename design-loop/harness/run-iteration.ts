// Orquesta UNA iteración: recorre viewports × momentos, saca PNG/video, corre los
// checks objetivos y escribe todo en la DB + un manifest.json que consume el juez.
// Uso: node design-loop/harness/run-iteration.ts <N> [--run <runId>]
import { chromium, type Browser } from "@playwright/test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { join, resolve } from "node:path";
import { LoopDB } from "./db.ts";
import { VIEWPORTS } from "./viewports.ts";
import { MOMENTS } from "./moments.ts";
import { runObjectives } from "./objective.ts";
import { createTable } from "./table.ts";

const ROOT = resolve(import.meta.dirname, "..");           // design-loop/
const REPO = resolve(ROOT, "..");                          // repo root
const DB_PATH = join(ROOT, "loop.db");
// Puertos dedicados para no colisionar con otros dev servers del sistema.
const CLIENT_PORT = process.env.JODETE_CLIENT_PORT ?? "5273";
const SERVER_PORT = process.env.JODETE_SERVER_PORT ?? "2577";
const URL = process.env.JODETE_URL ?? `http://localhost:${CLIENT_PORT}`;
process.env.JODETE_URL = URL; // que table.ts use el mismo origin

const N = Number(process.argv[2] ?? "0");
// Filtros opcionales para smoke tests: JODETE_VIEWPORTS=desktop JODETE_MOMENTS=lobby,tu-turno
const vpFilter = process.env.JODETE_VIEWPORTS?.split(",");
const momFilter = process.env.JODETE_MOMENTS?.split(",");
const runArgIdx = process.argv.indexOf("--run");
const RUN_ID_ARG = runArgIdx > -1 ? Number(process.argv[runArgIdx + 1]) : null;

async function reachable(url: string): Promise<boolean> {
  try { const r = await fetch(url); return r.ok || r.status < 500; } catch { return false; }
}

async function ensureServer(): Promise<ChildProcess[]> {
  if (process.env.JODETE_NO_SPAWN) { console.log(`· usando server externo en ${URL}`); return []; }
  console.log(`· levantando jodete (client :${CLIENT_PORT}, server :${SERVER_PORT})…`);
  const env = {
    ...process.env,
    PORT: SERVER_PORT,
    VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}`,
    JODETE_TEST: "1", JODETE_PERMANENCIA_MS: "900", JODETE_TURN_TIMEOUT_MS: "60000", JODETE_BOT_DELAY_MS: "300",
  };
  const server = spawn("pnpm", ["--filter", "@jodete/server", "dev"], { cwd: REPO, env, stdio: "ignore" });
  const client = spawn("pnpm", ["--filter", "@jodete/client", "exec", "vite", "--port", CLIENT_PORT, "--strictPort"], { cwd: REPO, env, stdio: "ignore" });
  for (let i = 0; i < 90; i++) { if (await reachable(URL)) { await sleep(1500); console.log("· dev server listo"); return [server, client]; } await sleep(1000); }
  server.kill(); client.kill();
  throw new Error("dev server no respondió en 90s");
}

async function main() {
  const db = new LoopDB(DB_PATH);
  const viewports = vpFilter ? VIEWPORTS.filter((v) => vpFilter.includes(v.name)) : VIEWPORTS;
  const moments = momFilter ? MOMENTS.filter((m) => momFilter.includes(m.key)) : MOMENTS;
  const runId = RUN_ID_ARG ?? db.startRun({ viewports: viewports.map((v) => v.name), moments: moments.map((m) => m.key) }, new Date().toISOString());
  const iterId = db.createIteration(runId, N, new Date().toISOString());
  const iterDir = join(ROOT, "iterations", String(N));
  mkdirSync(iterDir, { recursive: true });

  const server = await ensureServer();
  const browser: Browser = await chromium.launch();

  const manifest: any = { run: runId, iteration: N, iterId, cells: [] };
  let objPass = 0, objTotal = 0;

  try {
    for (const vp of viewports) {
      const vpDir = join(iterDir, vp.name);
      mkdirSync(vpDir, { recursive: true });

      for (const m of moments) {
        const videoDir = m.video ? join(vpDir, `${m.key}-video`) : undefined;
        const t = await createTable(browser, vp, m.players, videoDir);
        let consoleErrors = 0;
        for (const pg of t.pages) {
          pg.on("pageerror", () => consoleErrors++);
          pg.on("console", (msg) => { if (msg.type() === "error") consoleErrors++; });
        }

        const cell: any = { moment: m.key, viewport: vp.name, ok: true, objectives: [] };
        try {
          const shot = await m.build(t);
          const png = join(vpDir, `${m.key}.png`);
          await t.pages[shot].screenshot({ path: png });
          db.addArtifact(iterId, m.key, vp.name, "png", png);
          cell.png = png;

          const objs = await runObjectives(t.pages[shot], vp, consoleErrors);
          for (const o of objs) {
            db.addObjective(iterId, m.key, vp.name, o.metric, o.value, o.pass, o.detail);
            objTotal++; if (o.pass) objPass++;
          }
          cell.objectives = objs;

          if (videoDir) {
            const vpath = await t.pages[shot].video()?.path().catch(() => null);
            await t.close();
            if (vpath && existsSync(vpath)) { db.addArtifact(iterId, m.key, vp.name, "video", vpath); cell.video = vpath; }
          } else {
            await t.close();
          }
          console.log(`  ✓ ${vp.name}/${m.key}  (${objs.filter((o) => o.pass).length}/${objs.length} obj)`);
        } catch (e: any) {
          cell.ok = false; cell.error = String(e?.message ?? e);
          await t.close().catch(() => {});
          db.addObjective(iterId, m.key, vp.name, "moment_reachable", 0, false, cell.error);
          objTotal++;
          const mark = m.optional ? "○ (opcional)" : "✗";
          console.log(`  ${mark} ${vp.name}/${m.key}: ${cell.error.split("\n")[0]}`);
        }
        manifest.cells.push(cell);
      }
    }
  } finally {
    await browser.close();
    for (const p of server) p.kill();
  }

  const objFrac = objTotal ? objPass / objTotal : null;
  db.finalizeIteration(iterId, null, objFrac, `objetivas ${objPass}/${objTotal}`);
  manifest.objective_pass = objFrac;
  writeFileSync(join(iterDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\nIteración ${N} lista. Objetivas: ${objPass}/${objTotal}${objFrac != null ? ` (${(objFrac * 100).toFixed(0)}%)` : ""}`);
  console.log(`Assets: ${iterDir}`);
  console.log(`Manifest: ${join(iterDir, "manifest.json")}  ·  runId=${runId} iterId=${iterId}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
