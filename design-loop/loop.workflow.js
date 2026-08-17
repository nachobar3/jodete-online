export const meta = {
  name: "jodete-design-loop",
  description: "Loop autónomo de mejora visual de Jodete: captura mesas en varios viewports, juzga por rúbrica, arregla el cliente y compara iteraciones hasta rendimientos decrecientes.",
  whenToUse: "Cuando se quiere iterar la UI/UX de Jodete de forma autónoma con evidencia visual y métricas.",
  phases: [
    { title: "Capture", detail: "run.sh: siembra momentos × viewports, PNG/video + objetivas" },
    { title: "Judge", detail: "un agente de visión por viewport puntúa la rúbrica" },
    { title: "Persist", detail: "score.ts + report.ts: compuesto y diff vs iteración previa" },
    { title: "Compliance", detail: "verifica los [MUST] de GUIDELINES.md; bloquea el exit si alguno falla" },
    { title: "Fix", detail: "un agente arreglador aplica los top issues al cliente" },
  ],
};

// args: { startIter?: number, maxIter?: number, thresholdComposite?: number, epsilon?: number }
const startIter = args?.startIter ?? 0;
const maxIter = args?.maxIter ?? 6;
const TH = args?.thresholdComposite ?? 4.2;
const EPS = args?.epsilon ?? 0.05;
// Subconjunto de viewports para el loop autónomo (mantiene cada captura bajo el límite de
// tiempo del agente). Cubre mobile vertical, tablet y desktop.
const VIEWPORTS = ["mobile-portrait", "tablet", "desktop"];

