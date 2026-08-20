import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  INITIAL_HAND_SIZE,
  DECK_COUNT,
  PENALTY_DRAW,
  CHALLENGE_MAX_CARDS_ABOVE,
  MIN_PERMANENCIA_MS,
  ClientMsg,
  ServerMsg,
  buildDecks,
  shuffle,
  cardPoints,
  isLegalPlay,
  isIdentical,
  isJoker,
  isAcePic,
  isEffectCard,
  Suit,
  SUITS,
  suitSymbol,
  type Card,
  type JoinOptions,
  type PlayCardsPayload,
  type DeclareSuitPayload,
  type AccuseUnaPayload,
  type HandEndPayload,
  type JodeteResultPayload,
  type ToastPayload,
  type CardPlayedPayload,
} from "@jodete/shared";

// ============================================================================
// Schema sincronizado (público). Manos privadas fuera del schema (mensaje directo).
// ============================================================================
export class CardSchema extends Schema {
  @type("string") id = "";
  @type("string") suit = ""; // "" = comodín
  @type("string") rank = "";
}
function toCardSchema(c: Card): CardSchema {
  const cs = new CardSchema();
  cs.id = c.id;
  cs.suit = c.suit ?? "";
  cs.rank = c.rank;
  return cs;
}

export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("boolean") ready = false;
  @type("boolean") connected = true;
  @type("boolean") isHost = false;
  @type("boolean") isBot = false;
  @type("boolean") saidUna = false;
  @type("uint8") handCount = 0;
}

export class GameState extends Schema {
  @type("string") code = "";
  @type("string") phase = "lobby";
  @type("string") hostId = "";
  @type("string") currentPlayerId = "";
  @type("int8") direction = 1;
  @type("uint16") deckCount = 0;
  @type("uint8") pendingDraw = 0;
  @type("string") pendingKind = ""; // "" | "two" | "wild"
  @type("boolean") drawnThisTurn = false; // el jugador de turno ya robó
  @type("string") activeSuit = ""; // palo en vigor ("" si el tope es comodín sin elección)
  @type("boolean") suitOpen = false; // tras un 8/comodín sin elegir: cualquier carta es legal
  @type("string") suitPendingBy = ""; // jugador que debe elegir el palo (o "")
  @type(CardSchema) top = new CardSchema();
  @type(["string"]) turnOrder = new ArraySchema<string>();
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: "number" }) scores = new MapSchema<number>();
}

// Ventana de permanencia: una jugada ILEGAL solo se acepta si pasaron >= este
// tiempo desde que se colocó la carta anterior. Configurable para tests.
const PERMANENCIA_MS = Number(process.env.JODETE_PERMANENCIA_MS ?? MIN_PERMANENCIA_MS);

// Timeout de turno (anti-stall): 0 = APAGADO (default). Se puede prender con env.
const TURN_TIMEOUT = Number(process.env.JODETE_TURN_TIMEOUT_MS ?? 0);

// Ventana de reconexión: ante un corte de red (no una salida voluntaria) el
// asiento y la mano del jugador se reservan estos segundos esperando que el
// cliente vuelva con client.reconnect(). Configurable para tests.
const RECONNECT_WINDOW_SEC = Number(process.env.JODETE_RECONNECT_SEC ?? 60);

// Bots: demora antes de actuar y probabilidad de jugar mal.
const BOT_DELAY_MS = Number(process.env.JODETE_BOT_DELAY_MS ?? 3000);
const BOT_MISTAKE = Number(process.env.JODETE_BOT_MISTAKE ?? 0.02);
const BOT_NAMES = ["Walter", "Ana", "Beto", "Caro", "Dani", "Eze", "Fer", "Gus"];

// ---- Estado plano (clonable) del juego -------------------------------------
type PendingKind = "" | "two" | "wild";
interface G {
  turnOrder: string[];
  currentPlayerId: string;
  direction: 1 | -1;
  deck: Card[];
  discard: Card[];
  aside: Card[]; // cartas fuera de juego (As de pic tirados aparte)
  hands: Record<string, Card[]>;
  activeSuit: Suit | null;
  suitOpen: boolean; // 8/comodín jugado sin palo elegido: cualquier carta vale
  suitPendingBy: string; // jugador que debe elegir el palo (o "")
  pendingDraw: number;
  pendingKind: PendingKind;
  connected: Record<string, boolean>;
  saidUna: Record<string, boolean>;
  drawnThisTurn: boolean;
  topSetAt: number; // ms (reloj del server) en que se colocó el tope actual
  turnStartedAt: number; // ms en que empezó el turno actual
}

// Log del engine reversible (para el challenge).
interface PlayLog {
  seq: number;
  playerId: string;
  kind: "play" | "espejito";
  legal: boolean;
  topCard: Card; // la carta que quedó de tope con esta jugada (para el As de pic)
  discardTopIndex: number; // índice en discard del tope de esta jugada
  snapshotBefore: G;
}
interface DrawLog {
  seq: number;
  playerId: string;
  cardId: string;
}

interface DevSetup {
  hands: Record<string, Card[]>;
  top: Card;
  deck?: Card[];
  turnOrder?: string[];
  currentPlayerId?: string;
  direction?: 1 | -1;
  activeSuit?: Suit | null;
}

export class GameRoom extends Room<GameState> {
  maxClients = MAX_PLAYERS;

  private g!: G;
  private plays: PlayLog[] = [];
  private draws: DrawLog[] = [];
  private seq = 0;

  // Timer de turno (15s) — anti-stall.
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private armedCurrent = "";
  private turnEpoch = 0;

