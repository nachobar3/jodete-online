// Smoke test M1: lobby + partida automática (reparto, jugar/robar/pasar, corte).
import { Client } from "colyseus.js";

const URL = "ws://localhost:2567";
const CODE = "TESTM1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error("❌ " + m); process.exit(1); };

// Réplica de canPlayBasic (M1) para el bot.
const isJoker = (c) => c.rank === "JOKER";
function canPlay(card, top) {
  if (isJoker(top)) return true;
  if (isJoker(card)) return true;
  if (card.rank === "8") return true;
  return card.suit === top.suit || card.rank === top.rank;
}

const hands = {}; // sessionId -> Card[]
let rejections = 0;

function wire(room, label) {
  room.onMessage("hand", (cards) => { hands[room.sessionId] = cards; });
  room.onMessage("actionRejected", (p) => { rejections++; console.log(`  (reject ${label}: ${p.reason})`); });
}

const host = await new Client(URL).create("game", { code: CODE, name: "Walter" });
const guest = await new Client(URL).join("game", { code: CODE, name: "Ignacio" });
wire(host, "host");
wire(guest, "guest");
await sleep(200);

if ([...host.state.players.values()].length !== 2) fail("no hay 2 jugadores");
console.log("✓ lobby: 2 jugadores");

host.send("ready", true);
guest.send("ready", true);
await sleep(150);
host.send("start");
await sleep(300);

if (host.state.phase !== "playing") fail(`phase=${host.state.phase}`);
if (!host.state.top?.rank) fail("no hay carta en el tope");
const h1 = hands[host.sessionId]?.length ?? 0;
const g1 = hands[guest.sessionId]?.length ?? 0;
if (h1 !== 7 || g1 !== 7) fail(`reparto incorrecto: host=${h1} guest=${g1}`);
console.log(`✓ repartió 7 y 7, tope=${host.state.top.rank}${host.state.top.suit}, mazo=${host.state.deckCount}`);
if (host.state.deckCount !== 162 - 14 - 1) fail(`deckCount=${host.state.deckCount}, esperaba 147`);
console.log("✓ deckCount = 147 (3 mazos - reparto - tope)");

// Test: jugar fuera de turno debe rechazarse.
const notCurrent = host.state.currentPlayerId === host.sessionId ? guest : host;
const anyCard = hands[notCurrent.sessionId][0];
notCurrent.send("playCards", { cardIds: [anyCard.id], observedVersion: 0 });
await sleep(200);
if (rejections < 1) fail("no rechazó la jugada fuera de turno");
console.log("✓ jugada fuera de turno rechazada");

// Partida automática.
const clientById = { [host.sessionId]: host, [guest.sessionId]: guest };
const seenTurns = new Set();
let topChanges = 0;
let lastTop = host.state.top.id;

for (let i = 0; i < 120 && host.state.phase === "playing"; i++) {
  const cur = host.state.currentPlayerId;
  seenTurns.add(cur + ":" + i % 2);
  const c = clientById[cur];
  const top = { suit: host.state.top.suit || null, rank: host.state.top.rank };
  const myHand = hands[cur] ?? [];
  const legal = myHand.find((card) => canPlay(card, top));
  if (legal) {
    c.send("playCards", { cardIds: [legal.id], observedVersion: 0 });
  } else {
    c.send("drawCard");
    await sleep(90);
    const top2 = { suit: host.state.top.suit || null, rank: host.state.top.rank };
    const drew = (hands[cur] ?? []).find((card) => canPlay(card, top2));
    if (drew) c.send("playCards", { cardIds: [drew.id], observedVersion: 0 });
    else c.send("pass");
  }
  await sleep(90);
  if (host.state.top.id !== lastTop) { topChanges++; lastTop = host.state.top.id; }
}

if (topChanges < 3) fail(`la mesa casi no avanzó (topChanges=${topChanges})`);
console.log(`✓ la partida progresó: ${topChanges} cambios de tope`);

if (host.state.phase === "handEnd") {
  const scores = {};
  host.state.scores.forEach((v, k) => (scores[k] = v));
  console.log("✓ alguien cortó → handEnd. Puntajes:", JSON.stringify(scores));
  const cutterHand = [host, guest].find((c) => (hands[c.sessionId] ?? []).length === 0);
  if (!cutterHand) console.log("  (nota: no se pudo identificar la mano vacía localmente)");
} else {
  console.log(`✓ engine estable tras 120 acciones (sin corte todavía, phase=${host.state.phase})`);
}

console.log("\n✅ SMOKE M1 OK");
await host.leave();
await guest.leave();
process.exit(0);
