# Changelog del design-loop

Una entrada por iteración: qué se midió, qué se cambió y por qué.

## Post-workflow — fix de regresión (2026-08-17)

La suite e2e completa post-workflow detectó **1 regresión** del fix de la iter 2→3:
`realflow.spec.ts` fallaba porque el botón "Robar N" (`.urgent-draw`) pulsaba con
`transform: scale()` → Playwright lo veía "not stable" y el click nunca se concretaba
(timeout). **Fix:** `@keyframes urgentPulse` ahora pulsa solo por `box-shadow` (glow), sin
mover la caja del botón. Un botón clickeable no debe animar su layout (desplaza el tap area).
Resultado: **19/19 e2e verdes**.

## Iteración 2→3

`pnpm -r typecheck` pasa (shared/server/client). Sin romper `data-testid` ni lógica de
juego (solo se agregaron clases CSS condicionadas por estado ya existente en el render).
Ningún `[MUST]` en estado fail esta iteración; foco en las 3 dimensiones más flojas de la
iter 2: **feedback (4.33)**, **affordance de jugables (4.36)** y **ergonomía mobile (4.38)**.

Cambios (priorizados por severity alta × effort bajo):

- **Botón "Robar N" urgente (feedback + mobile).** Cuando `pendingDraw > 0` (robo obligatorio
  por comodín/2s), el botón deja de ser gris `secondary` y pasa a rojo pulsante con el número
  en grande (clase `.urgent-draw`). Resuelve los issues repetidos "Roba 2/4 no comunica
  urgencia vs acción voluntaria" (varios major/minor en feedback).
- **Botón "¡UNA!" urgente (affordance).** Al quedar con 1 carta sin haber cantado
  (`handCount === 1 && !saidUna`), el botón late en cyan —mismo color que el glow de UNA— para
  leerse como acción de emergencia (`.urgent-una`). Cierra el issue major "no está claro que
  [UNA!] es acción urgente".
- **Indicador central "Roba N" reforzado (feedback).** El badge `.pending` del pozo ahora es
  rojo pulsante y más grande, para que la deuda de cartas se vea desde lejos en mobile.
- **Ergonomía mobile.** Objetivos táctiles del HUD subidos a ≥48px con tipografía no diminuta;
  íconos de palo del modal agrandados (68px, símbolo 38px) por el issue "íconos de palo muy
  pequeños en botones".

## Iteración 1→2

`pnpm -r typecheck` pasa (shared/server/client). Sin romper `data-testid`.
Suites e2e verdes: `guidelines.spec.ts` 5/5 y `game.spec.ts` 12/12 (sin regresiones).

**MUSTs en fail arreglados (prioridad máxima).** Estos eran reglas del engine, no de
front-end, así que el fix vive en `server/src/rooms/GameRoom.ts` (la UI ya mandaba los
mensajes correctos; los tests los ejercen vía `__room.send`):
- **G9** — Jugar **fuera de turno** ya **no se rechaza**: es una jugada ILEGAL y
  challengeable. En `handlePlay` se quitó el `return reject("no es tu turno")`; una jugada
  fuera de turno se marca `legal=false`, respeta la ventana de permanencia y se resuelve
  desde la posición del que la hizo (como el espejito, seteando `currentPlayerId=id` antes
  de aplicar). Las restricciones duras de mazo (pending 2/comodín) siguen sólo en tu turno.
- **G10** — La **última carta no puede jugarse ilegal**: en `applyPlay`, si el jugador
  estaba en 1 carta y la jugada es ilegal, se **auto-declara JODETE**: roba 3, se **devuelve**
  la carta (nunca sale de la mano), sigue en `playing` (no corta). Antes cortaba igual
  (`phase→handEnd`).
- **G12** — ya pasaba; se confirmó con el test aislado (el fallo previo en la corrida
  completa era contención de setup entre tests, no la aserción).

