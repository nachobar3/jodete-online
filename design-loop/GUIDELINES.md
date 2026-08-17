# Guía de iteración — invariantes que SIEMPRE se validan

Este documento es la **checklist obligatoria** de cada iteración del design-loop. Ninguna
iteración se considera "mejorada" si rompe un invariante marcado como **[MUST]**. El
workflow corre una fase de *compliance* que verifica cada punto y **bloquea el exit** si
algún [MUST] falla.

Cada ítem indica **cómo se valida**:
- `obj` — check objetivo automatizable (harness/objective.ts)
- `screenshot` — juez de visión sobre PNG del momento
- `video` — juez de visión sobre grabación de la transición
- `e2e` — test de comportamiento (reglas del juego, server autoritativo)
- `perf` — test de latencia/carga

> Estado inicial: la mayoría arranca como **PENDIENTE DE CAPACIDAD** porque requieren
> momentos/tests/assets que aún no existen en el harness (ver "Gaps" al final). A medida
> que se construyen, pasan a validarse automáticamente.

## A. Animación y feedback visual

- **G1 [MUST]** `video` — El usuario **siempre** ve la carta **viajando desde la mano del
  jugador hasta la mesa**, incluido el **espejito**. (Verificar en jugada normal, multi-carta,
  espejito y comodín.)
- **G4 [MUST]** `screenshot`+`video` — Los **jugadores se iluminan (glow)** cuando
  corresponde: el que hace **espejito**, el que **gana/pierde un challenge**, y —**solo tras
  la revelación de 10s (`TURN_REVEAL_MS`) sin jugadas**— el **jugador de turno**. Antes de esa
  revelación **NO** hay glow (ni ninguna otra pista) de turno. Ver **G16**.
- **G7 [MUST]** `video` — Hay **animación específica cuando se juega un Joker/comodín**
  (destello + giro en el pozo). El giro ocurre **recién cuando la carta que viaja aterriza y
  queda posicionada en la mesa** — **nunca por debajo de la carta en vuelo ni antes de que
  llegue**. (Si la jugaste arrastrando y no hay vuelo, gira apenas se suelta en la mesa.)
- **G13 [MUST]** `video` — Cada vez que alguien **"se jode"** (roba por challenge/UNA/mal
  cierre) hay una **animación** y se lo **circunda con un glow ROJO**.

## B. Estética (dirección de arte)

- **G6 [MUST]** `screenshot` — Estética **tipo Jodete**: jocosa, de *joker/bufón*. Concepto:
  "el Joker es el que más te hace *joderte*". Paleta colorida y con carácter, no genérica.
  Esta dirección guía tipografía, color y las animaciones de arriba.
- **G8 [MUST]** `screenshot` — La **carta de Joker es un Joker real**: un **bufón con gorro**
  (estilo emoji 🃏), **colorido**. **No** debe decir `JK` en el índice/esquina. Buscar un
  asset libre o crearlo (SVG/emoji). Se valida capturando el reverso/anverso del comodín.

## C. Layout y ergonomía (en todos los viewports)

- **G2 [MUST]** `obj`+`screenshot` — Los **botones de acción son siempre accesibles**, están
  **cerca de la mesa** y **nunca tapados** por cartas u otros componentes. (obj: dentro del
  viewport + sin solaparse con `.card`; juez: alcance cómodo.)
- **G3 [MUST]** `obj`+`screenshot` — Las **cartas del jugador están cerca de la mesa**, son
  **suficientemente grandes** para interactuar en varios devices (tap target ≥ 44px en
  mobile) y **no tapan** otros componentes interactuables (botones, asientos).

## D. Reglas / comportamiento (server autoritativo)

> Estas son las reglas DESEADAS. Pueden requerir cambios en el engine (ver DESIGN.md, que
> difiere en algunos puntos). El loop las valida con tests e2e y reporta la brecha.

- **G9 [MUST]** `e2e` — Un jugador **puede tirar una carta aunque no sea su turno** (NO
  aparece el cartel "no es tu turno"). Es una jugada **ilegal** y **cualquier jugador puede
  declarar JODETE** ante esa situación.
- **G10 [MUST]** `e2e` — La **última carta de la mano no puede jugarse de forma ilegal**: el
  sistema lo **impide**. Si no se puede jugar legalmente, el sistema **auto-declara JODETE**,
  te hace **robar 3** y **devuelve** la carta mal tirada.
- **G11 [MUST]** `e2e` — Los jugadores pueden **acusar "UNA"** a otro que tiene **una sola
  carta y no declaró "UNA"**. Se hace con un **"JODETE"**; cualquier jugador puede hacerlo, y
  el acusado **roba 3**.
- **G12 [MUST]** `e2e` — Si un jugador dice **"JODETE"** y **no hay jugada ilegal en las
  últimas 5 jugadas** y **ningún jugador tiene una sola carta sin haber declarado UNA**,
  entonces **el que hizo click en JODETE roba 3**.
