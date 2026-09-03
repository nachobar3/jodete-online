import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties,
} from "react";
import { Client, Room } from "colyseus.js";
import { primeAudio, playHover, playThrow, playDraw, playGlass } from "./sound";
import {
  CODE_LENGTH, ClientMsg, ServerMsg, MIN_PLAYERS, MAX_PLAYERS,
  TURN_REVEAL_MS, CUT_BONUS, DEFAULT_CUT_THRESHOLD, MIN_CUT_THRESHOLD, MAX_CUT_THRESHOLD, KICK_CODE,
  isIdentical, isAcePic, isEffectCard, suitSymbol, isRedSuit, SUITS, Suit,
  type Card, type HandEndPayload, type ToastPayload, type CardPlayedPayload, type JodeteResultPayload,
} from "@jodete/shared";

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  `ws://${window.location.hostname}:2567`;

interface PlayerView {
  id: string; name: string; ready: boolean; connected: boolean;
  isHost: boolean; isBot: boolean; saidUna: boolean; handCount: number; eliminated: boolean;
}
interface GameView {
  code: string; phase: string; hostId: string; currentPlayerId: string;
  direction: number; deckCount: number; pendingDraw: number; pendingKind: string;
  drawnThisTurn: boolean; activeSuit: Suit | null; top: Card | null;
  suitOpen: boolean; suitPendingBy: string;
  players: PlayerView[]; scores: Record<string, number>;
  cutThreshold: number; winnerId: string;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}
const normSuit = (s: string): Suit | null => (s ? (s as Suit) : null);

function snapshot(room: Room): GameView {
  const st = room.state;
  const byId = new Map<string, PlayerView>();
  st?.players?.forEach((p: PlayerView) =>
    byId.set(p.id, { id: p.id, name: p.name, ready: p.ready, connected: p.connected, isHost: p.isHost, isBot: p.isBot, saidUna: p.saidUna, handCount: p.handCount, eliminated: p.eliminated }));
  const order: string[] = st?.turnOrder ? [...st.turnOrder] : [];
  const players = order.length > 0
    ? order.map((id) => byId.get(id)).filter((p): p is PlayerView => !!p)
    : [...byId.values()];
  const scores: Record<string, number> = {};
  st?.scores?.forEach((v: number, k: string) => (scores[k] = v));
  const top: Card | null = st?.top?.rank ? { id: st.top.id, suit: normSuit(st.top.suit), rank: st.top.rank } : null;
  return {
    code: st?.code ?? "", phase: st?.phase ?? "lobby", hostId: st?.hostId ?? "",
    currentPlayerId: st?.currentPlayerId ?? "", direction: st?.direction ?? 1,
    deckCount: st?.deckCount ?? 0, pendingDraw: st?.pendingDraw ?? 0,
    pendingKind: st?.pendingKind ?? "", drawnThisTurn: st?.drawnThisTurn ?? false,
    activeSuit: normSuit(st?.activeSuit ?? ""),
    suitOpen: st?.suitOpen ?? false, suitPendingBy: st?.suitPendingBy ?? "",
    top, players, scores,
    cutThreshold: st?.cutThreshold ?? 0, winnerId: st?.winnerId ?? "",
  };
}

// ---- Cartas (estilo poker: índice arriba-izquierda + pip central) ----------
function CardFace({ card, onPointerDown, onPointerEnter, onDoubleClick, dimmed, style, testid }: {
  card: Card; onPointerDown?: (e: React.PointerEvent) => void; onPointerEnter?: () => void; onDoubleClick?: () => void;
  dimmed?: boolean; style?: CSSProperties; testid?: string;
}) {
  const isJoker = card.rank === "JOKER";
  const rank = card.rank;
  const sym = suitSymbol(card.suit);
  const cls = ["card", isJoker ? "joker" : isRedSuit(card.suit) ? "red" : "black", dimmed ? "dimmed" : "", onPointerDown ? "clickable" : ""].filter(Boolean).join(" ");
  return (
    <div className={cls} style={style} data-testid={testid ?? `card-${card.id}`} data-cid={card.id} onPointerDown={onPointerDown} onPointerEnter={onPointerEnter} onDoubleClick={onDoubleClick}>
      {isJoker ? (
        <img className="joker-img" src="/joker.png" alt="Joker" draggable={false} />
      ) : (
        <>
          <div className="corner tl"><span className="c-rank">{rank}</span><span className="c-suit">{sym}</span></div>
          <div className="pip">{sym}</div>
          <div className="corner br"><span className="c-rank">{rank}</span><span className="c-suit">{sym}</span></div>
        </>
      )}
    </div>
  );
}

function CardBack({ style }: { style?: CSSProperties }) {
  return <div className="card back" style={style} />;
}

// Chip tipo carta chica para el cheat sheet.
function RankChip({ label, tone }: { label: string; tone?: "red" | "black" | "wild" }) {
  return <span className={`chip ${tone ?? "black"}`}>{label}</span>;
}

// Modal de reglas: efectos de cartas, puntajes y jugadas especiales.
function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal rules-modal" onClick={(e) => e.stopPropagation()} data-testid="rules-modal">
        <div className="rules-head">
          <h2>Reglas · Cartas</h2>
          <button className="rules-close" data-testid="rules-close" onClick={onClose}>✕</button>
        </div>
        <div className="rules-body">
          <section>
            <h3>Efectos</h3>
            <ul className="rules-list">
              <li><RankChip label="2" /> El siguiente roba 2 y es salteado. Apilable: 2 sobre 2 → +2.</li>
              <li><RankChip label="8" /> Elegís el palo. Se puede tirar sobre cualquier carta.</li>
              <li><RankChip label="J" /> Saltea al próximo jugador.</li>
              <li><RankChip label="Q" /> Saltea a 2 jugadores.</li>
              <li><RankChip label="K" /> Invierte el sentido de juego.</li>
              <li><RankChip label="★" tone="wild" /> <b>Comodín:</b> el siguiente roba 4 y luego juega. Elegís palo. No admite espejito.</li>
              <li><RankChip label="A♠" /> <b>As de pic:</b> cancela el efecto del tope. Se puede jugar fuera de turno.</li>
              <li><RankChip label="3–7 · 9 · 10" /> Sin efecto (solo colocación por palo/número).</li>
            </ul>
          </section>
          <section>
            <h3>Puntaje al cortar <small>(menos es mejor)</small></h3>
            <ul className="rules-list pts">
              <li><span>As de pic (A♠)</span><b>75</b></li>
              <li><span>Comodín</span><b>50</b></li>
              <li><span>8</span><b>30</b></li>
              <li><span>2</span><b>20</b></li>
              <li><span>As (A)</span><b>15</b></li>
              <li><span>J · Q · K</span><b>10</b></li>
              <li><span>3–7 · 9 · 10</span><b>su valor</b></li>
            </ul>
          </section>
          <section>
            <h3>Jugadas</h3>
            <ul className="rules-list">
              <li><b>Espejito:</b> tirá una carta idéntica (mismo palo y número) al tope, fuera de turno y en cualquier momento. Saltea al de turno. No se puede sobre comodín.</li>
              <li><b>Multi-carta:</b> en tu turno podés tirar varias cartas del mismo número que el tope.</li>
              <li><b>JODETE:</b> challengeás una jugada mal hecha (hasta 3 cartas arriba). Si era ilegal, el culpable roba 3; si era legal, robás 3 vos.</li>
              <li><b>UNA:</b> al quedar con 1 carta cantá ¡UNA! Si te cazan antes, robás 3. Cortar sin cantar → robás 3.</li>
              <li><b>Regla de los 2s:</b> una carta ilegal jugada antes de 2s se rechaza en silencio; pasados 2s queda en pie y puede ser challengeada.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