const SCORE_SCHEMA = {
  type: "object",
  required: ["viewport", "cells"],
  properties: {
    viewport: { type: "string" },
    cells: {
      type: "array",
      items: {
        type: "object",
        required: ["moment", "dims"],
        properties: {
          moment: { type: "string" },
          dims: {
            type: "object",
            description: "Cada dimensión 1..5",
            properties: {
              turn_clarity: { type: "number" }, affordance: { type: "number" }, hierarchy: { type: "number" },
              legibility: { type: "number" }, feedback: { type: "number" }, mobile_ergonomics: { type: "number" },
              aesthetics: { type: "number" }, typography: { type: "number" },
            },
          },
          note: { type: "string" },
          issues: {
            type: "array",
            items: {
              type: "object",
              required: ["title", "severity"],
              properties: {
                title: { type: "string" }, detail: { type: "string" },
                severity: { enum: ["critical", "major", "minor"] },
                effort: { enum: ["low", "med", "high"] },
                dimension: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

const CAPTURE_SCHEMA = {
  type: "object",
  required: ["iterId", "objectivePass", "ok"],
  properties: {
    iterId: { type: "number" }, runId: { type: "number" }, objectivePass: { type: "number" },
    ok: { type: "boolean" }, note: { type: "string" },
  },
};

const COMPLIANCE_SCHEMA = {
  type: "object",
  required: ["allMustPass", "items"],
  properties: {
    allMustPass: { type: "boolean" },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "status"],
        properties: {
          id: { type: "string" },                         // G1..G13
          status: { enum: ["pass", "fail", "unverifiable"] },
          note: { type: "string" },
        },
      },
    },
  },
};

const REPORT_SCHEMA = {
  type: "object",
  required: ["composite"],
  properties: {
    composite: { type: "number" },
    objectivePass: { type: "number" },
    diminishing: { type: "boolean" },
    worstDimensions: { type: "array", items: { type: "string" } },
    topIssues: { type: "array", items: { type: "string" } },
  },
};

const history = [];
let exitReason = "maxIter";

for (let n = startIter; n < startIter + maxIter; n++) {
  phase("Capture");
  const cap = await agent(
    `Ejecutá el capture de la iteración ${n} del design-loop de Jodete con estos 3 viewports:\n` +
    `\`JODETE_VIEWPORTS=mobile-portrait,tablet,desktop bash design-loop/run.sh ${n}\`\n` +
    `IMPORTANTE: usá la Bash tool con dangerouslyDisableSandbox=true y timeout 590000 (levanta dev servers y un browser headless; el sandbox los mata).\n` +
    `Cuando termine, leé design-loop/iterations/${n}/manifest.json y devolvé iterId, runId, objectivePass y ok (true si terminó sin error fatal y hay PNGs).`,
    { phase: "Capture", schema: CAPTURE_SCHEMA, label: `capture:iter${n}` }
  );
  if (!cap || !cap.ok) { exitReason = `capture-failed@${n}`; break; }

  phase("Judge");
  const judged = await parallel(
    VIEWPORTS.map((vp) => () =>
      agent(
        `Sos juez de UX/diseño de un juego de cartas de VELOCIDAD (Jodete). Mirá TODOS los PNG de ` +
        `design-loop/iterations/${n}/${vp}/ (usá Read en cada .png).\n` +
        `Para cada momento (nombre = archivo sin .png) puntuá 1..5 estas dimensiones:\n` +
        `- turn_clarity: en 1s, ¿se sabe de quién es el turno?\n- affordance: ¿se distingue qué cartas puedo jugar?\n` +
        `- hierarchy: ¿el ojo va a lo importante?\n- legibility: palos/números claros a este tamaño\n` +
        `- feedback: espejito/challenge/UNA/robo/error, ¿se entienden?\n- mobile_ergonomics: alcance del pulgar, nada crítico en bordes (para mobile/tablet)\n` +
        `- aesthetics: cohesión de paleta/spacing\n- typography: jerarquía y tamaños tipográficos\n` +
        `Sé exigente y consistente entre iteraciones. Anotá issues accionables con severity/effort/dimension.\n` +
        `Viewport = ${vp}. Si un archivo no existe, omití ese momento.`,
        { phase: "Judge", schema: SCORE_SCHEMA, label: `judge:${vp}`, agentType: "Explore" }
      )
    )
  );

  phase("Persist");
  const cells = [];
  const issues = [];
  for (const j of judged.filter(Boolean)) {
    for (const c of j.cells ?? []) {
      cells.push({ moment: c.moment, viewport: j.viewport, dims: c.dims, note: c.note });
      for (const is of c.issues ?? []) issues.push({ ...is, moment: c.moment, viewport: j.viewport });
    }
  }
  const scoresPath = `design-loop/iterations/${n}/scores.json`;
  await agent(
    `Escribí este JSON EXACTO en ${scoresPath} y después ejecutá \`node design-loop/harness/score.ts ${scoresPath}\` ` +
    `y \`node design-loop/harness/report.ts\`. Devolvé el compuesto, objectivePass, si hay rendimientos decrecientes (diminishing), ` +
    `las peores dimensiones y los top issues.\n\nJSON:\n` +
    JSON.stringify({ iterId: cap.iterId, cells, issues }, null, 2),
    { phase: "Persist", schema: REPORT_SCHEMA, label: `persist:iter${n}` }
  ).then((rep) => {
    history.push({ n, composite: rep?.composite ?? null, objectivePass: cap.objectivePass, worst: rep?.worstDimensions, topIssues: rep?.topIssues });
  });

  const cur = history[history.length - 1];
  log(`Iteración ${n}: compuesto=${cur.composite?.toFixed?.(3) ?? "—"} · objetivas=${(cap.objectivePass * 100).toFixed(0)}% · issues=${issues.length}`);

  // COMPLIANCE — verifica los [MUST] de la guía; su fallo BLOQUEA el exit por calidad
  phase("Compliance");
  const comp = await agent(
    `Sos auditor de compliance del design-loop de Jodete. Leé design-loop/GUIDELINES.md y verificá CADA ítem [MUST] (G1..G13).\n` +
    `Para los VISUALES (G1, G2, G3, G4, G6, G7, G8, G13): usá Read sobre los PNG y videos de design-loop/iterations/${n}/<viewport>/ y design-loop/iterations/${n}/scores.json.\n` +
    `Para las REGLAS (G9, G10, G11, G12) y latencia (G5): NO corras e2e; usá el estado ya verificado en design-loop/CHANGELOG.md ` +
    `(G11 pass, G12 pass, G5 ok, G9 fail, G10 fail) salvo que un fix de esta iteración haya tocado server/src (revisá si cambió).\n` +
    `Para cada Gxx devolvé status: "pass", "fail" o "unverifiable". allMustPass = true SOLO si ningún MUST está en "fail". Si dudás, es fail.`,
    { phase: "Compliance", schema: COMPLIANCE_SCHEMA, label: `compliance:iter${n}`, agentType: "Explore" }
  );
  cur.compliance = comp;
  const mustFails = (comp?.items ?? []).filter((i) => i.status === "fail");
  if (mustFails.length) log(`⚠ Compliance: ${mustFails.length} MUST en fail → ${mustFails.map((i) => i.id).join(", ")}`);

  // EXIT criteria
  const criticals = issues.filter((i) => i.severity === "critical").length;
  if (cur.composite != null && cur.composite >= TH && criticals === 0 && cap.objectivePass >= 1 && comp?.allMustPass) {
    exitReason = `calidad-alcanzada@${n} (compuesto ${cur.composite.toFixed(2)}, guía OK)`; break;
  }
  const comps = history.map((h) => h.composite).filter((x) => x != null);
  if (comps.length >= 3 && mustFails.length === 0) {
    const [a, b, c] = comps.slice(-3);
    if (b - a < EPS && c - b < EPS) { exitReason = `rendimientos-decrecientes@${n}`; break; }
  }
  if (n === startIter + maxIter - 1) { exitReason = `maxIter (${maxIter})`; break; }

  // FIX
  phase("Fix");
  await agent(
    `Sos diseñador/front-end de Jodete (React + Vite, archivos client/src/App.tsx y client/src/styles.css).\n` +
    `PRIORIDAD MÁXIMA: cualquier [MUST] de design-loop/GUIDELINES.md en estado "fail" (esta iteración: ${mustFails.map((i) => i.id).join(", ") || "ninguno"}). Arreglalos primero.\n` +
    `Después, basándote en los issues y peores dimensiones de la iteración ${n} (mirá design-loop/iterations/${n}/scores.json y los PNG relevantes),\n` +
    `aplicá 2–4 mejoras CONCRETAS y de bajo riesgo, priorizando severity alta × effort bajo. Enfocá en las peores dimensiones: ${(cur.worst ?? []).join(", ") || "las que veas"}.\n` +
    `Podés proponer tipografía (importar fuentes en index.html/styles.css) si mejora la dimensión typography.\n` +
    `NO rompas los data-testid ni la lógica de juego. Corré \`pnpm -r typecheck\` y asegurate que pase.\n` +
    `Al final, agregá una entrada a design-loop/CHANGELOG.md con: "## Iteración ${n}→${n + 1}" y bullets de qué cambiaste y por qué.`,
    { phase: "Fix", label: `fix:iter${n}` }
  );
}

log(`Loop terminado: ${exitReason}`);
return { exitReason, history };
