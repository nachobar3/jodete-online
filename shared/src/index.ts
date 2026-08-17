// ============================================================================
// Jodete — tipos y constantes compartidas entre server y client
// ============================================================================

// ---- Configuración de sala / reglas -----------------------------------------
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const INITIAL_HAND_SIZE = 7;
export const DECK_COUNT = 3; // 3 mazos franceses + comodines, mezclados
export const CODE_LENGTH = 6;

/** Permanencia mínima (ms) que una versión de estado debe haber estado visible
 *  para que una jugada normal sea válida y challengeable (regla de los 2s). */
export const MIN_PERMANENCIA_MS = 2000;

/** Máximo de cartas arriba de una jugada para poder challengearla. */
export const CHALLENGE_MAX_CARDS_ABOVE = 3;

/** Cartas que roba el culpable (o el acusador falso, o el que no dijo UNA). */
export const PENALTY_DRAW = 3;

/** Tras este tiempo sin que nadie tire una carta, se revela (glow) de quién es el turno. */
export const TURN_REVEAL_MS = 10000;

/** Si el dueño del turno no juega en este tiempo: roba (penalidad) y se saltea. */
export const TURN_TIMEOUT_MS = 15000;

// ---- Modelo de cartas -------------------------------------------------------
export enum Suit {
  Hearts = "H",
  Diamonds = "D",
  Clubs = "C",
  Spades = "S",
}

export const SUITS: Suit[] = [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades];

export type Rank =
  | "A" | "2" | "3" | "4" | "5" | "6" | "7"
  | "8" | "9" | "10" | "J" | "Q" | "K";

export const RANKS: Rank[] = [
  "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
];

export const JOKER = "JOKER" as const;

/** Una carta física. `id` es único por instancia (hay copias entre mazos);
 *  la identidad para espejito es (suit, rank). Joker: suit=null, rank=JOKER. */
export interface Card {
  id: string;
  suit: Suit | null;
  rank: Rank | typeof JOKER;
}

export function isJoker(c: Card): boolean {
  return c.rank === JOKER;
}

/** As de pic (As de picas): carta especial que cancela efectos. */
export function isAcePic(c: Card): boolean {
  return c.suit === Suit.Spades && c.rank === "A";
}

/** ¿La carta tiene efecto (2, 8, J, Q, K, comodín)? Sirve para el As de pic. */
export function isEffectCard(c: Card): boolean {
  if (isJoker(c)) return true;
  return c.rank === "2" || c.rank === "8" || c.rank === "J" || c.rank === "Q" || c.rank === "K";
}

/** Dos cartas son "idénticas" (válidas para espejito) si comparten suit y rank.
 *  Los comodines NO admiten espejito. */
export function isIdentical(a: Card, b: Card): boolean {
  if (isJoker(a) || isJoker(b)) return false;
  return a.suit === b.suit && a.rank === b.rank;
}

/** Construye `count` mazos franceses con 2 comodines cada uno (sin mezclar). */
export function buildDecks(count = DECK_COUNT): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < count; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ id: `${d}-${suit}-${rank}`, suit, rank });
      }
    }
    cards.push({ id: `${d}-JOKER-1`, suit: null, rank: JOKER });
    cards.push({ id: `${d}-JOKER-2`, suit: null, rank: JOKER });
  }
  return cards;
}

/** Fisher-Yates in-place usando una función random inyectable (0..1). */
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- Puntaje ----------------------------------------------------------------
/** Puntos de una carta cuando queda en mano al cortar alguien. */
export function cardPoints(c: Card): number {
  if (isJoker(c)) return 50;
  if (c.suit === Suit.Spades && c.rank === "A") return 75; // As de pic
  switch (c.rank) {
    case "2": return 20;
    case "8": return 30;
    case "A": return 15;
    case "J":
    case "Q":
    case "K": return 10;
    default: return Number(c.rank); // 3-7, 9, 10
  }
}

