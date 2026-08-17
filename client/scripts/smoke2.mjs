// Smoke determinista M2-M4 (requiere server con JODETE_TEST=1).
import { Client } from "colyseus.js";

const URL = "ws://localhost:2567";
const CODE = "TESTX2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => { console.error("  ❌ " + m); failed++; };
const card = (id, suit, rank) => ({ id, suit, rank });
const filler = (n) => Array.from({ length: n }, (_, i) => card(`F${i}`, "D", "3"));

const host = await new Client(URL).create("game", { code: CODE, name: "Host" });
const guest = await new Client(URL).join("game", { code: CODE, name: "Guest" });
const jodeteResults = [];
const rejects = [];
for (const r of [host, guest]) {
  r.onMessage("hand", () => {});
  r.onMessage("jodeteResult", (p) => jodeteResults.push(p));
  r.onMessage("actionRejected", (p) => rejects.push(p.reason));
  r.onMessage("toast", () => {});
}
await sleep(200);
const H = host.sessionId, G = guest.sessionId;
const hc = (id) => host.state.players.get(id)?.handCount ?? -1;
const setup = async (s) => { host.send("__setup", s); await sleep(150); };

// --- Espejito ---------------------------------------------------------------
console.log("Espejito:");
await setup({
  top: card("T", "C", "6"),
  currentPlayerId: H,
  hands: { [H]: [card("h1", "S", "9")], [G]: [card("g6", "C", "6"), card("g2", "H", "7")] },
  deck: filler(20),
});
guest.send("playEspejito", { cardId: "g6" });
await sleep(150);
host.state.top.rank === "6" && host.state.top.suit === "C" ? ok("el espejito quedó de tope") : bad("tope no cambió");
hc(G) === 1 ? ok("mano del que espejeó bajó a 1") : bad(`handCount guest=${hc(G)}`);
host.state.currentPlayerId === H ? ok("el turno saltó al siguiente del que espejeó") : bad(`current=${host.state.currentPlayerId}`);
rejects.length = 0;
guest.send("playEspejito", { cardId: "g2" }); // 7H no es idéntica al 6C
await sleep(120);
rejects.length > 0 ? ok("espejito no idéntico rechazado") : bad("no rechazó espejito inválido");

// --- 2 apilable + robo/salteo ----------------------------------------------
console.log("Efecto 2 (apilable):");
await setup({
  top: card("t2c", "C", "2"), // 2♣: así el 2♥ es jugada legal (mismo número)
  currentPlayerId: H,
  hands: { [H]: [card("h2h", "H", "2"), card("hextra", "D", "4")], [G]: [card("g2s", "S", "2"), card("gx", "H", "9")] },
  deck: filler(20),
});
host.send("playCards", { cardIds: ["h2h"], observedVersion: 0 });
await sleep(140);
host.state.pendingDraw === 2 && host.state.currentPlayerId === G ? ok("2 → pending 2, pasa al siguiente") : bad(`pending=${host.state.pendingDraw} cur=${host.state.currentPlayerId}`);
guest.send("playCards", { cardIds: ["g2s"], observedVersion: 0 });
await sleep(140);
host.state.pendingDraw === 4 && host.state.currentPlayerId === H ? ok("2 sobre 2 → pending 4") : bad(`pending=${host.state.pendingDraw} cur=${host.state.currentPlayerId}`);
host.send("drawCard");
await sleep(160);
hc(H) === 5 && host.state.pendingDraw === 0 ? ok("robó 4 y quedó salteado (1+4=5)") : bad(`handCount host=${hc(H)} pending=${host.state.pendingDraw}`);

// --- J saltea (2 jugadores: vuelve a sí mismo) ------------------------------
console.log("Efecto J (saltea):");
await setup({
  top: card("t5c", "C", "5"),
  currentPlayerId: H,
  hands: { [H]: [card("hjc", "C", "J"), card("hx", "C", "4")], [G]: [card("gx2", "H", "9")] },
  deck: filler(20),
});
host.send("playCards", { cardIds: ["hjc"], observedVersion: 0 });
await sleep(140);
host.state.currentPlayerId === H ? ok("J salteó a Guest (en 2p vuelve a Host)") : bad(`current=${host.state.currentPlayerId}`);

// --- Regla 2s: jugada mal muy rápida se rechaza en silencio ----------------
console.log("Regla 2s (jugada mal muy rápida):");
rejects.length = 0;
await setup({
  top: card("t2fast", "C", "5"),
  currentPlayerId: H,
  hands: { [H]: [card("hf9", "H", "9"), card("hf10", "H", "10")], [G]: [card("gf9", "H", "9")] },
  deck: filler(20),
});
host.send("playCards", { cardIds: ["hf9"], observedVersion: 0 }); // inmediato (<2s), ilegal
await sleep(250);
hc(H) === 2 && host.state.top.rank === "5" ? ok("rechazada: top intacto y la carta volvió") : bad(`hc=${hc(H)} top=${host.state.top.rank}`);
rejects.length > 0 ? ok("el jugador recibió 'rejected'") : bad("no llegó rejected");

