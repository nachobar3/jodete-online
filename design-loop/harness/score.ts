// Persiste los puntajes del juez de visión y calcula el compuesto de la iteración.
// Uso: node design-loop/harness/score.ts <path-al-json>
// JSON: { iterId, cells:[{moment,viewport,dims:{turn_clarity:4,...},note?}], issues?:[...] }
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { LoopDB } from "./db.ts";
import { composite, DIMENSION_KEYS } from "./rubric.ts";

const ROOT = resolve(import.meta.dirname, "..");
const db = new LoopDB(join(ROOT, "loop.db"));
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const iterId: number = input.iterId;
if (!iterId) throw new Error("falta iterId");

const cellComposites: number[] = [];
for (const cell of input.cells ?? []) {
  const dims: Record<string, number> = cell.dims ?? {};
  for (const k of DIMENSION_KEYS) {
    if (dims[k] == null) continue;
    db.addScore(iterId, cell.moment, cell.viewport, k, dims[k], cell.note);
  }
  if (Object.keys(dims).length) cellComposites.push(composite(dims));
}
for (const iss of input.issues ?? []) {
  db.addIssue(iterId, iss);
}

const comp = cellComposites.length ? cellComposites.reduce((a, b) => a + b, 0) / cellComposites.length : null;
// preservar objective_pass ya calculado
const row = db.db.prepare("SELECT objective_pass, summary FROM iterations WHERE id=?").get(iterId) as any;
db.finalizeIteration(iterId, comp, row?.objective_pass ?? null, row?.summary ?? "");
console.log(`Iteración ${iterId}: compuesto=${comp != null ? comp.toFixed(3) : "—"} (${cellComposites.length} celdas, ${(input.issues ?? []).length} issues)`);
