# Jodete — Diseño del prototipo

Juego de cartas multiplayer online (2–8 jugadores), de **velocidad**, con acciones
concurrentes fuera de turno resueltas por orden de llegada al servidor.

## 1. Decisiones fijadas

| Área | Decisión |
|---|---|
| Plataforma | Web (navegador), responsive desktop + mobile |
| Cliente | React + TypeScript + Vite, SDK Colyseus (WebSocket) |
| Servidor | Node.js + TypeScript + **Colyseus** (game-server autoritativo, rooms) |
| Cuentas | Salas anónimas por código; sin DB en el prototipo |
| Deploy | Un proceso Node (sirve build del cliente). Railway/Fly.io/Render |
| Alcance prototipo | Core + espejito + challenge (JODETE) + UNA. **Sin as de pic** aún |

## 2. Principio de arquitectura

**El servidor es la única fuente de verdad.** El orden de las acciones lo decide el
**arribo al servidor**, no el reloj del cliente. Node procesa los mensajes de una sala
**secuencialmente** (single-thread), así que "quién llegó primero" queda naturalmente
definido, sin locks. El cliente hace UI optimista y reconcilia contra el estado autoritativo.

**Información oculta:** las manos ajenas nunca viajan al cliente. A cada jugador se le manda
estado público (tope, palo activo, pila de robo, dirección, turno, cantidad de cartas de cada
uno) + su propia mano. Las cartas se revelan al jugarse.

## 3. Modelo de concurrencia (el corazón)

### 3.1 Re-validación optimista (no rechazo por llegar tarde)
Al recibir una jugada, el server la **re-valida contra el estado actual** (que pudo cambiar
entre send y receive). Se rechaza **solo si es inválida bajo el estado nuevo**.
Ej.: mi 6♣ (espejito) cae primero; la jugada de Walter llega después pero su 6♣ **sigue
siendo espejito válido** sobre el nuevo tope → se apila. Llegar tarde no rechaza; la
invalidez sí.

### 3.2 Regla de los 2s — filtro de jugadas MAL (IMPLEMENTADA)
Aplica **solo a jugadas ilegales** (las que "no corresponden"). Es un filtro por tiempo,
medido por el **reloj del server** desde que se colocó la **carta anterior** (`topSetAt`):

- Jugada **legal** → siempre se acepta (nunca se filtra). Espejito idem (es idéntico → legal).
- Jugada **ilegal** y pasaron **< 2s** desde la carta anterior → **rechazo en silencio**:
  la carta vuelve a la mano, no se aplica nada y **los demás nunca la ven** (solo el que jugó
  recibe `actionRejected`).
- Jugada **ilegal** y pasaron **≥ 2s** → **se acepta y queda en pie**, challengeable (el modo
  permisivo de §3.4/§3.5).
- `topSetAt` se resetea cada vez que cambia el tope (jugada, espejito, rollback, reparto).
- `MIN_PERMANENCIA_MS = 2000` (config; en tests se baja con `JODETE_PERMANENCIA_MS`).

> Nota: reemplaza el modelo previo de `observedVersion` por uno más simple y fiel a la regla
> real. El campo `observedVersion` sigue viajando en el mensaje por si se necesita afinar.

### 3.3 Espejito — excepción instantánea
- Jugar una carta **idéntica** al tope, **fuera de turno**, en cualquier momento.
- **No** aplica la regla de 2s: gana el reflejo más rápido (orden de arribo).
- El server **valida identidad al instante**; un espejito no-idéntico se **rechaza** (no es
  challengeable, no puede ser ilegal).
- Al hacer espejito, el jugador de turno queda **salteado**.
- Sobre un "2", el espejito **acumula el robo** y quien roba es el que sigue al que espejeó.
- No se puede espejito sobre comodín.

### 3.4 Jugadas normales
- Solo permitidas **en tu turno** (el canal fuera-de-turno lo cubre espejito / as de pic).
- El server **no bloquea por legalidad** una jugada que pasó el filtro de §3.2: una carta
  mal jugada (pasados los 2s) **se acepta, queda challengeable y sigue en pie si nadie la
  challengea**. (Excepción dura: con un 2/comodín pendiente hay que responder o robar.)