// Carta que viaja desde el jugador al centro de la mesa.
function FlyingCard({ card, getSource, getPile, onDone }: {
  card: Card; getSource: () => HTMLElement | null; getPile: () => HTMLElement | null; onDone: () => void;
}) {
  const [at, setAt] = useState<"start" | "end">("start");
  const geo = useRef<{ from: DOMRect; to: DOMRect } | null>(null);
  useLayoutEffect(() => {
    const to = getPile()?.getBoundingClientRect();
    if (!to) { onDone(); return; }
    // Si falta el origen (asiento), igual sale desde arriba del pozo (nunca se saltea).
    const from = getSource()?.getBoundingClientRect() ?? new DOMRect(to.left, to.top - 170, to.width, to.height);
    geo.current = { from, to };
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setAt("end")));
    const t = setTimeout(onDone, 680);
    return () => { cancelAnimationFrame(r); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const g = geo.current;
  if (!g) return null;
  const W = 70, H = 100;
  const rect = at === "start" ? g.from : g.to;
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const style: CSSProperties = {
    position: "fixed", left: cx - W / 2, top: cy - H / 2, margin: 0, zIndex: 90, pointerEvents: "none",
    boxShadow: "0 10px 28px rgba(0,0,0,.6)",
    transition: at === "end" ? "left .64s cubic-bezier(.2,.7,.25,1), top .64s cubic-bezier(.2,.7,.25,1), transform .64s" : "none",
    transform: at === "end" ? "rotate(0deg) scale(1)" : "rotate(-16deg) scale(1.5)",
  };
  return <CardFace card={card} style={style} testid="flying" />;
}

// Posición (en %) de un asiento alrededor del círculo.
function seatPos(rel: number, n: number): CSSProperties {
  const angle = (90 + rel * (360 / n)) * (Math.PI / 180);
  return { left: `${50 + 42 * Math.cos(angle)}%`, top: `${50 + 42 * Math.sin(angle)}%` };
}
// Etiqueta corta de una carta para la bitácora (ej. "7♥", "comodín ★").
function cardLabel(card: Card): string {
  return card.rank === "JOKER" ? "comodín ★" : `${card.rank}${suitSymbol(card.suit)}`;
}
// Layout de la mano: 1 o 2 filas según cuántas cartas entren, con solapamiento
// dependiente del ancho de pantalla, escala y "peek" (hundido) por viewport.
interface HandSlot { x: number; y: number; r: number; z: number }
interface HandLayout { cards: HandSlot[]; scale: number; height: number; isMobile: boolean; width: number }
function computeHandLayout(n: number, vw: number): HandLayout {
  const isMobile = vw < 820;
  const scale = isMobile ? 1.0 : 1.25;
  const cardW = 70 * scale, cardH = 100 * scale;
  const avail = Math.min(vw - 24, 1200);
  const maxStep = cardW * 0.62;              // separación ideal (solapan ~38%)
  const minStep = isMobile ? 26 : 36;        // por debajo de esto, parte en 2 filas
  const rowGap = cardH * 0.42;

  const singleStep = n > 1 ? (avail - cardW) / (n - 1) : maxStep;
  const rowSizes = (n <= 1 || singleStep >= minStep)
    ? [n]
    : [Math.ceil(n / 2), n - Math.ceil(n / 2)]; // dos filas: la trasera arriba
  const rowCount = rowSizes.length;

  const cards: HandSlot[] = [];
  let fanW = cardW; // ancho real que ocupa el abanico (para el glow, no tapar toda la pantalla)
  rowSizes.forEach((rowN, ri) => {
    const step = rowN > 1 ? Math.min(maxStep, (avail - cardW) / (rowN - 1)) : 0;
    const rowW = (rowN - 1) * step;
    fanW = Math.max(fanW, rowW + cardW);
    // Ángulo del abanico: crece con la cantidad de cartas hasta un tope.
    const half = Math.min(isMobile ? 11 : 17, (rowN - 1) * 3.5);
    for (let i = 0; i < rowN; i++) {
      const t = rowN > 1 ? (i / (rowN - 1)) * 2 - 1 : 0; // -1..1 (borde a borde)
      const rowY = -(rowCount - 1 - ri) * rowGap;        // fila trasera más arriba
      cards.push({
        x: -rowW / 2 + i * step,
        y: rowY - (1 - t * t) * cardH * 0.18,            // arco: centro más alto, bordes en la base
        r: t * half,                                     // rotación pronunciada (abanico)
        z: ri * 1000 + i,
      });
    }
  });
  // Altura justa para contener las cartas (incluye el arco), así no tapan la mesa.
  const height = 16 + (rowCount > 1 ? rowGap : 0) + cardH + cardH * 0.18;
  return { cards, scale, height, isMobile, width: fanW };
}

// Minimum horizontal space (px) needed to the right of the table for the side HUD column.
// 132 (chip min-width) + 20 (gap) + 18 (breathing room)
const SIDE_HUD_MIN = 170;

export function App() {
  const [name, setName] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [view, setView] = useState<GameView | null>(null);
  const [hand, setHand] = useState<Card[]>([]);
  // Orden de visualización elegido por el jugador (ids). Por default las cartas
  // van en el orden en que fueron repartidas; el jugador las reordena arrastrando.
  const [handOrder, setHandOrder] = useState<string[]>([]);
  const [handEnd, setHandEnd] = useState<HandEndPayload | null>(null);
  // El modal de palo lo dispara el server (suitPendingBy === yo). Este flag solo
  // permite ocultarlo localmente (clic afuera) sin cancelar la obligación.
  const [suitModalHidden, setSuitModalHidden] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([]);
  // Bitácora: log persistente de jugadas y eventos (arriba a la izquierda, scrolleable).
  const [logEntries, setLogEntries] = useState<{ id: number; text: string; kind: string }[]>([]);
  const logSeq = useRef(0);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const logStickRef = useRef(true); // ¿el usuario está pegado al fondo? (si no, no auto-scrolleamos)
  const [flights, setFlights] = useState<{ key: number; card: Card; playerId: string; joker: boolean }[]>([]);
  const [dragState, setDragState] = useState<{ cardId: string; x: number; y: number; moved: boolean } | null>(null);
  const dragRef = useRef<{ cardId: string; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);
  const lastDragPlayRef = useRef(0); // ts de la última jugada propia por arrastre
  const [revealed, setRevealed] = useState(false);
  const [lastPlayer, setLastPlayer] = useState(""); // glow amarillo 2s sobre quien jugó
  const lastPlayerTimer = useRef<number | undefined>(undefined);
  const [jodido, setJodido] = useState(""); // G13: glow ROJO 1.8s sobre el que se jodió
  const jodidoTimer = useRef<number | undefined>(undefined);
  const [jokerPlay, setJokerPlay] = useState(0); // G7: pulso de animación del comodín
  const jokerTimer = useRef<number | undefined>(undefined);
  const [jodeteLocked, setJodeteLocked] = useState(false); // JODETE deshabilitado hasta la próxima jugada
  const prevPhaseRef = useRef(""); // fase anterior, para resetear el cooldown al iniciar mano
  const [error, setError] = useState("");
  const [rejectShake, setRejectShake] = useState(0); // feedback: shake+flash rojo en la mano al rechazar
  const rejectTimer = useRef<number | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  // Counter de bots (host, en lobby): mantiene un valor optimista para no perder
  // clicks rápidos mientras el server sincroniza el estado real de la sala.
  const [botTarget, setBotTarget] = useState(0);
  const botPendingRef = useRef(false);
  const serverBotCount = view ? view.players.filter((p) => p.isBot).length : 0;
  useEffect(() => {
    if (!botPendingRef.current) setBotTarget(serverBotCount);
    else if (serverBotCount === botTarget) botPendingRef.current = false;
  }, [serverBotCount, botTarget]);
  // Umbral de corte (host, en lobby): mismo esquema optimista que el counter de bots.
  const [cutTarget, setCutTarget] = useState(DEFAULT_CUT_THRESHOLD);
  const cutPendingRef = useRef(false);
  const serverCut = view?.cutThreshold || DEFAULT_CUT_THRESHOLD;
  useEffect(() => {
    if (!cutPendingRef.current) setCutTarget(serverCut);
    else if (serverCut === cutTarget) cutPendingRef.current = false;
  }, [serverCut, cutTarget]);
  const [reconnecting, setReconnecting] = useState(false); // overlay "Reconectando…"
  const roomRef = useRef<Room | null>(null);
  const reconnectTokenRef = useRef(""); // room.reconnectionToken para volver tras un corte
  const intentionalLeaveRef = useRef(false); // true = el usuario tocó "Salir" (no reconectar)
  const phaseRef = useRef(""); // última fase conocida (para no reconectar si estábamos en lobby)
  const attemptReconnectRef = useRef<() => void>(() => {});
  const toastId = useRef(0);
  const flightId = useRef(0);
  const pileRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const handRef = useRef<HTMLDivElement | null>(null);
  const seatRefs = useRef<Record<string, HTMLElement | null>>({});
  const [sessionId, setSessionId] = useState("");
  const [vw, setVw] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1200));
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));

  // Reacciona al ancho/alto de pantalla para recalcular layouts.
  useEffect(() => {
    const on = () => { setVw(window.innerWidth); setVh(window.innerHeight); };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  // Habilita el audio en el primer gesto del usuario (política de autoplay).
  useEffect(() => {
    const prime = () => primeAudio();
    window.addEventListener("pointerdown", prime);
    window.addEventListener("keydown", prime);
    return () => { window.removeEventListener("pointerdown", prime); window.removeEventListener("keydown", prime); };
  }, []);

  // Feedback de rechazo: además del texto, sacude la mano y la tiñe de rojo un instante.
  const flash = useCallback((msg: string) => {
    setError(msg);
    window.setTimeout(() => setError(""), 2500);
    setRejectShake((k) => k + 1);
    window.clearTimeout(rejectTimer.current);
    rejectTimer.current = window.setTimeout(() => setRejectShake(0), 450);
  }, []);

  // G13: marca a un jugador como "jodido" (glow rojo + shake) por 1.8s.
  const markJodido = useCallback((playerId: string) => {
    if (!playerId) return;
    setJodido(playerId);
    window.clearTimeout(jodidoTimer.current);
    jodidoTimer.current = window.setTimeout(() => setJodido(""), 1800);
  }, []);

  // G7: dispara el pulso de animación del comodín en el pozo (destello + giro).
  const triggerJoker = useCallback(() => {
    setJokerPlay((k) => k + 1);
    window.clearTimeout(jokerTimer.current);
    jokerTimer.current = window.setTimeout(() => setJokerPlay(0), 700);
  }, []);

  // Espejo de la lista de jugadores para resolver nombre→id desde handlers de mensajes.
  const playersRef = useRef<PlayerView[]>([]);

  // Agrega una línea a la bitácora (log persistente, sin auto-borrado).
  const pushLog = useCallback((text: string, kind = "info") => {
    setLogEntries((prev) => [...prev.slice(-199), { id: ++logSeq.current, text, kind }]);
  }, []);

  const pushToast = useCallback((t: ToastPayload) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-4), { id, text: t.text, kind: t.kind ?? "info" }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3500);
    // El espejito ya se registra en la bitácora vía CardPlayed; el resto de eventos
    // (jodetes, penalizaciones, efectos, UNA) se suman acá para el historial.
    if (t.kind !== "espejito") pushLog(t.text, t.kind ?? "info");
    // G13: los toasts de penalización (UNA/mal cierre/timeout) empiezan con el
    // nombre del penalizado; lo circundamos con glow ROJO además del JodeteResult.
    if (t.kind === "penalty") {
      const hit = playersRef.current.find((p) => p.name && t.text.startsWith(p.name));
      if (hit) markJodido(hit.id);
    }
  }, [markJodido, pushLog]);

  // Vuelta seca al inicio: limpia todo el estado de sala (salida real o
  // reconexión agotada). Es lo que antes hacía onLeave directamente.
  const hardLeave = useCallback(() => {
    roomRef.current = null;
    reconnectTokenRef.current = "";
    intentionalLeaveRef.current = false;
    setReconnecting(false);
    setView(null); setHand([]); setSessionId("");
    setLogEntries([]); logSeq.current = 0; // la bitácora arranca limpia en la próxima sala
  }, []);

  const wireRoom = useCallback((room: Room) => {
    roomRef.current = room;
    reconnectTokenRef.current = room.reconnectionToken; // token para reconectar tras un corte
    setSessionId(room.sessionId);
    setReconnecting(false); // si veníamos de un overlay de reconexión, se cierra
    if (new URLSearchParams(window.location.search).has("e2e")) {
      (window as unknown as { __room: Room }).__room = room;
    }
    room.onStateChange(() => {
      const v = snapshot(room);
      playersRef.current = v.players;
      phaseRef.current = v.phase;
      // Reset del cooldown de JODETE al comenzar una mano nueva (no en cada robo).
      if (prevPhaseRef.current !== "playing" && v.phase === "playing") {
        setJodeteLocked(false);
        if (logSeq.current > 0) pushLog("— nueva mano —", "sep"); // separador en la bitácora
      }
      prevPhaseRef.current = v.phase;
      setView(v);
    });
    room.onMessage(ServerMsg.Hand, (cards: Card[]) => { setHand(cards); setHandEnd(null); });
    room.onMessage(ServerMsg.HandEnd, (p: HandEndPayload) => setHandEnd(p));
    room.onMessage(ServerMsg.Toast, (p: ToastPayload) => pushToast(p));
    room.onMessage(ServerMsg.CardPlayed, (p: CardPlayedPayload) => {
      if (p.espejito) playGlass(); else playThrow(); // vidrio para espejito, swish para jugada normal
      // Glow amarillo 2s sobre quien tiró la última carta (incluido espejito).
      setLastPlayer(p.playerId);
      window.clearTimeout(lastPlayerTimer.current);
      lastPlayerTimer.current = window.setTimeout(() => setLastPlayer(""), 2000);
      // Una jugada real reactiva el botón JODETE (no se puede spamear robando de a 3).
      setJodeteLocked(false);
      // Bitácora: registra la jugada (nombre + carta) en cuanto llega al cliente.
      const who = playersRef.current.find((pl) => pl.id === p.playerId)?.name ?? "Alguien";
      pushLog(`${who} ${p.espejito ? "espejito" : "jugó"} ${cardLabel(p.card)}`, p.espejito ? "espejito" : "play");
      const isJoker = p.card.rank === "JOKER";
      // G1: SIEMPRE se anima la carta viajando hacia la mesa (también el espejito).
      // La propia SOLO se saltea si la jugaste arrastrando (ya la moviste vos).
      if (p.playerId === room.sessionId && performance.now() - lastDragPlayRef.current < 500) {
        // G7: sin vuelo (la carta ya está en la mesa) → el comodín gira de inmediato.
        if (isJoker) triggerJoker();
        return;
      }
      const key = ++flightId.current;
      // G7: el giro del comodín se dispara cuando la carta ATERRIZA (onDone del vuelo),
      // no antes: así gira ya posicionada en el pozo y no por debajo de la que viaja.
      setFlights((prev) => [...prev, { key, card: p.card, playerId: p.playerId, joker: isJoker }]);
    });
    room.onMessage(ServerMsg.ActionRejected, (p: { reason: string }) => flash(p.reason));
    // G13: cuando alguien "se jode" (challenge/UNA/mal cierre), lo circundamos con
    // glow ROJO + shake. Fuente estructurada: el JodeteResult (culpable o acusador).
    room.onMessage(ServerMsg.JodeteResult, (p: JodeteResultPayload) => {
      const victim = p.valid ? p.culpritId : p.accuserId;
      if (victim) markJodido(victim);
    });
    room.onError((code, message) => flash(`Error ${code}: ${message ?? ""}`));
    room.onLeave((code: number) => {
      // El host nos sacó de la sala: volvemos al inicio con un aviso, sin reconectar.
      if (code === KICK_CODE) {
        hardLeave();
        setError("El host te sacó de la sala.");
        return;
      }
      // Corte de red en partida (no fue el botón "Salir" ni un cierre normal, y no
      // estábamos en el lobby donde el server sí nos saca): mantenemos al jugador
      // en la mesa y reintentamos reconectar en vez de patearlo al inicio.
      const wasInGame = phaseRef.current === "playing" || phaseRef.current === "handEnd";
      if (!intentionalLeaveRef.current && code !== 1000 && wasInGame) {
        attemptReconnectRef.current();
        return;
      }
      hardLeave();
    });
    if (room.state) setView(snapshot(room));
  }, [flash, pushToast, markJodido, triggerJoker, hardLeave, pushLog]);

  // Reintenta reconectar con el token guardado mientras dure la ventana del
  // server (~60s), mostrando el overlay "Reconectando…". Solo cae al inicio si
  // se agota la ventana o falla de verdad. client.reconnect() reengancha directo
  // a la sesión existente (no pasa por el matchmaking, así que la sala trabada
  // durante la partida no lo bloquea).
  const attemptReconnect = useCallback(async () => {
    const token = reconnectTokenRef.current;
    if (!token) { hardLeave(); return; }
    setReconnecting(true);
    const deadline = performance.now() + 60000;
    while (performance.now() < deadline) {
      if (intentionalLeaveRef.current) { hardLeave(); return; }
      try {
        const room = await new Client(SERVER_URL).reconnect(token);
        wireRoom(room); // re-cablea handlers y refresca el token; cierra el overlay
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1500)); // backoff antes del próximo intento
      }
    }
    hardLeave(); // se agotó la ventana: recién ahora volvemos al inicio
  }, [wireRoom, hardLeave]);
  attemptReconnectRef.current = attemptReconnect;

  const doCreate = useCallback(async () => {
    if (!name.trim()) return setError("Poné un nombre.");
    setConnecting(true); setError("");
    try { wireRoom(await new Client(SERVER_URL).create("game", { code: randomCode(), name: name.trim() })); }
    catch (e) { setError(`No se pudo crear la sala: ${(e as Error).message}`); }
    finally { setConnecting(false); }
  }, [name, wireRoom]);

  const doJoin = useCallback(async () => {
    if (!name.trim()) return setError("Poné un nombre.");
    const code = codeInput.trim().toUpperCase();
    if (code.length !== CODE_LENGTH) return setError(`El código tiene ${CODE_LENGTH} letras.`);
    setConnecting(true); setError("");
    try { wireRoom(await new Client(SERVER_URL).join("game", { code, name: name.trim() })); }
    catch (e) { setError(`No se pudo unir (¿código correcto?): ${(e as Error).message}`); }
    finally { setConnecting(false); }
  }, [name, codeInput, wireRoom]);

  const me = useMemo(() => view?.players.find((p) => p.id === sessionId) ?? null, [view, sessionId]);
  const isHost = me?.isHost ?? false;
  const isMyTurn = view?.currentPlayerId === sessionId;
  // ¿Me toca elegir palo? (jugué un 8/comodín y el palo sigue abierto)
  const mustPickSuit = view?.suitPendingBy === sessionId;
  // Al aparecer una nueva elección pendiente, mostramos el modal (reset del ocultar).
  useEffect(() => { if (!mustPickSuit) setSuitModalHidden(false); }, [mustPickSuit]);

  // Revelar (glow) de quién es el turno recién tras 10s sin que nadie TIRE una carta.
  // Se cuenta desde el último cambio de tope (no se reinicia por pasar/robar).
  useEffect(() => {
    if (!view || view.phase !== "playing") { setRevealed(false); return; }
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), TURN_REVEAL_MS);
    return () => clearTimeout(t);
  }, [view?.top?.id, view?.phase]);

  // Mano en el orden de visualización del jugador: primero los ids que ya
  // ordenó manualmente (que sigan en la mano), y al final las cartas nuevas
  // (robadas) en el orden en que las mandó el server. Robusto ante ids viejos.
  const orderedHand = useMemo(() => {
    const byId = new Map(hand.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const out: Card[] = [];
    for (const id of handOrder) {
      const c = byId.get(id);
      if (c && !seen.has(id)) { out.push(c); seen.add(id); }
    }
    for (const c of hand) if (!seen.has(c.id)) out.push(c);
    return out;
  }, [hand, handOrder]);

  const handLayout = useMemo(() => computeHandLayout(orderedHand.length, vw), [orderedHand.length, vw]);

  // Bitácora: al entrar un evento, auto-scroll al fondo salvo que el usuario haya
  // scrolleado hacia arriba a mirar historia vieja (logStickRef lo recuerda).
  useEffect(() => {
    const el = logScrollRef.current;
    if (el && logStickRef.current) el.scrollTop = el.scrollHeight;
  }, [logEntries]);

  // Desktop: ubica los botones de acción pegados a la derecha de la mesa,
  // alineados a su centro vertical. Si no hay espacio suficiente (pantalla esbelta),
  // cae al modo barra inferior que ya existe en mobile.
  const [hudPos, setHudPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = tableRef.current;
    if (handLayout.isMobile || !el) { setHudPos(null); return; }
    const r = el.getBoundingClientRect();
    if (window.innerWidth - r.right < SIDE_HUD_MIN) { setHudPos(null); return; }
    setHudPos({ left: r.right + 20, top: r.top + r.height / 2 });
  }, [handLayout.isMobile, handLayout.height, orderedHand.length, view?.phase, vw, vh]);

  // Reubica la carta arrastrada según dónde se soltó. Busca la carta más cercana
  // en 2D (sirve para 1 o 2 filas) e inserta antes/después según el lado.
  const reorderCard = useCallback((cardId: string, dropX: number, dropY: number) => {
    const container = handRef.current;
    if (!container) return;
    const els = Array.from(container.querySelectorAll<HTMLElement>(".card[data-cid]"));
    const ids = els.map((el) => el.dataset.cid).filter((v): v is string => !!v);
    if (ids.length === 0) return;
    let best: { id: string; cx: number } | null = null;
    let bestD = Infinity;
    for (const el of els) {
      if (el.dataset.cid === cardId) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = (cx - dropX) ** 2 + (cy - dropY) ** 2;
      if (d < bestD) { bestD = d; best = { id: el.dataset.cid!, cx }; }
    }
    if (!best) return;
    const without = ids.filter((id) => id !== cardId);
    let insertAt = without.indexOf(best.id);
    if (dropX > best.cx) insertAt++;
    without.splice(insertAt, 0, cardId);
    setHandOrder(without);
  }, []);

  const send = (type: string, payload?: unknown) => roomRef.current?.send(type, payload);

  const attemptPlay = useCallback((cardId: string) => {
    const c = hand.find((h) => h.id === cardId);
    if (!c || !view?.top) return;
    // As de pic: cancela el efecto del tope (se puede fuera de turno).
    if (isAcePic(c) && isEffectCard(view.top)) { send(ClientMsg.PlayAsPic, { cardId }); return; }
    // 8 y comodín: la carta se juega YA (los rivales la ven). El palo queda
    // abierto y el modal para elegirlo aparece DESPUÉS (lo dispara el server vía
    // suitPendingBy). Si el siguiente juega antes, perdés la elección.
    if (c.rank === "8" || c.rank === "JOKER") {
      send(ClientMsg.PlayCards, { cardIds: [cardId], observedVersion: 0 });
      return;
    }
    // Fuera de turno con carta idéntica al tope → espejito (jugada legítima).
    if (!isMyTurn && isIdentical(c, view.top)) { send(ClientMsg.PlayEspejito, { cardId }); return; }
    // Resto: SIEMPRE se manda al server, incluso fuera de turno. Si no correspondía,
    // es una jugada ilegal challengeable y podés "joderte". El server filtra los
    // toques instantáneos (regla de los 2s).
    send(ClientMsg.PlayCards, { cardIds: [cardId], observedVersion: 0 });
  }, [hand, view, isMyTurn]);

  // Drag propio: la carta sale de la mano y sigue al cursor (sin fantasma nativo).
  // OJO: no llamamos preventDefault() para no matar el dblclick.
  const startDrag = useCallback((e: React.PointerEvent, card: Card) => {
    primeAudio(); // habilita el audio en el primer gesto
    dragRef.current = { cardId: card.id, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false };
    setDragState({ cardId: card.id, x: e.clientX, y: e.clientY, moved: false });
  }, []);

  const resolveDrop = useCallback((d: { cardId: string; moved: boolean }, x: number, y: number) => {
    if (d.moved) {
      // Soltada dentro de la banda de la mano: reordenar (no jugar). Se prioriza
      // sobre la mesa porque la mano solapa el borde inferior del círculo.
      const hz = handRef.current?.getBoundingClientRect();
      const inHandBand = !!hz && y >= hz.top - 30 && y <= hz.bottom + 80;
      if (inHandBand) { reorderCard(d.cardId, x, y); return; }
      // Arrastrada a la mesa: cuenta si se soltó sobre ella (zona generosa).
      const zone = tableRef.current?.getBoundingClientRect();
      const overTable = !!zone && x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom;
      if (overTable) { lastDragPlayRef.current = performance.now(); attemptPlay(d.cardId); }
      return;
    }
    // Click simple: attemptPlay resuelve turno/espejito y da feedback.
    attemptPlay(d.cardId);
  }, [attemptPlay, reorderCard]);

  // Ref para que los listeners de pointer se monten una sola vez (sin churn).
  const resolveDropRef = useRef(resolveDrop);
  resolveDropRef.current = resolveDrop;
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.x = e.clientX; d.y = e.clientY;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) d.moved = true;
      setDragState({ cardId: d.cardId, x: d.x, y: d.y, moved: d.moved });
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      setDragState(null);
      resolveDropRef.current(d, e.clientX, e.clientY);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);

  const pickSuit = (s: Suit) => {
    send(ClientMsg.DeclareSuit, { suit: s });
    setSuitModalHidden(true);
  };
  const leave = () => { intentionalLeaveRef.current = true; roomRef.current?.leave(); };

  // ---- Menú ---------------------------------------------------------------
  if (!view) {
    return (
      <div className="app">
        <h1>JODETE</h1>
        <p className="subtitle">Juego de cartas · multiplayer</p>
        <div className="card-panel">
          <label>Tu nombre</label>
          <input data-testid="name-input" value={name} maxLength={20} placeholder="Ej: Walter" onChange={(e) => setName(e.target.value)} />
          <button data-testid="create-btn" disabled={connecting} onClick={doCreate}>Crear sala</button>
        </div>
        <div className="divider">— o unite a una —</div>
        <div className="card-panel">
          <label>Código de sala</label>
          <input data-testid="code-input" className="code" value={codeInput} maxLength={CODE_LENGTH} placeholder="ABCDEF" onChange={(e) => setCodeInput(e.target.value.toUpperCase())} />
          <button data-testid="join-btn" className="secondary" disabled={connecting} onClick={doJoin}>Unirse</button>
        </div>
        {connecting && <p className="subtitle" data-testid="connecting">Conectando al servidor…</p>}
        <p className="error" data-testid="error">{error}</p>
      </div>
    );
  }

  // ---- Lobby --------------------------------------------------------------
  if (view.phase === "lobby") {
    const allReady = view.players.length >= MIN_PLAYERS && view.players.every((p) => p.ready);
    const botCount = view.players.filter((p) => p.isBot).length;
    const humanCount = view.players.length - botCount;
    const maxBots = Math.max(0, MAX_PLAYERS - humanCount);
    // Valor mostrado: el optimista, clampeado por el cupo actual de la mesa.
    const botShown = Math.min(botTarget, maxBots);
    const changeBots = (next: number) => {
      const target = Math.max(0, Math.min(maxBots, next));
      botPendingRef.current = true;
      setBotTarget(target);
      send(ClientMsg.SetBots, { count: target });
    };
    const cutShown = Math.max(MIN_CUT_THRESHOLD, Math.min(MAX_CUT_THRESHOLD, cutTarget));
    const changeCut = (next: number) => {
      const v = Math.max(MIN_CUT_THRESHOLD, Math.min(MAX_CUT_THRESHOLD, next));
      cutPendingRef.current = true;
      setCutTarget(v);
      send(ClientMsg.SetCutThreshold, { value: v });
    };
    return (
      <div className="app">
        <h1>JODETE</h1>
        <p className="subtitle">Sala de espera</p>
        <div className="card-panel">
          <label>Compartí este código</label>
          <div className="code-display" data-testid="room-code">{view.code}</div>
          <p className="subtitle" data-testid="cut-info" style={{ margin: "8px 0 0" }}>
            Corte 🏁 <b>{view.cutThreshold}</b> pts · el que supera queda afuera (knockout)
          </p>
        </div>
        <div className="card-panel">
          <label>Jugadores ({view.players.length}/{MAX_PLAYERS})</label>
          <ul className="player-list">
            {view.players.filter((p) => !p.isBot).map((p) => (
              <li key={p.id} className="player-row">
                <span>
                  {p.name}{p.id === sessionId ? " (vos)" : ""}
                  {p.isHost ? <span className="badge host">HOST</span> : null}
                </span>
                <span>
                  <span className={`badge ${p.ready ? "ready" : "waiting"}`}>{p.ready ? "LISTO" : "esperando"}</span>
                  {isHost && p.id !== sessionId ? (
                    <button className="mini kick" data-testid={`kick-${p.id}`} title="Sacar de la sala" onClick={() => send(ClientMsg.KickPlayer, { playerId: p.id })}>✕</button>
                  ) : null}
                </span>
              </li>
            ))}
            {botCount > 0 ? (
              <li className="player-row" data-testid="bots-row">
                <span>🤖 Bots<span className="badge bot">{botCount}</span></span>
              </li>
            ) : null}
          </ul>
        </div>
        <div className="card-panel">
          <button data-testid="ready-btn" onClick={() => send(ClientMsg.Ready, !me?.ready)}>{me?.ready ? "Cancelar listo" : "Estoy listo"}</button>
          {isHost ? (<><div style={{ height: 10 }} />
            <div className="bot-counter" data-testid="bot-counter">
              <span className="bot-counter-label">Bots 🤖</span>
              <div className="bot-counter-controls">
                <button data-testid="bot-minus" className="mini" disabled={botShown <= 0} onClick={() => changeBots(botShown - 1)}>−</button>
                <span data-testid="bot-count" className="bot-counter-value">{botShown}</span>
                <button data-testid="bot-plus" className="mini" disabled={botShown >= maxBots} onClick={() => changeBots(botShown + 1)}>+</button>
              </div>
            </div>
            <div style={{ height: 10 }} />
            <div className="bot-counter" data-testid="cut-counter" title="Quien supere estos puntos queda afuera (knockout hasta que quede 1)">
              <span className="bot-counter-label">Corte 🏁</span>
              <div className="bot-counter-controls">
                <button data-testid="cut-minus" className="mini" disabled={cutShown <= MIN_CUT_THRESHOLD} onClick={() => changeCut(cutShown - 10)}>−</button>
                <span data-testid="cut-value" className="bot-counter-value">{cutShown}</span>
                <button data-testid="cut-plus" className="mini" disabled={cutShown >= MAX_CUT_THRESHOLD} onClick={() => changeCut(cutShown + 10)}>+</button>
              </div>
            </div>
            <div style={{ height: 10 }} />
            <button data-testid="start-btn" className={allReady ? "" : "secondary"} disabled={!allReady} onClick={() => send(ClientMsg.Start)}>
              {allReady ? "Empezar partida" : `Faltan jugadores/listos (mín. ${MIN_PLAYERS})`}
            </button></>) : null}
          <div style={{ height: 10 }} />
          <button className="secondary" onClick={leave}>Salir de la sala</button>
        </div>
        <p className="error" data-testid="error">{error}</p>
      </div>
    );
  }

  // ---- Fin de mano --------------------------------------------------------
  if (view.phase === "handEnd") {
    const rows = [...view.players].sort((a, b) => (view.scores[a.id] ?? 0) - (view.scores[b.id] ?? 0));
    const cutterName = view.players.find((p) => p.id === handEnd?.cutterId)?.name ?? "Alguien";
    return (
      <div className="app">
        <h1>JODETE</h1>
        <p className="subtitle" data-testid="hand-end">{cutterName} cortó 🎉 <span className="round-pts">(−{CUT_BONUS})</span></p>
        <div className="card-panel">
          <label>Puntaje (menos es mejor) · corte a {view.cutThreshold}</label>
          <ul className="player-list">
            {rows.map((p) => {
              const d = handEnd?.roundPoints[p.id];
              return (
              <li key={p.id} className={`player-row${p.eliminated ? " eliminated" : ""}`}>
                <span>{p.name}{p.id === sessionId ? " (vos)" : ""}{p.eliminated ? <span className="badge waiting">AFUERA</span> : null}</span>
                <span><b>{view.scores[p.id] ?? 0}</b>{d != null ? <span className="round-pts"> ({d >= 0 ? "+" : "−"}{Math.abs(d)})</span> : null}</span>
              </li>
              );
            })}
          </ul>
        </div>
        <div className="card-panel">
          {isHost ? <button data-testid="play-again-btn" onClick={() => send(ClientMsg.PlayAgain)}>Jugar otra mano</button>
            : <p style={{ textAlign: "center", color: "#9fc2b0" }}>Esperando al host…</p>}
          <div style={{ height: 10 }} />
          <button className="secondary" onClick={leave}>Salir</button>
        </div>
        {reconnecting ? <ReconnectOverlay onGiveUp={() => { intentionalLeaveRef.current = true; hardLeave(); }} /> : null}
      </div>
    );
  }

  // ---- Fin de partida (knockout: quedó 1) ---------------------------------
  if (view.phase === "gameEnd") {
    const rows = [...view.players].sort((a, b) => (view.scores[a.id] ?? 0) - (view.scores[b.id] ?? 0));
    const winnerName = view.players.find((p) => p.id === view.winnerId)?.name ?? "Alguien";
    return (
      <div className="app">
        <h1>JODETE</h1>
        <p className="subtitle" data-testid="game-end">🏆 {winnerName} ganó la partida</p>
        <div className="card-panel">
          <label>Puntaje final · corte a {view.cutThreshold}</label>
          <ul className="player-list">
            {rows.map((p) => (
              <li key={p.id} className={`player-row${p.eliminated ? " eliminated" : ""}`}>
                <span>{p.name}{p.id === sessionId ? " (vos)" : ""}{p.id === view.winnerId ? <span className="badge ready">GANADOR</span> : p.eliminated ? <span className="badge waiting">afuera</span> : null}</span>
                <span><b>{view.scores[p.id] ?? 0}</b></span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card-panel">
          {isHost ? <button data-testid="new-game-btn" onClick={() => send(ClientMsg.NewGame)}>Nueva partida</button>
            : <p style={{ textAlign: "center", color: "#9fc2b0" }}>Esperando al host…</p>}
          <div style={{ height: 10 }} />
          <button className="secondary" onClick={leave}>Salir</button>
        </div>
        {reconnecting ? <ReconnectOverlay onGiveUp={() => { intentionalLeaveRef.current = true; hardLeave(); }} /> : null}
      </div>
    );
  }

  // ---- Juego: mesa circular ----------------------------------------------
  const order = view.players;
  const n = order.length;
  const meIdx = order.findIndex((p) => p.id === sessionId);
  const opponents = order.filter((p) => p.id !== sessionId);
  return (
    <div className="game">
      <button className="rules-fab" data-testid="rules-btn" title="Reglas y cartas" onClick={() => setShowRules(true)}>?</button>
      {/* Bitácora: historial de jugadas y eventos, arriba a la izquierda, scrolleable. */}
      {logEntries.length > 0 ? (
        <div
          className="log-panel"
          data-testid="log-panel"
          ref={logScrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            logStickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {logEntries.map((l) => (
            <div key={l.id} className={`log-line ${l.kind}`}>{l.text}</div>
          ))}
        </div>
      ) : null}
      <div className="table-area" ref={tableRef}>
        <div className="table-circle">
          {/* Centro: mazo + pozo + estado de la mesa */}
          <div className="center">
            <div className={`deck ${isMyTurn ? "clickable" : ""}`} data-testid="deck"
              onClick={() => { if (isMyTurn) { playDraw(); send(ClientMsg.DrawCard); } }}
              title={isMyTurn ? "Robar" : undefined}>
              <div className="card back" /><div className="deck-count">{view.deckCount}</div>
            </div>
            <div className={`pile ${jokerPlay ? "joker-play" : ""}`} data-testid="pile" ref={pileRef}>
              {view.top ? <CardFace card={view.top} /> : null}
            </div>
            <div className="center-badges">
              {view.suitOpen ? <span className="suit-badge open" data-testid="suit-open" title="palo abierto: cualquiera puede tirar el palo que quiera">?</span>
                : view.activeSuit ? <span className={`suit-badge ${isRedSuit(view.activeSuit) ? "red" : ""}`} data-testid="active-suit">{suitSymbol(view.activeSuit)}</span> : null}
              {/* El sentido es info a deducir: solo aparece con el glow (tras 10s). */}
              {revealed ? <span className="dir" title="sentido">{view.direction === 1 ? "↻" : "↺"}</span> : null}
              {view.pendingDraw > 0 ? <span className="pending" data-testid="pending">Roba {view.pendingDraw}</span> : null}
            </div>
          </div>

          {/* Oponentes alrededor */}
          {opponents.map((p) => {
            const rel = (order.findIndex((q) => q.id === p.id) - meIdx + n) % n;
            const isCur = revealed && p.id === view.currentPlayerId;
            const backs = Math.min(p.handCount, 6);
            return (
              <div key={p.id} className={`seat ${isCur ? "active" : ""} ${p.id === lastPlayer ? "just-played" : ""} ${p.id === jodido ? "jodido" : ""} ${p.handCount === 1 && p.saidUna ? "una" : ""} ${p.connected ? "" : "gone"}`}
                style={seatPos(rel, n)} ref={(el) => { seatRefs.current[p.id] = el; }} data-testid={`seat-${p.id}`}>
                <div className="seat-fan">
                  {Array.from({ length: backs }, (_, i) => (
                    <CardBack key={i} style={{ ["--r" as string]: `${-((backs - 1) * 5) / 2 + i * 5}deg`, marginLeft: i ? -22 : 0 } as CSSProperties} />
                  ))}
                  {p.handCount === 0 ? <span className="seat-empty">—</span> : null}
                </div>
                <div className="seat-info">
                  <span className="seat-name">{p.name}{p.connected ? "" : " (desc.)"}</span>
                  <span className="seat-count">🂠 {p.handCount}{p.handCount === 1 && p.saidUna ? " · UNA" : ""}</span>
                </div>
                {p.handCount === 1 && !p.saidUna ? (
                  <button className="mini" data-testid={`accuse-${p.id}`} onClick={() => send(ClientMsg.AccuseUna, { targetId: p.id })}>¡le queda 1!</button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mi mano en abanico */}
      <div className={`myhand ${revealed && isMyTurn ? "myturn" : ""} ${rejectShake ? "rejected" : ""} ${lastPlayer === sessionId ? "just-played" : ""} ${jodido === sessionId ? "jodido" : ""} ${me?.handCount === 1 && me?.saidUna ? "una" : ""}`} ref={handRef} data-testid="hand"
        style={{ ["--hand-scale" as string]: handLayout.scale, ["--hand-w" as string]: `${handLayout.width}px`, height: `${handLayout.height}px` } as CSSProperties}>
        {orderedHand.length === 0 ? <span className="empty">Sin cartas</span> : null}
        {orderedHand.map((c, i) => {
          const L = handLayout.cards[i] ?? { x: 0, y: 0, r: 0, z: i };
          return (
          <CardFace key={c.id} card={c} style={{ ["--x" as string]: `${L.x}px`, ["--y" as string]: `${L.y}px`, ["--r" as string]: `${L.r}deg`, zIndex: L.z } as CSSProperties}
            onPointerDown={(e) => startDrag(e, c)}
            onPointerEnter={playHover}
            onDoubleClick={() => attemptPlay(c.id)}
            dimmed={dragState?.moved && dragState.cardId === c.id} />
          );
        })}
      </div>

      {/* HUD. Robar y Pasar comparten botón: aparece "Pasar" recién cuando ya robaste. */}
      <div className={`hud${hudPos ? " hud-side" : ""}`} style={hudPos ? { left: hudPos.left, top: hudPos.top, right: "auto", transform: "translateY(-50%)" } : undefined}>
        {view.pendingDraw === 0 && isMyTurn && view.drawnThisTurn ? (
          <button data-testid="pass-btn" className="chip neutral" onClick={() => send(ClientMsg.Pass)}>Pasar</button>
        ) : (
          <button data-testid="draw-btn" className={`chip draw ${view.pendingDraw > 0 ? "urgent-draw" : ""}`} onClick={() => { playDraw(); send(ClientMsg.DrawCard); }}>Robar{view.pendingDraw > 0 ? ` ${view.pendingDraw}` : ""}</button>
        )}
        <button data-testid="una-btn" className={`chip una ${me?.handCount === 1 && !me?.saidUna ? "urgent-una" : ""}`} onClick={() => send(ClientMsg.SayUna)}>¡UNA!</button>
        <button data-testid="jodete-btn" className="chip jodete" disabled={jodeteLocked} onClick={() => { setJodeteLocked(true); send(ClientMsg.CallJodete); }}>JODETE!</button>
        {mustPickSuit && suitModalHidden ? (
          <button data-testid="pick-suit-btn" className="chip urgent-una" onClick={() => setSuitModalHidden(false)}>Elegí palo</button>
        ) : null}
        <button className="link" onClick={leave}>Salir</button>
      </div>

      <p className="error hud-error" data-testid="error">{error}</p>

      {mustPickSuit && !suitModalHidden ? (
        // Clic afuera: oculta el modal (la carta ya está jugada; el palo sigue
        // abierto hasta que elijas o el siguiente tire). Se puede reabrir con el
        // botón "Elegí palo" del HUD.
        <div className="modal-bg" onClick={() => setSuitModalHidden(true)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p>Elegí el palo</p>
            <div className="suit-row">
              {SUITS.map((s) => (<button key={s} className={`suit-btn ${isRedSuit(s) ? "red" : ""}`} data-testid={`suit-${s}`} onClick={() => pickSuit(s)}>{suitSymbol(s)}</button>))}
            </div>
          </div>
        </div>
      ) : null}

      {dragState?.moved ? (() => {
        const c = hand.find((h) => h.id === dragState.cardId);
        return c ? <CardFace card={c} testid="dragging"
          style={{ position: "fixed", left: dragState.x - 35, top: dragState.y - 50, margin: 0, zIndex: 200, pointerEvents: "none", transform: "scale(1.7)", transformOrigin: "center" }} /> : null;
      })() : null}

      {flights.map((f) => (
        <FlyingCard key={f.key} card={f.card}
          getSource={() => (f.playerId === sessionId ? handRef.current : seatRefs.current[f.playerId] ?? null)}
          getPile={() => pileRef.current}
          onDone={() => {
            setFlights((prev) => prev.filter((x) => x.key !== f.key));
            if (f.joker) triggerJoker(); // el comodín gira recién al aterrizar en el pozo
          }} />
      ))}

      <div className="toasts" data-testid="toasts">
        {toasts.map((t) => (<div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>))}
      </div>

      {showRules ? <RulesModal onClose={() => setShowRules(false)} /> : null}

      {reconnecting ? <ReconnectOverlay onGiveUp={() => { intentionalLeaveRef.current = true; hardLeave(); }} /> : null}
    </div>
  );
}

// Overlay mientras se intenta reconectar tras un corte de red: la partida sigue
// visible detrás y el jugador NO es pateado al inicio (su asiento se reserva en
// el server). Solo cae al inicio si toca "Salir" o se agota la ventana.
function ReconnectOverlay({ onGiveUp }: { onGiveUp: () => void }) {
  return (
    <div className="reconnect-overlay" data-testid="reconnecting">
      <div className="reconnect-box">
        <div className="reconnect-spinner" />
        <p className="reconnect-title">Reconectando…</p>
        <p className="reconnect-sub">Perdimos la conexión. Te mantenemos en la mesa.</p>
        <button className="link" onClick={onGiveUp}>Salir al inicio</button>
      </div>
    </div>
  );
}
