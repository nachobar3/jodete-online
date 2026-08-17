# Jodete

Juego de cartas multiplayer online de **velocidad** (2–8 jugadores), con acciones
fuera de turno resueltas por orden de llegada al servidor. Ver [`DESIGN.md`](./DESIGN.md)
para el diseño completo (reglas, modelo de concurrencia, milestones).

## Stack
- **server/** — Node.js + TypeScript + Colyseus (game-server autoritativo)
- **client/** — React + TypeScript + Vite (drag & drop)
- **shared/** — tipos, constantes, modelo de cartas y reglas compartidas

Monorepo con **pnpm workspaces**.

## Requisitos
- Node.js ≥ 20 (probado en 26)
- pnpm ≥ 9

## Setup
```bash
pnpm install
```

## Desarrollo
Levanta server (`:2567`) y client (`:5173`) juntos:
```bash
pnpm dev
```
Abrí `http://localhost:5173` en dos pestañas: creá una sala, copiá el código y unite
desde la otra.

## Jugar en varios dispositivos (misma red / LAN)
`pnpm dev` ya deja el server y el client escuchando en **todas las interfaces**. Al
arrancar, el server imprime las URLs LAN, por ejemplo:
```
[jodete]   LAN: ws://192.168.1.42:2567  (wlan0)
```
Desde otro dispositivo de la misma red (celular, otra compu) abrí:
```
http://<IP-DE-TU-COMPU>:5173      (ej: http://192.168.1.42:5173)
```
El cliente deriva automáticamente el WebSocket del `hostname` con el que se lo abrió,
así que apunta solo al server correcto. (Podés forzar otro con `VITE_SERVER_URL`.)

## Bots
En el lobby, el host puede **"Agregar bot 🤖"** (hasta completar la mesa). Los bots:
- juegan una carta legal **en su turno** con ~3s de demora (o roban/pasan si no pueden);
- hacen **espejito** con esa misma demora cuando tienen la carta idéntica (pierden si un
  humano llega antes);
- **se equivocan ~2%** de las veces (tiran una carta ilegal, que queda challengeable);
- cantan **UNA** solos.

Config por env: `JODETE_BOT_DELAY_MS` (default 3000), `JODETE_BOT_MISTAKE` (default 0.02).

## Interfaz
- **Mesa circular**: los jugadores se ubican alrededor de una mesa redonda. De los
  rivales se ven solo los **dorsos** (cantidad de cartas). Tu mano va abajo, en
  **abanico** (como sostenida con una mano); todas las cartas se alcanzan con el mouse
  (hover para levantarlas).
- **Animación**: cada carta jugada **viaja** desde el jugador hasta el centro de la mesa.
- **Cartas estilo poker**: índice (número + palo) arriba a la izquierda y esquina
  inferior espejada, con pip central.
- **No hay botón "Jugar"**: se juega con **doble-click** o **arrastrando** la carta al
  pozo (la carta sale de la mano y sigue al cursor; en hover se agranda sin levantarse).
- **Sonidos** (Web Audio, sin archivos): swish al **pasar** por una carta, "shhh" al
  **tirar**, un swish más grave al **robar**, y una **campana de vidrio** en el **espejito**.
  El audio se habilita con el primer click/tecla (política de autoplay del browser).
- **El turno no se muestra**… hasta que pasan **10s** sin que nadie tire una carta: ahí
  el jugador de turno se **ilumina** (glow en su asiento / en tu mano), sin texto. El
  **sentido** de la ronda (↻/↺) también aparece recién ahí (es info a deducir).

## Cómo se juega
- **Jugar una carta**: en tu turno, **click**, doble-click o arrastrala a la mesa.
  Para 8/comodín se abre un selector de palo.
- **Espejito**: si tenés una carta **idéntica** al tope, clickeala aunque no sea tu
  turno para adelantarte (gana el más rápido; saltea al jugador de turno).
- **Robar / Pasar**: si no podés jugar, robá; después jugás o pasás.
- **¡UNA!**: cuando te queda 1 carta, cantá UNA. Si a un rival le queda 1 y no lo
  dijo, apretá "¡le queda 1!" para hacerlo robar 3.
- **As de pic**: tu A♠ se resalta cuando hay un efecto en la mesa (2, 8, J, Q, K,
  comodín). Tocalo (aunque no sea tu turno) para **cancelar el efecto**: nadie roba,
  se revierte el salteo/K y vos robás 1.
- **JODETE**: si creés que alguien jugó mal, gritá JODETE. Si tenía razón, el que
  jugó mal roba 3 y se revierte; si era válida, vos robás 3.
- **Timeout de turno**: **apagado por default**. Se puede prender con
  `JODETE_TURN_TIMEOUT_MS=<ms>` (si el dueño no juega en ese tiempo, roba y se saltea).

## Verificación / tests
```bash
pnpm typecheck        # typecheck de los 3 paquetes
pnpm build            # build de producción
pnpm e2e              # Playwright: lobby, drag&drop, espejito, challenge (levanta todo solo)
```
Smoke tests headless (requieren server corriendo con `JODETE_TEST=1`):
```bash
JODETE_TEST=1 pnpm dev:server                 # en otra terminal
node client/scripts/smoke.mjs                 # partida automática M1
node client/scripts/smoke2.mjs                # M2-M4 deterministas (espejito, efectos, jodete, una)
```

## Estado
- [x] **M0** — Lobby: crear/unirse por código, ready, start (host)
- [x] **M1** — Loop por turno: reparto, mano privada, jugar por palo/número,
      multi-carta, robar, pasar, corte, puntaje acumulado, revancha
- [x] **M2** — Espejito (jugada idéntica fuera de turno, instantánea, apila sobre 2s)
- [x] **M3** — Efectos: 2 (roba2+salteo apilable), 8 (elegir palo), J (saltea),
      Q (saltea 2), K (invierte), comodín (roba4+palo)
- [x] **M4** — Jugadas permisivas + JODETE (rollback reversible, ≤3 cartas arriba,
      roba 3) + UNA (cantar y acusar)
- [x] **Regla de los 2s** — una jugada MAL solo se acepta si pasaron ≥2s desde la
      carta anterior; si es más rápida, se rechaza en silencio y nadie la ve
- [x] **UI de mesa** — mesa circular, dorsos de rivales, mano en abanico, animación
      de la carta al centro, sin botón "Jugar", turno oculto hasta 8s de inactividad
- [x] **Turno oculto** — se revela recién a los 8s de inactividad (timeout de 15s
      opcional, apagado por default). Tu propio turno se avisa al instante.
- [x] **As de pic** — cancela el efecto de la última carta (fuera de turno): limpia
      robos/2 apilados, revierte K, ajusta el palo (8/comodín), roba 1; se tira aparte
- [x] **Animación** — la carta del oponente viaja de su lugar al centro; tu jugada por
      click/doble-click también, pero por arrastre no (ya la moviste vos)
- [x] **Bots** — el host los agrega en el lobby; juegan en su turno o hacen espejito con
      ~3s de demora y se equivocan ~2% de las veces (jugada ilegal challengeable)
- [ ] Pendiente: reconexión, multi-carta en la UI (el server ya la soporta), fin de
      partida por puntaje objetivo

### Cómo funciona la regla de los 2s (implementada)
Solo aplica a **jugadas ilegales**. El server mide, con su propio reloj, el tiempo desde
que se puso la **carta anterior** (`topSetAt`):
- Jugada **legal** (o espejito, que es idéntico) → siempre pasa.
- Jugada **ilegal** con **<2s** → **rechazo en silencio**: la carta vuelve, no se aplica
  nada y **los demás no la ven** (solo el que jugó recibe el rechazo).
- Jugada **ilegal** con **≥2s** → **queda en pie** y es challengeable (permisivo).

Configurable con `JODETE_PERMANENCIA_MS` (default 2000; los tests la bajan).

### Otras simplificaciones conscientes (prototipo)
- **Challenge**: la validez del JODETE se decide por **≤3 cartas arriba** de la jugada mala.
- **Jugadas fuera de turno**: por espejito o As de pic. Una jugada *normal* solo se
  acepta en tu turno.
- **Restricción dura** (no permisiva): con un 2 o comodín pendiente hay que responder
  correctamente (otro 2 / robar 4); no se puede tapar con cualquier cosa.

## Nota sobre dependencias
Colyseus `0.16.25` tiene un bug de publicación (`@colyseus/greeting-banner` con
`workspace:^`). Fijamos `@colyseus/core` a `0.16.24` y `greeting-banner` a `2.0.6`
vía `pnpm.overrides` en el `package.json` raíz.