- Multi-carta: solo se pueden tirar varias cartas del **mismo número** que el tope, en tu
  turno (nunca con espejito, nunca dos idénticas juntas salvo mismo número que el tope).

### 3.5 Challenge ("JODETE")
- Se challengea una jugada con **hasta 3 cartas arriba**.
- **Ilegal** → el culpable **roba 3** y su carta vuelve a la mano; se **revierte todo** al
  estado previo a la jugada mala, **salvo las cartas robadas** (quedan robadas).
- **Legal** (challenge falso) → el acusador **roba 3**.
- Requiere **engine reversible** (ver §4).

### 3.6 UNA
- Al quedar con 1 carta hay que cantar **"UNA"**. Si otro lo caza antes → roba 3.
- Cortar sin haber cantado "UNA" → roba 3.

## 4. Engine reversible (event sourcing)
El estado **no se muta directamente**. Se aplica un log de **comandos reversibles**
(jugar, saltear, invertir, apilar-robo, elegir-palo…). El challenge hace **undo** de las
últimas ≤3 jugadas restaurando manos / turno / dirección / pila de robo.
**Robar del mazo es efecto irreversible** (no se des-roba).

## 5. Cartas y efectos (sin as de pic en el prototipo)
- **2**: el siguiente roba 2 y es salteado; apilable (2 sobre 2 → +2 al siguiente).
- **3-4-5-6-7-9-10**: sin efecto.
- **8**: elegís palo; se puede tirar sobre cualquier carta.
- **J**: saltea al próximo.
- **Q**: saltea 2.
- **K**: invierte el sentido.
- **Comodín**: el siguiente roba 4 y luego juega; el que lo tira elige palo. No admite espejito.
- (As de pic: **fuera del prototipo**, se agrega después.)

## 6. Puntaje (al cortar, suma lo que quedó en mano)
2 = 20 · 3-7,9,10 = valor · 8 = 30 · J,Q,K = 10 · As = 15 · As de pic = 75 · Comodín = 50

## 7. Mazo
3 mazos franceses + comodines, mezclados. 7 cartas por jugador. Se da vuelta la primera.

## 8. Protocolo de mensajes (borrador)

**Cliente → Servidor**
- `createRoom` / `joinRoom { code, name }`
- `ready`
- `playCards { cardIds[], observedVersion, declaredSuit? }` (turno; multi = mismo número)
- `playEspejito { cardId, observedVersion }`
- `drawCard` · `pass`
- `sayUna`
- `callJodete { targetPlayerId }`
- `accuseUna { targetPlayerId }`

**Servidor → Cliente**
- estado sincronizado (diff Colyseus, filtrado por jugador) con `version` + timestamp
- `actionRejected { reason }`
- eventos de feedback/animación: `cardPlayed`, `espejitoWon`, `skipped`, `jodeteResult`, …

## 9. Milestones
- **M0** Andamiaje: server Colyseus, cliente React, crear/unirse por código, lobby + ready.
- **M1** Loop por turno: mazo, repartir, dar vuelta, inicio random, jugar por palo/número,
  robar, pasar, cortar, puntaje. **Engine reversible desde acá.**
- **M2** Espejito (validación de concurrencia fuera de turno). ⭐
- **M3** Efectos: 2, 8, J, Q, K, comodín.
- **M4** Challenge (JODETE) + UNA.
- Después: as de pic, reconexión, ventana de latencia configurable, animaciones.

## 10. Pendientes / a decidir más adelante
- Ventana de "fairness" por latencia (buffer ~80ms ordenado por timestamp) si el ping asimétrico
  resulta injusto en tests. Arrancamos con arribo-puro.
- Anti-cheat sobre `observedVersion` (acotar staleness a la ventana de challenge).
- Traducción digital de reglas físicas restantes (misma mano, adelantarse al palo del 8/comodín).