**Mejoras de diseño (severity alta × effort bajo) en las peores dimensiones.** Solo
`client/src/App.tsx` + `client/src/styles.css`:
- **Affordance de jugables (3.93) + claridad de turno** — Cuando **NO es tu turno**, toda la
  mano se **dessatura + baja opacidad** (`.myhand.not-myturn`) y aparece un pill **"Esperá tu
  turno…"**. Era el gap más repetido en los issues (mano idéntica a estado jugable en
  `turno-ajeno`/`mano-repartida`). En tu turno, las **no jugables se atenúan más** y las
  **jugables se elevan ~10px** además del anillo dorado: la diferencia se lee de un vistazo.
- **Feedback de eventos (3.98)** — Al **rechazar una acción** la mano ahora **se sacude y
  destella en ROJO** (`.myhand.rejected`, `shakeHand`+`rejectFlash`). Antes el rechazo sólo
  mostraba texto suelto: el juez lo marcaba como "weak error feedback / no shake".
- **Ergonomía mobile (4.21)** — El error de acción pasó de **texto suelto pegado al borde**
  (riesgo crítico de recorte) a una **caja destacada** (fondo rojo, borde, pop) posicionada
  sobre el HUD con `env(safe-area-inset-bottom)`. Toasts y HUD también con safe-area; botones
  del HUD con `min-height: 44px` (tap target).
- **Typography** — El título del modal ("Elegí el palo") pasó a **peso 800 / +tamaño** (el
  juez lo marcaba como "regular weight, could be bolder").

Riesgo: bajo en front-end (solo CSS/estado visual, sin tocar `data-testid` ni payloads).
Los cambios de engine (G9/G10) son quirúrgicos y quedan cubiertos por los e2e; se verificó
que no rompen `game.spec.ts` (espejito, challenge, As de pic, 2s, bots) ni `guidelines`.

## Iteración 0→1

Fixes de front-end (solo `client/src/App.tsx`, `client/src/styles.css`, `client/index.html`),
sin tocar `data-testid` ni la lógica de juego. `pnpm -r typecheck` pasa; build de Vite OK.

MUSTs de `GUIDELINES.md` atacados (visuales, en scope de diseño):
- **G1** — El espejito ahora **también anima la carta volando** hacia el pozo. Antes
  `CardPlayed` hacía `if (p.espejito) return;` y se saltaba el vuelo; ahora sale desde el
  asiento/mano del que lo jugó como cualquier jugada.
- **G7** — **Animación específica al jugar un comodín**: cuando la carta jugada es `JOKER`
  el pozo hace un destello dorado + la carta entra girando (`joker-play` / `jokerFlash` +
  `jokerSpin`). Antes no había ningún feedback distintivo del comodín.
- **G13** — Cuando alguien **"se jode"** se lo **circunda con glow ROJO + shake** 1.8s.
  Fuente estructurada: `JodeteResult` (culpable o, si el JODETE fue falso, el acusador);
  además se matchea por nombre en los toasts `penalty` (UNA/mal cierre/timeout).
- **G2/G3** — `contrast_room_code` (1.23, ilegible) resuelto dándole al código de sala un
  **fondo sólido oscuro** con borde dorado. Tap targets: botón "¡le queda 1!" y FAB de
  reglas subidos a **≥44px**.

Mejoras de bajo riesgo en las peores dimensiones (severity alta × effort bajo):
- **Affordance de jugables (3.86)** — las cartas jugables ahora se **resaltan siempre**
  (anillo dorado pulsante + flechita), no sólo vía glow tardío; en tu turno las no jugables
  se **atenúan**. La clase `.playable` existía pero no tenía estilo: era el mayor gap.
