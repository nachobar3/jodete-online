// DB interna del design-loop. node:sqlite (built-in en Node 22+), sin dependencias.
// Guarda cada iteración: scores subjetivos, métricas objetivas, issues y artifacts,
// para poder responder "¿estamos mejorando?" con una query.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Severity = "critical" | "major" | "minor";
export type IssueStatus = "found" | "fixed" | "wontfix" | "regressed";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  exit_reason   TEXT,
  config_json   TEXT
);
CREATE TABLE IF NOT EXISTS iterations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          INTEGER NOT NULL REFERENCES runs(id),
  n               INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  composite_score REAL,
  objective_pass  REAL,          -- fracción de checks objetivos que pasaron
  summary         TEXT
);
CREATE TABLE IF NOT EXISTS artifacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iterations(id),
  moment       TEXT NOT NULL,
  viewport     TEXT NOT NULL,
  kind         TEXT NOT NULL,    -- png | video | trace
  path         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iterations(id),
  moment       TEXT NOT NULL,
  viewport     TEXT NOT NULL,
  dimension    TEXT NOT NULL,
  value        REAL NOT NULL,    -- 1..5
  note         TEXT
);
CREATE TABLE IF NOT EXISTS objective (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iterations(id),
  moment       TEXT NOT NULL,
  viewport     TEXT NOT NULL,
  metric       TEXT NOT NULL,
  value        REAL,
  pass         INTEGER NOT NULL, -- 0/1
  detail       TEXT
);
CREATE TABLE IF NOT EXISTS issues (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iterations(id),
  title        TEXT NOT NULL,
  detail       TEXT,
  severity     TEXT NOT NULL,
  effort       TEXT,             -- low | med | high
  dimension    TEXT,
  moment       TEXT,
  viewport     TEXT,
  status       TEXT NOT NULL DEFAULT 'found',
  fix_note     TEXT
);
`;

export class LoopDB {
  db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  startRun(config: unknown, startedAt: string): number {
    const r = this.db
      .prepare("INSERT INTO runs (started_at, config_json) VALUES (?, ?)")
      .run(startedAt, JSON.stringify(config));
    return Number(r.lastInsertRowid);
  }

  endRun(runId: number, reason: string, endedAt: string) {
    this.db.prepare("UPDATE runs SET ended_at=?, exit_reason=? WHERE id=?").run(endedAt, reason, runId);
  }

  createIteration(runId: number, n: number, createdAt: string): number {
    const r = this.db
      .prepare("INSERT INTO iterations (run_id, n, created_at) VALUES (?, ?, ?)")
      .run(runId, n, createdAt);
    return Number(r.lastInsertRowid);
  }

  addArtifact(iterId: number, moment: string, viewport: string, kind: string, path: string) {
    this.db
      .prepare("INSERT INTO artifacts (iteration_id, moment, viewport, kind, path) VALUES (?,?,?,?,?)")
      .run(iterId, moment, viewport, kind, path);
  }

  addObjective(iterId: number, moment: string, viewport: string, metric: string, value: number | null, pass: boolean, detail?: string) {
    this.db
      .prepare("INSERT INTO objective (iteration_id, moment, viewport, metric, value, pass, detail) VALUES (?,?,?,?,?,?,?)")
      .run(iterId, moment, viewport, metric, value, pass ? 1 : 0, detail ?? null);
  }

  addScore(iterId: number, moment: string, viewport: string, dimension: string, value: number, note?: string) {
    this.db
      .prepare("INSERT INTO scores (iteration_id, moment, viewport, dimension, value, note) VALUES (?,?,?,?,?,?)")
      .run(iterId, moment, viewport, dimension, value, note ?? null);
  }

  addIssue(iterId: number, i: { title: string; detail?: string; severity: Severity; effort?: string; dimension?: string; moment?: string; viewport?: string; status?: IssueStatus; fix_note?: string }) {
    this.db
      .prepare("INSERT INTO issues (iteration_id, title, detail, severity, effort, dimension, moment, viewport, status, fix_note) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(iterId, i.title, i.detail ?? null, i.severity, i.effort ?? null, i.dimension ?? null, i.moment ?? null, i.viewport ?? null, i.status ?? "found", i.fix_note ?? null);
  }

  finalizeIteration(iterId: number, composite: number | null, objectivePass: number | null, summary: string) {
    this.db
      .prepare("UPDATE iterations SET composite_score=?, objective_pass=?, summary=? WHERE id=?")
      .run(composite, objectivePass, summary, iterId);
  }

  // Para el DIFF: score compuesto por iteración de un run.
  scoreHistory(runId: number): { n: number; composite_score: number | null; objective_pass: number | null }[] {
    return this.db
      .prepare("SELECT n, composite_score, objective_pass FROM iterations WHERE run_id=? ORDER BY n")
      .all(runId) as any;
  }

  // Promedio por dimensión de una iteración (para ver qué dimensión sube/baja).
  dimensionAverages(iterId: number): { dimension: string; avg: number }[] {
    return this.db
      .prepare("SELECT dimension, AVG(value) as avg FROM scores WHERE iteration_id=? GROUP BY dimension ORDER BY avg")
      .all(iterId) as any;
  }

  latestRun(): number | null {
    const r = this.db.prepare("SELECT id FROM runs ORDER BY id DESC LIMIT 1").get() as any;
    return r ? Number(r.id) : null;
  }
}
