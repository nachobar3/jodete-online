# Design-loop de Jodete

Método de trabajo por iteraciones para mejorar la UI/UX con **evidencia visual** y
**métricas comparables**. Cada iteración: arma mesas reales, siembra estados canónicos,
saca screenshots/video en varios viewports, mide objetivo + subjetivo, guarda todo en una
DB, compara contra la iteración previa, aplica fixes y decide si seguir.

## Qué mide

**Objetivo** (script, sin LLM, determinista) — el piso de calidad:
overflow horizontal, elementos fuera de viewport, tap targets < 44px (mobile),
contraste WCAG de textos clave, solapamiento de asientos, errores de consola.

**Subjetivo** (juez de visión, rúbrica 1–5, ponderada) — el diseño real:
`turn_clarity`, `affordance`, `hierarchy`, `legibility`, `feedback`,
`mobile_ergonomics`, `aesthetics`, `typography`. Pesos en `harness/rubric.ts`
(claridad de turno y affordance pesan más: es un juego de velocidad).

**Momentos canónicos** (sembrados determinísticamente para comparar entre iteraciones):
lobby · mano-repartida · tu-turno · turno-ajeno · elegir-palo · pila-robo · espejito ·
cantar-una · fin-ronda · carta-rechazada. Definidos en `harness/moments.ts`.

**Viewports**: mobile-portrait, mobile-landscape, tablet, desktop, desktop-wide
(`harness/viewports.ts`).

## Cómo se estructura

```
harness/
  db.ts            DB interna (node:sqlite): runs, iterations, artifacts, scores, objective, issues
  viewports.ts     tamaños de pantalla
  rubric.ts        dimensiones + pesos + score compuesto
  moments.ts       cada momento = semilla __setup + acciones guionadas
  table.ts         arma mesa real (host + guests), seed(), startGame()
  objective.ts     checks objetivos in-page
  run-iteration.ts orquesta viewports × momentos → PNG/video + DB + manifest.json
  score.ts         persiste los puntajes del juez y calcula el compuesto
  report.ts        reporte + diff vs iteración previa (¿mejoramos?)
run.sh             corre una iteración completa (levanta servers + captura + limpia)
iterations/<N>/    assets por iteración (<viewport>/<momento>.png, *-video/, manifest, scores)
loop.db            la base
CHANGELOG.md       qué se mejoró en cada iteración
loop.workflow.js   workflow autónomo (capture→judge→fix→exit)
```

## Uso

Capturar + medir una iteración (levanta client:5273 + server:2577 en puertos dedicados
para no chocar con otros dev servers, y limpia al terminar):

```bash
bash design-loop/run.sh 0                       # iteración 0
JODETE_VIEWPORTS=desktop JODETE_MOMENTS=lobby bash design-loop/run.sh 0   # subset (smoke)
node design-loop/harness/report.ts              # ver scores + diff
```

> Nota de entorno: en este sandbox los daemons no sobreviven fuera de la invocación de
> Bash, por eso `run.sh` levanta y baja los servers dentro de la misma corrida, y hay que
> correrlo con el sandbox de Bash desactivado (dev servers + browser headless).

El juicio subjetivo lo hace un juez de visión (agente) que lee los PNG y escribe
`iterations/<N>/scores.json`, que se persiste con `node harness/score.ts <path>`.

## Loop autónomo

`loop.workflow.js` encadena, por iteración: **Capture** (run.sh) → **Judge** (un agente de
visión por viewport) → **Persist** (score + report) → chequeo de **exit** → **Fix** (un
agente edita `client/src`). Se invoca con la herramienta Workflow.

### Exit criteria (rendimientos decrecientes)
Para cuando **cualquiera** se cumple:
1. **Calidad**: compuesto ≥ 4.2, 0 issues críticos y 0 fallos objetivos.
2. **Rendimientos decrecientes**: 2 iteraciones seguidas mejoran < 0.05.
3. **Presupuesto**: máximo de iteraciones (`maxIter`, default 6).

Parámetros en `args` del workflow: `{ startIter, maxIter, thresholdComposite, epsilon }`.