// --- Challenge válido (jugada ilegal tras esperar >2s) ---------------------
console.log("Challenge válido:");
jodeteResults.length = 0;
await setup({
  top: card("t5c2", "C", "5"),
  currentPlayerId: H,
  hands: { [H]: [card("h9h", "H", "9"), card("hf", "H", "10")], [G]: [card("gz", "H", "9")] },
  deck: filler(20),
});
await sleep(2200); // pasa la ventana de 2s -> ahora la jugada mal queda en pie
host.send("playCards", { cardIds: ["h9h"], observedVersion: 0 }); // 9H ilegal sobre 5C
await sleep(150);
host.state.top.rank === "9" ? ok("la jugada ilegal quedó en pie (permisivo)") : bad("no se permitió la jugada ilegal");
guest.send("callJodete");
await sleep(180);
host.state.top.rank === "5" ? ok("rollback: volvió el 5 al tope") : bad(`tope tras jodete=${host.state.top.rank}`);
hc(H) === 5 ? ok("culpable recuperó su carta + robó 3 (2+3=5)") : bad(`handCount host=${hc(H)}`);
jodeteResults.at(-1)?.valid === true ? ok("jodeteResult valid=true") : bad("no llegó jodeteResult válido");

// --- Challenge falso --------------------------------------------------------
console.log("Challenge falso:");
jodeteResults.length = 0;
await setup({
  top: card("t5c3", "C", "5"),
  currentPlayerId: H,
  hands: { [H]: [card("h5d", "D", "5")], [G]: [card("gz2", "H", "9")] },
  deck: filler(20),
});
host.send("playCards", { cardIds: ["h5d"], observedVersion: 0 }); // 5D legal (mismo número)
await sleep(150);
guest.send("callJodete");
await sleep(160);
hc(G) === 4 ? ok("acusador falso robó 3 (1+3=4)") : bad(`handCount guest=${hc(G)}`);
jodeteResults.at(-1)?.valid === false ? ok("jodeteResult valid=false") : bad("no llegó jodeteResult falso");

// --- UNA: acusar al que no cantó -------------------------------------------
console.log("UNA:");
await setup({
  top: card("t5c4", "C", "5"),
  currentPlayerId: H,
  hands: { [H]: [card("h5d2", "D", "5"), card("h5h", "H", "5")], [G]: [card("gz3", "H", "9")] },
  deck: filler(20),
});
host.send("playCards", { cardIds: ["h5d2"], observedVersion: 0 }); // queda con 1 carta
await sleep(150);
hc(H) === 1 ? ok("Host quedó con 1 carta") : bad(`handCount host=${hc(H)}`);
guest.send("accuseUna", { targetId: H });
await sleep(150);
hc(H) === 4 ? ok("no dijo UNA → +3") : bad(`handCount host=${hc(H)}`);

// --- As de pic: cancela efecto ---------------------------------------------
console.log("As de pic (cancela efecto):");
await setup({
  top: card("tac", "C", "2"),
  currentPlayerId: H,
  hands: { [H]: [card("h2h", "H", "2"), card("hx", "D", "4")], [G]: [card("gap", "S", "A"), card("gy", "H", "9")] },
  deck: filler(20),
});
host.send("playCards", { cardIds: ["h2h"], observedVersion: 0 }); // 2H legal sobre 2C -> pending 2
await sleep(150);
host.state.pendingDraw === 2 ? ok("2 jugado: pending 2") : bad(`pending=${host.state.pendingDraw}`);
guest.send("playAsPic", { cardId: "gap" });
await sleep(160);
host.state.pendingDraw === 0 ? ok("As de pic canceló el robo (pending 0)") : bad(`pending=${host.state.pendingDraw}`);
host.state.currentPlayerId === G ? ok("turno correcto tras cancelar") : bad(`current=${host.state.currentPlayerId}`);
hc(G) === 2 ? ok("el que tiró As de pic robó 1 (2-1+1=2)") : bad(`handCount guest=${hc(G)}`);

rejects.length = 0;
await setup({
  top: card("tnorm", "C", "5"),
  currentPlayerId: H,
  hands: { [H]: [card("h5d", "D", "5")], [G]: [card("gap2", "S", "A"), card("gy2", "H", "9")] },
  deck: filler(20),
});
guest.send("playAsPic", { cardId: "gap2" }); // no hay efecto para cancelar
await sleep(140);
rejects.length > 0 ? ok("As de pic sin efecto rechazado") : bad("no rechazó As de pic sin efecto");

console.log(failed === 0 ? "\n✅ SMOKE M2-M4 OK" : `\n❌ ${failed} fallo(s)`);
await host.leave();
await guest.leave();
process.exit(failed === 0 ? 0 : 1);