- **G17 [MUST]** `e2e` — Tras usar **JODETE**, el botón queda **deshabilitado hasta que otro
  jugador haga una jugada real** (cambia el tope). **No** se puede spamear JODETE para robar 3
  por cada click. (Sí sigue penalizando con robar 3 cuando el challenge es inválido — G12.)

## E. Rendimiento

- **G5 [MUST]** `perf` — **Tiempos de respuesta del server entre jugadas**: no debe existir
  **lag** con **múltiples usuarios interactuando en simultáneo**. Medir latencia jugada→ack y
  jugada→broadcast bajo carga (N clientes concurrentes) y fijar umbrales.

## F. No dar pistas — es la esencia del "jodete"

> El juego se basa en **que los jugadores se confundan y se equivoquen** (por eso "jodete").
> La UI **NO** debe ayudar a saber de quién es el turno ni qué carta corresponde. Estos MUST
> son **anti-affordance**: bloquean cualquier "mejora de claridad" que el loop quiera meter.

- **G14 [MUST]** `obj`+`screenshot` — Las **cartas nunca tienen transparencia**: `opacity`
  computado **= 1** en cualquier estado (turno, fuera de turno, jugable o no, hover). Ocultar
  el origen de un arrastre se hace con `visibility`, **no** bajando opacidad. Nada de cartas
  *faded*/translúcidas. (obj: recorrer `.card` y verificar `getComputedStyle().opacity === "1"`.)
- **G15 [MUST]** `obj`+`screenshot` — **No** se marcan/resaltan las **cartas jugables**: sin
  anillo dorado, sin elevación, sin flecha ▲, sin pulso, y **sin atenuar** las no-jugables. El
  jugador **debe poder equivocarse**. (obj: ninguna `.card` con clase/estilo diferencial por
  legalidad; todas las cartas de la mano se ven iguales salvo su cara.)
- **G16 [MUST]** `obj`+`screenshot` — **No** existe **indicador permanente de turno**: ni
  banner/texto ("TU TURNO" / "Turno de X"), ni glow permanente, ni desaturado de la mano por
  no ser tu turno. La **única** pista de turno/sentido aparece **recién tras `TURN_REVEAL_MS`
  (10s) sin que nadie tire** (glow verde en tu mano + glow en el asiento + flecha `↻/↺`). Está
  permitido **jugar fuera de turno** (ver G9). (obj: sin `.turn-banner`/`.wait-hint` en el DOM;
  antes de 10s ningún asiento ni la mano tienen glow de turno.)

---

## Verificación — cómo se mide cada ítem (YA construido)

Cada Gxx ya es **verificable** por el loop:

| Ítem | Capacidad de validación |
|---|---|
| G1 | momento `jugada-normal` (video) + `espejito` (video) |
| G4 | screenshots de `tu-turno`/`turno-ajeno`/`espejito` |
| G6, G8 | momento `comodin-en-mano` + rúbrica `aesthetics`/`typography` |
| G7 | momento `comodin-jugado` (video) |
| G13 | momento `se-jode` (video) |
| G2, G3 | objetiva `controls_covered_by_cards` + `offscreen_elements` + `small_tap_targets` |
| G9, G10, G11, G12, G17 | `e2e/guidelines.spec.ts` (correr con `design-loop/run-e2e.sh guidelines.spec.ts`) |
| G5 | test de latencia en `e2e/guidelines.spec.ts` (p95 jugada→broadcast < 400ms) |
| G14 | objetiva `card_opacity` (todas las `.card` con opacity computado = 1) |
| G15 | objetiva `no_playable_marking` (ninguna `.card` con clase `playable` ni `filter` en la mano) |
| G16 | objetiva `no_turn_indicator` (sin `.turn-banner`/`.wait-hint` ni clase `is-myturn`/`not-myturn`) |

## Fixes pendientes para que los [MUST] PASEN (trabajo de iteración)

La capacidad de medir ya está; estos cambios son los que harán pasar cada MUST y son el
trabajo de la fase Fix del loop:

- **G10** — validar legalidad de la **última carta**: auto-JODETE + robar 3 + devolver.
- **G12** — ampliar ventana de challenge a **5 jugadas** y eximir cuando alguien está en 1-sin-UNA.

Ya cumplen y **se auto-validan** (no re-implementar ni "mejorar" en dirección contraria):
**G1** (espejito animado), **G7** (giro del comodín al aterrizar), **G8** (asset del Joker),
**G9** (jugar fuera de turno), **G11** (acusar UNA), **G13** (glow rojo al joderse),
**G14/G15/G16** (checks objetivas en `objective.ts`: sin transparencia, sin marca de jugables,
sin indicador de turno) y **G17** (e2e del cooldown de JODETE en `guidelines.spec.ts`).

> **Bots**: cuando alguien hace una **jugada ilegal challengeable**, un bot que no sea el
> culpable declara **JODETE siempre** (con un delay corto de ~0.8–1.5s para que el humano
> pueda reaccionar primero). Es intencional: castiga el error y enseña la mecánica.