  // Bots (viven en el server, sin cliente).
  private botTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private botSeq = 0;
  private lastTopId = "";

  // ==========================================================================
  onCreate(options: Partial<JoinOptions>) {
    this.state = new GameState();
    this.state.code = (options.code ?? "").toUpperCase();
    this.setMetadata({ code: this.state.code });

    this.onMessage(ClientMsg.Ready, (client, ready: boolean) => {
      if (this.state.phase !== "lobby") return;
      const p = this.state.players.get(client.sessionId);
      if (p) p.ready = !!ready;
    });
    this.onMessage(ClientMsg.Start, (client) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.state.phase !== "lobby") return;
      const players = [...this.state.players.values()];
      if (players.length < MIN_PLAYERS || !players.every((p) => p.ready)) return;
      this.startHand();
    });
    this.onMessage(ClientMsg.PlayCards, (c, p: PlayCardsPayload) => this.handlePlay(c, p));
    this.onMessage(ClientMsg.DeclareSuit, (c, p: DeclareSuitPayload) => this.handleDeclareSuit(c, p));
    this.onMessage(ClientMsg.PlayEspejito, (c, p: { cardId: string }) => this.handleEspejito(c, p));
    this.onMessage(ClientMsg.PlayAsPic, (c, p: { cardId: string }) => this.handleAsPic(c, p));
    this.onMessage(ClientMsg.DrawCard, (c) => this.handleDraw(c));
    this.onMessage(ClientMsg.Pass, (c) => this.handlePass(c));
    this.onMessage(ClientMsg.SayUna, (c) => this.handleSayUna(c));
    this.onMessage(ClientMsg.AccuseUna, (c, p: AccuseUnaPayload) => this.handleAccuseUna(c, p));
    this.onMessage(ClientMsg.CallJodete, (c) => this.handleCallJodete(c));
    this.onMessage(ClientMsg.PlayAgain, (client) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.state.phase !== "handEnd") return;
      this.startHand();
    });
    this.onMessage(ClientMsg.AddBot, (client) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby") return;
      this.addBot();
    });
    this.onMessage(ClientMsg.RemoveBot, (client, p: { botId: string }) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby") return;
      const pl = this.state.players.get(p?.botId);
      if (pl?.isBot) {
        this.state.players.delete(p.botId);
        this.state.scores.delete(p.botId);
      }
    });
    this.onMessage(ClientMsg.SetBots, (client, p: { count: number }) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby") return;
      this.setBots(p?.count);
    });

    // Hook de test (solo con JODETE_TEST=1): arma escenarios deterministas.
    if (process.env.JODETE_TEST === "1") {
      this.onMessage("__setup", (_client, s: DevSetup) => this.devSetup(s));
    }
  }

  private devSetup(s: DevSetup) {
    const ids = [...this.state.players.keys()];
    const order = s.turnOrder ?? ids;
    this.g = {
      turnOrder: order,
      currentPlayerId: s.currentPlayerId ?? order[0],
      direction: s.direction ?? 1,
      deck: s.deck ?? [],
      discard: [s.top],
      aside: [],
      hands: s.hands,
      activeSuit: s.activeSuit ?? s.top.suit,
      suitOpen: false,
      suitPendingBy: "",
      pendingDraw: 0,
      pendingKind: "",
      connected: Object.fromEntries(ids.map((i) => [i, true])),
      saidUna: Object.fromEntries(ids.map((i) => [i, false])),
      drawnThisTurn: false,
      topSetAt: Date.now(),
      turnStartedAt: Date.now(),
    };
    this.plays = [];
    this.draws = [];
    this.seq = 0;
    this.armedCurrent = "";
    this.state.turnOrder = new ArraySchema<string>(...order);
    this.state.phase = "playing";
    this.lock();
    this.state.top = toCardSchema(s.top);
    this.syncPublic();
    for (const id of ids) this.sendHand(id);
  }

  onJoin(client: Client, options: Partial<JoinOptions>) {
    const p = new Player();
    p.id = client.sessionId;
    p.name = (options.name ?? "Anon").slice(0, 20) || "Anon";
    if (this.state.players.size === 0) {
      p.isHost = true;
      this.state.hostId = client.sessionId;
    }
    this.state.players.set(client.sessionId, p);
    if (!this.state.scores.has(client.sessionId)) this.state.scores.set(client.sessionId, 0);
    console.log(`[jodete] join ${p.name} en sala ${this.state.code}`);
  }

  async onLeave(client: Client, consented?: boolean) {
    const id = client.sessionId;
    if (this.state.phase === "lobby") {
      this.state.players.delete(id);
      this.state.scores.delete(id);
      if (id === this.state.hostId) {
        const next = [...this.state.players.values()][0];
        if (next) {
          next.isHost = true;
          this.state.hostId = next.id;
        }
      }
      return;
    }
    // En partida: NO eliminamos al jugador. Lo marcamos desconectado (su asiento
    // y su mano quedan reservados) y, si le tocaba, pasamos el turno.
    const p = this.state.players.get(id);
    if (p) p.connected = false;
    if (this.g) {
      this.g.connected[id] = false;
      if (this.g.currentPlayerId === id) this.stepTurn(1);
      this.syncPublic();
    }

    // Salida voluntaria (botón "Salir"): no reservamos el asiento, se va y listo.
    if (consented) return;

    // Corte de red: esperamos a que el cliente vuelva con client.reconnect()
    // dentro de la ventana. allowReconnection() no pasa por el matchmaking, así
    // que reengancha aunque la sala esté trabada (lock() en partida).
    try {
      await this.allowReconnection(client, RECONNECT_WINDOW_SEC);
      // Volvió a tiempo: reactivamos su asiento y le reenviamos su mano privada.
      const back = this.state.players.get(id);
      if (back) back.connected = true;
      if (this.g) this.g.connected[id] = true;
      this.syncPublic();
      this.sendHand(id);
      console.log(`[jodete] reconnect ${this.nameOf(id)} en sala ${this.state.code}`);
    } catch {
      // No volvió a tiempo: recién ahora lo damos por ido de verdad. Queda como
      // desconectado (su asiento se mantiene para no romper el turnOrder).
      console.log(`[jodete] ${this.nameOf(id)} no reconectó a tiempo en ${this.state.code}`);
    }
  }

  // ==========================================================================
  // Mano
  // ==========================================================================
  private startHand() {
    const ids = [...this.state.players.keys()];
    const deck = shuffle(buildDecks(DECK_COUNT), Math.random);
    const hands: Record<string, Card[]> = {};
    for (const id of ids) hands[id] = deck.splice(0, INITIAL_HAND_SIZE);
    const first = deck.shift()!;

    this.g = {
      turnOrder: ids,
      currentPlayerId: ids[Math.floor(Math.random() * ids.length)],
      direction: 1,
      deck,
      discard: [first],
      aside: [],
      hands,
      activeSuit: first.suit,
      suitOpen: false,
      suitPendingBy: "",
      pendingDraw: 0,
      pendingKind: "",
      connected: Object.fromEntries(ids.map((id) => [id, this.state.players.get(id)?.connected ?? true])),
      saidUna: Object.fromEntries(ids.map((id) => [id, false])),
      drawnThisTurn: false,
      topSetAt: Date.now(),
      turnStartedAt: Date.now(),
    };
    this.plays = [];
    this.draws = [];
    this.seq = 0;
    this.armedCurrent = "";
    this.clearAllBotTimers();
    this.lastTopId = "";

    this.state.turnOrder = new ArraySchema<string>(...ids);
    this.state.phase = "playing";
    this.state.top = toCardSchema(first); // ¡faltaba! sin esto el cliente no ve el tope
    this.lock();
    this.syncPublic();
    for (const id of ids) this.sendHand(id);
  }

  private endHand(cutterId: string) {
    const roundPoints: Record<string, number> = {};
    for (const id of this.g.turnOrder) {
      const pts = (this.g.hands[id] ?? []).reduce((s, c) => s + cardPoints(c), 0);
      roundPoints[id] = pts;
      this.state.scores.set(id, (this.state.scores.get(id) ?? 0) + pts);
    }
    this.state.phase = "handEnd";
    this.state.currentPlayerId = "";
    this.clearTurnTimer();
    this.clearAllBotTimers();
    this.armedCurrent = "";
    this.unlock();
    const payload: HandEndPayload = { cutterId, roundPoints };
    this.broadcast(ServerMsg.HandEnd, payload);
  }

  // ==========================================================================
  // Jugada normal (permisiva: se permite jugar mal; queda challengeable)
  // ==========================================================================
  private handlePlay(client: Client, payload: PlayCardsPayload) {
    const id = client.sessionId;
    if (this.state.phase !== "playing") return;
    // G9: jugar fuera de turno NO se rechaza; es una jugada ILEGAL y challengeable.
    const outOfTurn = id !== this.g.currentPlayerId;

    const hand = this.g.hands[id] ?? [];
    const ids = payload?.cardIds ?? [];
    if (ids.length === 0) return this.reject(client, "sin cartas");

    const cards: Card[] = [];
    for (const cid of ids) {
      const c = hand.find((h) => h.id === cid);
      if (!c) return this.reject(client, "no tenés esa carta");
      cards.push(c);
    }
    if (cards.length > 1) {
      if (isJoker(cards[0])) return this.reject(client, "no se apilan comodines");
      if (!cards.every((c) => c.rank === cards[0].rank))
        return this.reject(client, "multi-carta: mismo número");
    }
    // Restricciones duras que mantienen sano el mazo de robo (solo en tu turno):
    if (!outOfTurn) {
      if (this.g.pendingKind === "wild") return this.reject(client, "robá 4 antes de jugar");
      if (this.g.pendingKind === "two" && cards[0].rank !== "2")
        return this.reject(client, "hay un 2 en juego: tirá otro 2 o robá");
    }

    // Una jugada fuera de turno es SIEMPRE ilegal (independiente del palo/número).
    const legal = !outOfTurn && isLegalPlay(cards[0], {
      topRank: this.topCard().rank,
      activeSuit: this.g.activeSuit,
      pendingKind: this.g.pendingKind || null,
      suitOpen: this.g.suitOpen,
    });

    // Regla de los 2s: una jugada MAL solo se acepta si pasaron >= PERMANENCIA_MS
    // desde la carta anterior. Si es muy rápida, se rechaza en silencio (la carta
    // vuelve, nadie más la ve). Las jugadas legales nunca se filtran.
    if (!legal && Date.now() - this.g.topSetAt < PERMANENCIA_MS) {
      return this.reject(client, "muy rápido: esa carta no correspondía");
    }

    // Fuera de turno, la jugada se resuelve desde la posición del que la hizo
    // (como el espejito): el turno avanza a partir de él.
    if (outOfTurn) this.g.currentPlayerId = id;

    this.applyPlay(id, cards, legal, payload.declaredSuit);
  }

  /** Aplica una jugada (ya validada): snapshot, mover cartas, efecto, cierre. */
  private applyPlay(id: string, cards: Card[], legal: boolean, declaredSuit?: Suit) {
    const hand = this.g.hands[id] ?? [];
    const wasAtOne = hand.length === 1;

    // G10: la ÚLTIMA carta no puede jugarse de forma ilegal. El sistema lo impide:
    // auto-declara JODETE, te hace robar 3 y devuelve la carta (no cortás con jugada mala).
    if (wasAtOne && !legal) {
      this.drawN(id, PENALTY_DRAW); // la carta mal tirada nunca sale de la mano (se "devuelve")
      this.g.saidUna[id] = false;
      this.g.currentPlayerId = id;
      this.g.drawnThisTurn = false;
      const name = this.state.players.get(id)?.name ?? "Alguien";
      this.toast(`${name} intentó cortar mal: ¡JODETE! +${PENALTY_DRAW}`, "penalty");
      this.syncPublic();
      this.sendHand(id);
      return;
    }

    const snapshotBefore = structuredClone(this.g);
    const playedIds = new Set(cards.map((c) => c.id));
    this.g.hands[id] = hand.filter((h) => !playedIds.has(h.id));
    for (const c of cards) this.g.discard.push(c);
    this.plays.push({
      seq: this.seq++,
      playerId: id,
      kind: "play",
      legal,
      topCard: cards[cards.length - 1],
      discardTopIndex: this.g.discard.length - 1,
      snapshotBefore,
    });
    this.applyEffects(id, cards, declaredSuit);
    this.afterPlay(id, wasAtOne);
  }

  /** Abre el palo tras un 8/comodín sin elección: cualquier carta pasa a ser
   *  legal hasta que `playerId` elija (DeclareSuit) o alguien tire una carta. */
  private openSuit(playerId: string) {
    this.g.activeSuit = null;
    this.g.suitOpen = true;
    this.g.suitPendingBy = playerId;
  }

  /** Elección diferida del palo tras un 8/comodín. Solo la puede hacer quien
   *  jugó la carta y solo mientras el palo siga abierto (si el siguiente ya
   *  tiró, perdió la prioridad y esto se ignora). */
  private handleDeclareSuit(client: Client, payload: DeclareSuitPayload) {
    if (this.state.phase !== "playing") return;
    const id = client.sessionId;
    if (!this.g.suitOpen || this.g.suitPendingBy !== id) return; // ya no te toca
    const suit = payload?.suit;
    if (!SUITS.includes(suit)) return this.reject(client, "palo inválido");
    this.g.activeSuit = suit;
    this.g.suitOpen = false;
    this.g.suitPendingBy = "";
    // La elección cambia QUÉ es legal: reseteamos la ventana de permanencia para
    // que una jugada del siguiente que ya no corresponde (carrera: eligió el palo
    // justo antes) se revierta sin penalización, igual que el espejito.
    this.g.topSetAt = Date.now();
    this.toast(`${this.nameOf(id)} eligió ${suitSymbol(suit)}`, "effect");
    this.syncPublic();
  }

  // ==========================================================================
  // Espejito (fuera de turno, instantáneo, validado por identidad)
  // ==========================================================================
  private handleEspejito(client: Client, payload: { cardId: string }) {
    const id = client.sessionId;
    if (this.state.phase !== "playing") return;
    const hand = this.g.hands[id] ?? [];
    const card = hand.find((h) => h.id === payload?.cardId);
    if (!card) return this.reject(client, "no tenés esa carta");
    const top = this.topCard();
    if (isJoker(top) || isJoker(card)) return this.reject(client, "no se hace espejito a comodín");
    if (!isIdentical(card, top)) return this.reject(client, "no es idéntica al tope");
    this.applyEspejito(id, card);
  }

  /** Aplica un espejito (ya validado). */
  private applyEspejito(id: string, card: Card) {
    const hand = this.g.hands[id] ?? [];
    const wasAtOne = hand.length === 1;
    const snapshotBefore = structuredClone(this.g);
    this.g.hands[id] = hand.filter((h) => h.id !== card.id);
    this.g.discard.push(card);
    this.plays.push({
      seq: this.seq++,
      playerId: id,
      kind: "espejito",
      legal: true,
      topCard: card,
      discardTopIndex: this.g.discard.length - 1,
      snapshotBefore,
    });
    this.g.activeSuit = card.suit;
    this.g.suitOpen = false; // un espejito adelantado también cierra el palo abierto
    this.g.suitPendingBy = "";
    if (card.rank === "2") {
      this.g.pendingDraw += 2;
      this.g.pendingKind = "two";
    }
    this.g.currentPlayerId = id;
    this.stepTurn(1);
    this.g.drawnThisTurn = false;
    this.toast(`${this.nameOf(id)} hizo espejito ${card.rank}${card.suit}`, "espejito");
    this.afterPlay(id, wasAtOne, true);
  }

  // ==========================================================================
  // As de pic: cancela el efecto de la última carta (fuera de turno)
  // ==========================================================================
  private handleAsPic(client: Client, payload: { cardId: string }) {
    const id = client.sessionId;
    if (this.state.phase !== "playing") return;
    const hand = this.g.hands[id] ?? [];
    const card = hand.find((h) => h.id === payload?.cardId);
    if (!card) return this.reject(client, "no tenés esa carta");
    if (!isAcePic(card)) return this.reject(client, "esa no es el As de pic");
    const last = this.plays[this.plays.length - 1];
    if (!last || !isEffectCard(last.topCard)) return this.reject(client, "no hay efecto para cancelar");

    // El efecto se anula: la carta de efecto sigue de tope pero actúa como carta común.
    const dirBefore = last.snapshotBefore.direction;
    const suitAfter = isJoker(last.topCard) ? last.snapshotBefore.activeSuit : last.topCard.suit;
    this.g.pendingDraw = 0; // cancela robos (incluye varios 2 apilados, 3.6)
    this.g.pendingKind = "";
    this.g.direction = dirBefore; // revierte K
    this.g.activeSuit = suitAfter; // 3.7/3.8
    this.g.currentPlayerId = last.playerId;
    this.stepTurn(1); // le toca al que hubiera sido el primer salteado

    // Se tira aparte (no al pozo) y el que lo jugó roba 1 (3.4/3.5).
    this.g.hands[id] = hand.filter((h) => h.id !== card.id);
    this.g.aside.push(card);
    this.drawN(id, 1);

    this.toast(`${this.nameOf(id)} tiró As de pic y canceló el efecto`, "effect");
    this.syncPublic();
    this.sendHand(id);
  }

  /** Cierre común tras jugar/espejito: corte, UNA, sync. */
  private afterPlay(playerId: string, wasAtOne: boolean, espejito = false) {
    const top = this.topCard();
    this.state.top = toCardSchema(top);
    this.g.topSetAt = Date.now(); // nueva carta anterior para la ventana de 2s
    this.broadcast(ServerMsg.CardPlayed, { playerId, card: top, espejito } satisfies CardPlayedPayload);
    const remaining = this.g.hands[playerId]?.length ?? 0;

    if (remaining === 0) {
      // Corte. Si venía de tener 1 carta y no dijo UNA → penaliza, no corta.
      if (wasAtOne && !this.g.saidUna[playerId]) {
        this.drawN(playerId, PENALTY_DRAW);
        this.g.saidUna[playerId] = false;
        const name = this.state.players.get(playerId)?.name ?? "Alguien";
        this.toast(`${name} cortó sin decir UNA: +${PENALTY_DRAW}`, "penalty");
        this.syncPublic();
        this.sendHand(playerId);
        return;
      }
      this.syncPublic();
      this.sendHand(playerId);
      this.endHand(playerId);
      return;
    }
    this.syncPublic();
    this.sendHand(playerId);
  }

  // ==========================================================================
  // Efectos de cartas (M3)
  // ==========================================================================
  private applyEffects(playerId: string, cards: Card[], declaredSuit?: Suit) {
    const last = cards[cards.length - 1];
    const n = cards.length;
    this.g.drawnThisTurn = false;
    // Cualquier carta nueva cierra un palo que hubiera quedado abierto: el que
    // se adelantó ganó la "carrera" y su carta define el palo (el 8/comodín
    // vuelve a abrirlo abajo si tampoco eligió palo).
    this.g.suitOpen = false;
    this.g.suitPendingBy = "";

    if (isJoker(last)) {
      this.g.pendingDraw += 4;
      this.g.pendingKind = "wild";
      // El comodín no tiene palo: si no se declaró, queda ABIERTO hasta que el
      // jugador elija (modal) o el siguiente tire una carta.
      if (declaredSuit) this.g.activeSuit = declaredSuit;
      else this.openSuit(playerId);
      this.stepTurn(1);
      return;
    }
    switch (last.rank) {
      case "2":
        this.g.pendingDraw += 2 * n;
        this.g.pendingKind = "two";
        this.g.activeSuit = last.suit;
        this.stepTurn(1);
        break;
      case "8":
        // Con la carta ya jugada, el modal de palo llega DESPUÉS: si no vino un
        // palo declarado (humano), el palo queda abierto hasta que se elija.
        this.g.pendingKind = "";
        if (declaredSuit) this.g.activeSuit = declaredSuit;
        else this.openSuit(playerId);
        this.stepTurn(1);
        break;
      case "J": // saltea al próximo (por cada J)
        this.g.activeSuit = last.suit;
        this.stepTurn(1 + n);
        break;
      case "Q": // saltea 2 (por cada Q)
        this.g.activeSuit = last.suit;
        this.stepTurn(1 + 2 * n);
        break;
      case "K": // invierte (impar => invierte)
        if (n % 2 === 1) this.g.direction = (this.g.direction * -1) as 1 | -1;
        this.g.activeSuit = last.suit;
        this.stepTurn(1);
        break;
      default:
        this.g.activeSuit = last.suit;
        this.stepTurn(1);
    }
  }

  // ==========================================================================
  // Robar / pasar
  // ==========================================================================
  private handleDraw(client: Client) {
    const id = client.sessionId;
    if (this.state.phase !== "playing" || id !== this.g.currentPlayerId) return;
    if (!this.doDrawFor(id)) this.reject(client, "ya robaste este turno");
  }

  /** Núcleo de robar (usado por clientes y bots). Devuelve false si ya robó. */
  private doDrawFor(id: string): boolean {
    if (this.g.pendingKind === "two" && this.g.pendingDraw > 0) {
      const n = this.g.pendingDraw;
      this.drawN(id, n);
      this.g.pendingDraw = 0;
      this.g.pendingKind = "";
      this.toast(`${this.nameOf(id)} robó ${n} y es salteado`, "effect");
      this.stepTurn(1); // salteado
      this.syncPublic();
      this.sendHand(id);
      return true;
    }
    if (this.g.pendingKind === "wild" && this.g.pendingDraw > 0) {
      const n = this.g.pendingDraw;
      this.drawN(id, n);
      this.g.pendingDraw = 0;
      this.g.pendingKind = "";
      this.g.drawnThisTurn = true; // ahora juega
      this.toast(`${this.nameOf(id)} robó ${n}`, "effect");
      this.syncPublic();
      this.sendHand(id);
      return true;
    }
    if (this.g.drawnThisTurn) return false;
    this.drawN(id, 1);
    this.g.drawnThisTurn = true;
    this.syncPublic();
    this.sendHand(id);
    return true;
  }

  private handlePass(client: Client) {
    const id = client.sessionId;
    if (this.state.phase !== "playing" || id !== this.g.currentPlayerId) return;
    if (this.g.pendingDraw > 0) return this.reject(client, "resolvé el efecto: robá");
    if (!this.g.drawnThisTurn) return this.reject(client, "robá una carta antes de pasar");
    this.doPass(id);
  }

  private doPass(id: string) {
    this.stepTurn(1);
    this.syncPublic();
  }

  // ==========================================================================
  // UNA
  // ==========================================================================
  private handleSayUna(client: Client) {
    const id = client.sessionId;
    if (this.state.phase !== "playing") return;
    if ((this.g.hands[id]?.length ?? 0) !== 1) return this.reject(client, "no tenés 1 carta");
    this.g.saidUna[id] = true;
    this.toast(`${this.nameOf(id)} dijo ¡UNA!`, "info");
    this.syncPublic();
  }

  private handleAccuseUna(client: Client, payload: AccuseUnaPayload) {
    if (this.state.phase !== "playing") return;
    const target = payload?.targetId;
    if (!target || !this.g.hands[target]) return;
    if ((this.g.hands[target].length ?? 0) === 1 && !this.g.saidUna[target]) {
      this.drawN(target, PENALTY_DRAW);
      this.toast(`${this.nameOf(target)} no dijo UNA: +${PENALTY_DRAW}`, "penalty");
      this.syncPublic();
      this.sendHand(target);
    } else {
      this.reject(client, "no corresponde acusar");
    }
  }

  // ==========================================================================
  // Challenge (JODETE)
  // ==========================================================================
  private handleCallJodete(client: Client) {
    if (this.state.phase !== "playing") return;
    this.resolveJodete(client.sessionId);
  }

  /** Jugada ilegal aún challengeable (dentro de la ventana de cartas). null si no hay. */
  private challengeTarget(): PlayLog | null {
    const topIndex = this.g.discard.length - 1;
    for (let i = this.plays.length - 1; i >= 0; i--) {
      const p = this.plays[i];
      if (topIndex - p.discardTopIndex > CHALLENGE_MAX_CARDS_ABOVE) break;
      if (!p.legal) return p;
    }
    return null;
  }

  /** Resuelve un JODETE de `accuser` (humano o bot): castiga al culpable o al acusador. */
  private resolveJodete(accuser: string) {
    if (this.state.phase !== "playing") return;
    const target = this.challengeTarget();

    if (target) {
      this.rollbackTo(target);
      const payload: JodeteResultPayload = {
        valid: true,
        accuserId: accuser,
        culpritId: target.playerId,
        reason: "jugada inválida",
      };
      this.broadcast(ServerMsg.JodeteResult, payload);
      this.toast(`¡JODETE! ${this.nameOf(target.playerId)} jugó mal: +${PENALTY_DRAW}`, "penalty");
    } else {
      this.drawN(accuser, PENALTY_DRAW);
      const payload: JodeteResultPayload = {
        valid: false,
        accuserId: accuser,
        reason: "la jugada era válida",
      };
      this.broadcast(ServerMsg.JodeteResult, payload);
      this.toast(`JODETE falso de ${this.nameOf(accuser)}: +${PENALTY_DRAW}`, "penalty");
      this.syncPublic();
      this.sendHand(accuser);
    }
  }

  /** Revierte al estado previo a la jugada mala, preservando cartas robadas. */
  private rollbackTo(target: PlayLog) {
    const restored = structuredClone(target.snapshotBefore);
    // Re-aplicar los robos posteriores a la jugada mala (se conservan).
    for (const d of this.draws) {
      if (d.seq <= target.seq) continue;
      const idx = restored.deck.findIndex((c) => c.id === d.cardId);
      if (idx >= 0) {
        const [card] = restored.deck.splice(idx, 1);
        (restored.hands[d.playerId] ??= []).push(card);
      }
    }
    this.g = restored;
    // Penalidad al culpable.
    this.drawN(target.playerId, PENALTY_DRAW);
    this.g.currentPlayerId = target.playerId;
    this.g.drawnThisTurn = false;
    // No se puede challengear a través de este punto.
    this.plays = [];
    this.draws = [];
    this.seq = 0;

    this.state.top = toCardSchema(this.topCard());
    this.g.topSetAt = Date.now();
    this.syncPublic();
    for (const id of this.g.turnOrder) this.sendHand(id);
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================
  private topCard(): Card {
    return this.g.discard[this.g.discard.length - 1];
  }
  private nameOf(id: string): string {
    return this.state.players.get(id)?.name ?? "Alguien";
  }

  private stepTurn(times = 1) {
    const order = this.g.turnOrder;
    const n = order.length;
    if (n === 0) return;
    const anyConnected = order.some((id) => this.g.connected[id]);
    if (!anyConnected) return;
    let idx = order.indexOf(this.g.currentPlayerId);
    if (idx < 0) idx = 0;
    let moved = 0;
    let guard = 0;
    while (moved < times && guard < n * (times + 1) + n) {
      idx = (idx + this.g.direction + n) % n;
      guard++;
      if (this.g.connected[order[idx]]) moved++;
    }
    this.g.currentPlayerId = order[idx];
    this.g.drawnThisTurn = false;
  }

  private ensureDeck() {
    if (this.g.deck.length > 0) return;
    // Recicla el pozo (menos el tope) + los As de pic tirados aparte.
    const pool = [...this.g.aside];
    this.g.aside = [];
    if (this.g.discard.length > 1) {
      const top = this.g.discard.pop()!;
      pool.push(...this.g.discard.splice(0));
      this.g.discard = [top];
    }
    if (pool.length === 0) return;
    this.g.deck = shuffle(pool, Math.random);
  }

  private drawN(id: string, n: number) {
    for (let i = 0; i < n; i++) {
      this.ensureDeck();
      const c = this.g.deck.shift();
      if (!c) break;
      (this.g.hands[id] ??= []).push(c);
      this.draws.push({ seq: this.seq++, playerId: id, cardId: c.id });
    }
  }

  private syncPublic() {
    const g = this.g;
    for (const [id, p] of this.state.players) {
      p.handCount = (g.hands[id] ?? []).length;
      if (p.handCount !== 1) g.saidUna[id] = false;
      else if (p.isBot) g.saidUna[id] = true; // los bots cantan UNA solos
      p.saidUna = g.saidUna[id] ?? false;
      p.connected = g.connected[id] ?? p.connected;
    }
    this.state.currentPlayerId = g.currentPlayerId;
    this.state.direction = g.direction;
    this.state.deckCount = g.deck.length;
    this.state.pendingDraw = g.pendingDraw;
    this.state.pendingKind = g.pendingKind;
    this.state.drawnThisTurn = g.drawnThisTurn;
    this.state.activeSuit = g.activeSuit ?? "";
    this.state.suitOpen = g.suitOpen;
    this.state.suitPendingBy = g.suitPendingBy;
    this.armTurnTimer();
    this.scheduleBots();
  }

  // ==========================================================================
  // Bots
  // ==========================================================================
  private isBot(id: string): boolean {
    return this.state.players.get(id)?.isBot ?? false;
  }

  private addBot() {
    if (this.state.players.size >= MAX_PLAYERS) return;
    const id = `bot-${++this.botSeq}`;
    const used = new Set([...this.state.players.values()].map((p) => p.name));
    // Compara contra el nombre YA prefijado (antes comparaba sin 🤖 y salían todos Walter).
    const name = BOT_NAMES.map((n) => `🤖 ${n}`).find((n) => !used.has(n)) ?? `🤖 Bot ${this.botSeq}`;
    const p = new Player();
    p.id = id;
    p.name = name;
    p.isBot = true;
    p.ready = true; // los bots siempre están listos
    p.connected = true;
    this.state.players.set(id, p);
    this.state.scores.set(id, 0);
  }

  /** Ajusta la cantidad de bots en la mesa al número pedido (agrega o saca). */
  private setBots(count: number) {
    const humans = [...this.state.players.values()].filter((p) => !p.isBot).length;
    const maxBots = Math.max(0, MAX_PLAYERS - humans);
    const target = Math.max(0, Math.min(maxBots, Math.floor(Number(count) || 0)));
    let bots = [...this.state.players.values()].filter((p) => p.isBot);
    while (bots.length < target) {
      this.addBot();
      bots = [...this.state.players.values()].filter((p) => p.isBot);
    }
    // Saca los últimos agregados primero (LIFO) para un comportamiento predecible.
    while (bots.length > target) {
      const b = bots.pop()!;
      this.state.players.delete(b.id);
      this.state.scores.delete(b.id);
    }
  }

  private botDelay(): number {
    // 3s ± 500ms para que no jueguen todos exactamente igual.
    return BOT_DELAY_MS + Math.floor((Math.random() - 0.5) * 1000);
  }

  private setBotTimer(key: string, fn: () => void, delay: number) {
    const prev = this.botTimers.get(key);
    if (prev) clearTimeout(prev);
    this.botTimers.set(key, setTimeout(fn, delay));
  }
  private clearAllBotTimers() {
    for (const t of this.botTimers.values()) clearTimeout(t);
    this.botTimers.clear();
  }

  /** Programa las acciones de los bots según el estado actual. */
  private scheduleBots() {
    if (!this.g || this.state.phase !== "playing") {
      this.clearAllBotTimers();
      return;
    }
    const top = this.topCard();
    const topChanged = top.id !== this.lastTopId;
    this.lastTopId = top.id;

    const cur = this.g.currentPlayerId;
    if (this.isBot(cur) && !this.botTimers.has(`${cur}:turn`)) {
      this.setBotTimer(`${cur}:turn`, () => this.botPlayTurn(cur), this.botDelay());
    }
    // Espejito: al cambiar el tope, cada bot con carta idéntica puede reaccionar.
    if (topChanged && !isJoker(top)) {
      for (const id of this.g.turnOrder) {
        if (!this.isBot(id) || id === cur) continue;
        if ((this.g.hands[id] ?? []).some((c) => isIdentical(c, top))) {
          this.setBotTimer(`${id}:esp`, () => this.botEspejito(id, top.id), this.botDelay());
        }
      }
    }
    // JODETE: si hay una jugada ILEGAL challengeable, un bot (que no sea el culpable)
    // la castiga SIEMPRE. Delay corto para que "cacen" rápido, pero no instantáneo
    // (le da al humano la chance de reaccionar primero).
    const bad = this.challengeTarget();
    if (bad) {
      const challenger = this.g.turnOrder.find(
        (id) => this.isBot(id) && id !== bad.playerId && (this.g.connected[id] ?? true),
      );
      if (challenger && !this.botTimers.has(`${challenger}:jodete`)) {
        this.setBotTimer(`${challenger}:jodete`, () => this.botCallJodete(challenger), this.botJodeteDelay());
      }
    }
  }

  private botCtx() {
    return { topRank: this.topCard().rank, activeSuit: this.g.activeSuit, pendingKind: (this.g.pendingKind || null) as null | "two" | "wild", suitOpen: this.g.suitOpen };
  }

  private botSuitFor(card: Card): Suit | undefined {
    if (card.rank !== "8" && !isJoker(card)) return undefined;
    // Elige el palo más frecuente en la mano (excluye comodines); fallback corazones.
    const counts: Record<string, number> = {};
    for (const c of this.g.hands[this.g.currentPlayerId] ?? []) {
      if (c.suit) counts[c.suit] = (counts[c.suit] ?? 0) + 1;
    }
    let best: Suit = card.rank === "8" && card.suit ? card.suit : Suit.Hearts;
    let max = -1;
    for (const s of [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades]) {
      if ((counts[s] ?? 0) > max) { max = counts[s] ?? 0; best = s; }
    }
    return best;
  }

  private botPlayTurn(botId: string) {
    this.botTimers.delete(`${botId}:turn`);
    if (!this.g || this.state.phase !== "playing" || this.g.currentPlayerId !== botId) return;
    const hand = this.g.hands[botId] ?? [];
    const ctx = this.botCtx();

    // Pending comodín: robar 4 y seguir.
    if (this.g.pendingKind === "wild") {
      this.doDrawFor(botId);
      return; // syncPublic reprograma el turno para jugar
    }
    // Pending 2: tirar otro 2 o robar (salteado).
    if (this.g.pendingKind === "two") {
      const two = hand.find((c) => c.rank === "2");
      if (two) return void this.applyPlay(botId, [two], true);
      this.doDrawFor(botId);
      return;
    }
    // ~2% de las veces juega MAL: una carta ilegal (queda challengeable).
    if (Math.random() < BOT_MISTAKE) {
      const bad = hand.find((c) => !isJoker(c) && !isLegalPlay(c, ctx));
      if (bad) return void this.applyPlay(botId, [bad], false);
    }
    // Jugada legal.
    const legal = hand.find((c) => isLegalPlay(c, ctx));
    if (legal) return void this.applyPlay(botId, [legal], true, this.botSuitFor(legal));
    // Sin jugada: robar; si ya robó, pasar.
    if (!this.g.drawnThisTurn) { this.doDrawFor(botId); return; }
    this.doPass(botId);
  }

  private botEspejito(botId: string, expectedTopId: string) {
    this.botTimers.delete(`${botId}:esp`);
    if (!this.g || this.state.phase !== "playing") return;
    const top = this.topCard();
    if (top.id !== expectedTopId || botId === this.g.currentPlayerId || isJoker(top)) return;
    const card = (this.g.hands[botId] ?? []).find((c) => isIdentical(c, top));
    if (card) this.applyEspejito(botId, card);
  }

  private botJodeteDelay(): number {
    // ~0.8–1.5s: castigan rápido la jugada ilegal, pero no de forma instantánea.
    return 800 + Math.floor(Math.random() * 700);
  }

  private botCallJodete(botId: string) {
    this.botTimers.delete(`${botId}:jodete`);
    if (!this.g || this.state.phase !== "playing") return;
    // Revalida: la jugada ilegal puede haber sido resuelta por otro (humano u otro bot).
    const target = this.challengeTarget();
    if (!target || target.playerId === botId) return;
    this.resolveJodete(botId);
  }

  // ---- Timer de turno (anti-stall 15s) ------------------------------------
  private armTurnTimer() {
    if (TURN_TIMEOUT <= 0) return; // timeout de turno apagado
    if (this.state.phase !== "playing") return this.clearTurnTimer();
    const cur = this.g.currentPlayerId;
    if (cur === this.armedCurrent && this.turnTimer) return; // mismo turno: no reinicia
    this.armedCurrent = cur;
    this.g.turnStartedAt = Date.now();
    this.clearTurnTimer();
    const epoch = ++this.turnEpoch;
    this.turnTimer = setTimeout(() => this.turnTimeout(epoch, cur), TURN_TIMEOUT);
  }

  private clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  private turnTimeout(epoch: number, playerId: string) {
    if (epoch !== this.turnEpoch) return;
    if (this.state.phase !== "playing") return;
    if (this.g.currentPlayerId !== playerId) return;

    if (this.g.pendingKind && this.g.pendingDraw > 0) {
      const n = this.g.pendingDraw;
      this.drawN(playerId, n);
      this.g.pendingDraw = 0;
      this.g.pendingKind = "";
      this.toast(`${this.nameOf(playerId)} se pasó de tiempo: robó ${n} y salteado`, "penalty");
    } else {
      this.drawN(playerId, PENALTY_DRAW);
      this.toast(`${this.nameOf(playerId)} se pasó de tiempo: +${PENALTY_DRAW} y salteado`, "penalty");
    }
    this.stepTurn(1);
    this.syncPublic();
    this.sendHand(playerId);
  }

  onDispose() {
    this.clearTurnTimer();
    this.clearAllBotTimers();
  }

  private sendHand(id: string) {
    const client = this.clients.find((c) => c.sessionId === id);
    client?.send(ServerMsg.Hand, this.g.hands[id] ?? []);
  }
  private reject(client: Client, reason: string) {
    client.send(ServerMsg.ActionRejected, { reason });
  }
  private toast(text: string, kind: ToastPayload["kind"] = "info") {
    this.broadcast(ServerMsg.Toast, { text, kind } satisfies ToastPayload);
  }
}
