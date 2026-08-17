// Reporte de una iteración + comparación contra la anterior (el DIFF: ¿mejoramos?).
// Uso: node design-loop/harness/report.ts [runId]
import { LoopDB } from "./db.ts";
import { DIMENSIONS } from "./rubric.ts";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const db = new LoopDB(join(ROOT, "loop.db"));
const runId = Number(process.argv[2] ?? db.latestRun() ?? 0);
if (!runId) { console.log("No hay runs todavía."); process.exit(0); }

const hist = db.scoreHistory(runId);
console.log(`\n═══ Run ${runId} · ${hist.length} iteración(es) ═══\n`);
console.log("  N | compuesto | objetivas | Δ compuesto");
console.log("  --+-----------+-----------+------------");
let prev: number | null = null;
for (const it of hist) {
  const c = it.composite_score, o = it.objective_pass;
  const delta = c != null && prev != null ? (c - prev >= 0 ? "+" : "") + (c - prev).toFixed(3) : "—";
  console.log(`  ${String(it.n).padStart(2)} | ${c != null ? c.toFixed(3) : "  —  "}     | ${o != null ? (o * 100).toFixed(0) + "%" : " — "}       | ${delta}`);
  if (c != null) prev = c;
}

// Rendimientos decrecientes: últimas 2 mejoras < epsilon
const EPS = 0.05;
const scored = hist.filter((h) => h.composite_score != null);
if (scored.length >= 3) {
  const [a, b, c] = scored.slice(-3).map((h) => h.composite_score!);
  const d1 = b - a, d2 = c - b;
  console.log(`\nÚltimas mejoras: ${d1.toFixed(3)}, ${d2.toFixed(3)} (epsilon=${EPS})`);
  if (d1 < EPS && d2 < EPS) console.log("→ EXIT sugerido: rendimientos decrecientes.");
}

// Dimensiones de la última iteración (para saber en qué enfocar el próximo fix)
const lastIter = (db.db.prepare("SELECT id FROM iterations WHERE run_id=? ORDER BY n DESC LIMIT 1").get(runId) as any)?.id;
if (lastIter) {
  const avgs = db.dimensionAverages(lastIter);
  if (avgs.length) {
    console.log(`\nDimensiones (última iteración, peor→mejor):`);
    for (const a of avgs) {
      const label = DIMENSIONS.find((d) => d.key === a.dimension)?.label ?? a.dimension;
      console.log(`  ${a.avg.toFixed(2)}  ${label}`);
    }
  }
  const issues = db.db.prepare("SELECT severity, COUNT(*) n FROM issues WHERE iteration_id=? GROUP BY severity").all(lastIter) as any[];
  if (issues.length) console.log(`\nIssues: ${issues.map((i) => `${i.n} ${i.severity}`).join(", ")}`);
  const failObj = db.db.prepare("SELECT moment, viewport, metric, detail FROM objective WHERE iteration_id=? AND pass=0 ORDER BY metric").all(lastIter) as any[];
  if (failObj.length) {
    console.log(`\nObjetivas falladas (${failObj.length}):`);
    for (const f of failObj.slice(0, 20)) console.log(`  ✗ ${f.metric} · ${f.viewport}/${f.moment} ${f.detail ? "· " + f.detail : ""}`);
    if (failObj.length > 20) console.log(`  … y ${failObj.length - 20} más`);
  }
}
console.log("");