// ---- Reglas de jugada (M1: sin efectos, solo colocación) --------------------
/** ¿Se puede colocar `card` sobre `top`? Regla básica de M1 (palo o número).
 *  El 8 y el comodín se pueden tirar sobre cualquier carta (colocación libre);
 *  sus EFECTOS reales llegan en M3. Un comodín/8 en el tope actúa como wild. */
export function canPlayBasic(card: Card, top: Card): boolean {
  if (isJoker(top)) return true;
  if (isJoker(card)) return true;
  if (card.rank === "8") return true;
  return card.suit === top.suit || card.rank === top.rank;
}

/** Contexto de la mesa para decidir legalidad de una jugada normal. */
export interface PlayContext {
  topRank: Rank | typeof JOKER;
  activeSuit: Suit | null; // palo en vigor (puede diferir del palo del tope tras 8/comodín)
  pendingKind: null | "two" | "wild";
}

/** Legalidad completa (M3+): número, palo en vigor, 8/comodín wild, pending. */
export function isLegalPlay(card: Card, ctx: PlayContext): boolean {
  if (ctx.pendingKind === "two") return card.rank === "2"; // solo se responde un 2 con otro 2
  if (ctx.pendingKind === "wild") return false; // primero hay que robar 4
  if (isJoker(card)) return true; // comodín se tira sobre cualquiera
  if (card.rank === "8") return true; // 8 se tira sobre cualquiera
  if (card.rank === ctx.topRank) return true; // mismo número
  if (ctx.activeSuit != null && card.suit === ctx.activeSuit) return true; // mismo palo en vigor
  return false;
}

// ---- Helpers de display -----------------------------------------------------
export function suitSymbol(suit: Suit | null | ""): string {
  switch (suit) {
    case Suit.Hearts: return "♥";
    case Suit.Diamonds: return "♦";
    case Suit.Clubs: return "♣";
    case Suit.Spades: return "♠";
    default: return "★"; // joker
  }
}

export function isRedSuit(suit: Suit | null | ""): boolean {
  return suit === Suit.Hearts || suit === Suit.Diamonds;
}

// ---- Fases del juego --------------------------------------------------------
export type GamePhase = "lobby" | "playing" | "handEnd" | "gameEnd";

// ---- Protocolo de mensajes (nombres) ---------------------------------------
export const ClientMsg = {
  Ready: "ready",
  Start: "start",
  PlayCards: "playCards",
  PlayEspejito: "playEspejito",
  PlayAsPic: "playAsPic",
  DrawCard: "drawCard",
  Pass: "pass",
  SayUna: "sayUna",
  CallJodete: "callJodete",
  AccuseUna: "accuseUna",
  PlayAgain: "playAgain",
  AddBot: "addBot",
  RemoveBot: "removeBot",
} as const;

export const ServerMsg = {
  ActionRejected: "actionRejected",
  Hand: "hand",
  HandEnd: "handEnd",
  Toast: "toast",
  JodeteResult: "jodeteResult",
  CardPlayed: "cardPlayed",
} as const;

/** Evento para animar la carta viajando desde el jugador hacia el centro. */
export interface CardPlayedPayload {
  playerId: string;
  card: Card;
  espejito: boolean;
}

export interface HandEndPayload {
  cutterId: string;
  /** puntos que sumó cada jugador en esta mano (por lo que quedó en mano) */
  roundPoints: Record<string, number>;
}

export interface AccuseUnaPayload {
  targetId: string;
}

export interface JodeteResultPayload {
  valid: boolean;
  accuserId: string;
  culpritId?: string;
  reason: string;
}

/** Notificación efímera para feedback (espejito, robos, salteos, etc.). */
export interface ToastPayload {
  text: string;
  kind?: "info" | "espejito" | "penalty" | "effect";
}

// ---- Payloads (M0 + semillas de M1) ----------------------------------------
export interface JoinOptions {
  code: string;
  name: string;
}

export interface PlayCardsPayload {
  cardIds: string[];
  observedVersion: number;
  declaredSuit?: Suit;
}

export interface PlayEspejitoPayload {
  cardId: string;
  observedVersion: number;
}

export interface ActionRejectedPayload {
  action: string;
  reason: string;
}