- **Claridad de turno (3.88)** — **banner de turno siempre visible** ("TU TURNO" / "Turno de
  X") sin esperar los 10s del glow, y sin quitar la deducción del sentido.
- **Feedback de eventos (3.71)** — cubierto por G1 (vuelo del espejito), G7 (comodín) y G13
  (jodido), que agregan feedback donde antes era nulo.
- **Typography** — se importan **Bungee** (título display "JODETE", carácter de bufón/joker)
  y **Baloo 2** (UI), reemplazando la fuente de sistema genérica.

Riesgo: bajo. No se modificó el server ni los payloads; todo se apoya en eventos ya emitidos
(`CardPlayed`, `JodeteResult`, toasts `penalty`). **G9/G10 siguen en fail**: son cambios de
engine (`server/rooms/GameRoom.ts`), fuera del scope de front-end de esta iteración.

## Iteración 0 — baseline (2026-08-17)

Primera captura completa: 5 viewports × 10 momentos = 50 screenshots + 15 videos,
280 checks objetivos, juzgada por 5 agentes de visión (uno por viewport).

- **Compuesto**: 4.313 / 5
- **Objetivas**: 85% (43 fallos)
- **Issues**: 2 critical, 36 major, 30 minor
- **Peores dimensiones**: cohesión estética (3.74), tipografía (4.02), affordance (4.14), feedback (4.16)

Hallazgos top (consenso entre viewports):
1. **Sin indicador de cartas jugables** (affordance) — crítico en desktop/tu-turno.
2. **Turno inicial ambiguo** al repartir — no se sabe de quién es el turno.
3. **Carta rechazada sin motivo** — feedback débil, crítico en tablet.
4. **Badge "Roba N" con bajo contraste** (coincide con objetiva `contrast_pending`).
5. **`contrast_room_code` = 1.23** en todos los viewports (código de sala casi ilegible).
6. **Tablet**: botones de acción fuera del viewport (x=713 en 820px de ancho).
7. **Mobile**: tap targets < 44px (cartas 36×49, botones).
8. **desktop-wide**: desaprovecha el espacio (todo en ~400px centrales).

Sin fixes aplicados todavía (baseline pura).

## Iteración 5 — asset del Joker (2026-08-17)

Primer fix aplicado a mano: **carta de Joker** = bufón colorido (asset `client/public/joker.png`,
esquinas ♥♥ y ♠/J removidas) reemplazando el texto "JK" en `CardFace`. 14 momentos × 5 viewports.

- **Compuesto**: 4.478 (baseline 4.313 → **+0.165**)
- **Objetivas**: 87% (baseline 85%)
- Los 5 jueces subieron `aesthetics` en `comodin-en-mano`/`comodin-jugado` ("huge improvement
  over plain JK text"). G8 pasa.
- Issues nuevos menores: el Joker podría tener glow/borde para destacar como carta especial.

Objetivas que siguen fallando (candidatos al próximo fix):
- `contrast_room_code=1.23` en los 5 viewports (código de sala ilegible).
- `offscreen_elements` en **tablet** (820px): el panel de botones queda en x=713, fuera de
  pantalla, en los 14 momentos — viola G2 (botones accesibles).
- `small_tap_targets` en mobile (cartas 36–49px).

Aún en fail (fixes de iteración): G1 (espejito sin animar), G7, G13 (glow rojo), G9, G10, G12.

## Capacidades de verificación de la guía (2026-08-17)

Se construyó todo lo necesario para que `GUIDELINES.md` sea 100% verificable en cada iteración
(sin cambiar todavía el juego — eso es la fase Fix):

- **Momentos nuevos** (moments.ts): `jugada-normal` (video, G1), `comodin-en-mano` (G8),
  `comodin-jugado` (video, G7), `se-jode` (video, G13). Capturan PNG + video OK.
- **Check objetivo** `controls_covered_by_cards` (objective.ts) para G2/G3.
- **Tests e2e** `e2e/guidelines.spec.ts` (G9–G12 + latencia G5) + launcher `run-e2e.sh`
  (puertos dedicados). `playwright.config.ts` ahora es env-driven (`JODETE_URL`,
  `JODETE_EXTERNAL_SERVER`).
- **Fase Compliance** en el workflow: audita cada [MUST] y bloquea el exit si alguno falla.

Estado real de las reglas (baseline de verificación):
- **G11** ✓ implementado · **G12** ✓ (caso simple) · **G9** ✗ (server rechaza fuera de turno) ·
  **G10** ✗ (no valida legalidad al cortar) · **G5** latencia local OK.
- Visuales por arreglar: G1 (espejito sin animar), G7 (sin animación de comodín),
  G8 (Joker muestra "JK"), G13 (sin glow rojo).
