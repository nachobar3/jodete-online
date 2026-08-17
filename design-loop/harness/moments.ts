// Momentos canónicos: estados de UX que deben leerse bien. Cada uno se siembra
// determinísticamente (misma semilla entre iteraciones) para que el screenshot sea
// comparable y aísle el cambio de diseño del azar del mazo.
import type { Table } from "./table.ts";
import { startGame, seed, hand, filler } from "./table.ts";

export interface Moment {
  key: string;
  label: string;
  players: number;
  video?: boolean;      // grabar video del contexto (transiciones animadas)
  optional?: boolean;   // si el guion falla (timing), no aborta la iteración
  // Construye el estado y devuelve el índice de página a screenshotear.
  build: (t: Table) => Promise<number>;
}

const pause = (t: Table, ms: number) => t.pages[0].waitForTimeout(ms);

export const MOMENTS: Moment[] = [
  {
    key: "lobby", label: "Lobby (sala + código + jugadores)", players: 3,
    build: async (t) => {
      await t.pages[1].getByTestId("ready-btn").click();
      await pause(t, 200);
      return 0; // host ve la sala con el código y la lista
    },
  },
  {
    key: "mano-repartida", label: "Mano recién repartida (reparto real)", players: 3,
    build: async (t) => { await startGame(t); await pause(t, 300); return 0; },
  },
  {
    key: "tu-turno", label: "Es tu turno", players: 3,
    build: async (t) => {
      await startGame(t);
      await seed(t, {
        top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0,
        handsByIdx: {
          0: hand(["cAs", "S", "A"], ["cKs", "S", "K"], ["cQs", "S", "Q"], ["cJs", "S", "J"], ["c10s", "S", "10"], ["c7h", "H", "7"], ["c2d", "D", "2"]),
          1: filler(4, "a"), 2: filler(2, "b"),
        },
      });
      await pause(t, 400);
      return 0;
    },
  },
  {
    key: "turno-ajeno", label: "Turno de otro (esperando)", players: 3,
    build: async (t) => {
      await startGame(t);
      await seed(t, {
        top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 1,
        handsByIdx: {
          0: hand(["cAs", "S", "A"], ["cKs", "S", "K"], ["cQh", "H", "Q"], ["cJd", "D", "J"], ["c10c", "C", "10"], ["c7h", "H", "7"], ["c2d", "D", "2"]),
          1: filler(4, "a"), 2: filler(2, "b"),
        },
      });
      await pause(t, 400);
      return 0;
    },
  },
  {
    key: "elegir-palo", label: "Selector de palo (8 / comodín)", players: 3,
    build: async (t) => {
      await startGame(t);
      await seed(t, {
        top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0,
        handsByIdx: {
          0: hand(["c8h", "H", "8"], ["cKs", "S", "K"], ["cQs", "S", "Q"], ["c9d", "D", "9"], ["c10c", "C", "10"], ["c7h", "H", "7"], ["c2d", "D", "2"]),
          1: filler(4, "a"), 2: filler(2, "b"),
        },
      });
      await t.pages[0].getByTestId("hand").getByTestId("card-c8h").click();
      await t.pages[0].getByTestId("suit-C").waitFor({ timeout: 4000 });
      return 0;
    },
  },
  {
    key: "pila-robo", label: "Robo pendiente (jugó un 2)", players: 3, optional: true,
    build: async (t) => {
      await startGame(t);
      await seed(t, {
        top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0,
        handsByIdx: {
          0: hand(["c2s", "S", "2"], ["cKs", "S", "K"], ["cQs", "S", "Q"], ["c9d", "D", "9"], ["c10c", "C", "10"], ["c7h", "H", "7"], ["c3d", "D", "3"]),
          1: filler(4, "a"), 2: filler(2, "b"),
        },
      });
      await t.pages[0].getByTestId("hand").getByTestId("card-c2s").click();
      await t.pages[1].getByTestId("pending").waitFor({ timeout: 4000 });
      return 1; // el que recibe el "Roba 2"
    },
  },
  {
    key: "espejito", label: "Espejito ganado (fuera de turno)", players: 3, video: true, optional: true,
    build: async (t) => {
      await startGame(t);
      await seed(t, {
        top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0,
        handsByIdx: {
          0: hand(["cKs", "S", "K"], ["cQs", "S", "Q"], ["c9d", "D", "9"], ["c10c", "C", "10"], ["c3d", "D", "3"], ["c4h", "H", "4"], ["c5c", "C", "5"]),
          1: hand(["esp7", "S", "7"], ["a1", "D", "3"], ["a2", "D", "3"], ["a3", "D", "3"]),
          2: filler(2, "b"),
        },
      });
      await pause(t, 300);
      await t.send(1, "playEspejito", { cardId: "esp7", observedVersion: 0 });
      await pause(t, 700);
      return 0;
    },
  },
  {
    key: "cantar-una", label: "Te queda 1 carta (UNA)", players: 3,
    build: async (t) => {
      await startGame(t);
      await seed(t, {
        top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 1,
        handsByIdx: { 0: hand(["cQs", "S", "Q"]), 1: filler(5, "a"), 2: filler(5, "b") },
      });
      await pause(t, 400);
      return 0; // host con 1 carta, botón UNA relevante
    },
  },
  {
    key: "fin-ronda", label: "Fin de ronda + puntaje", players: 3, optional: true,
    build: async (t) => {
      await startGame(t);
      await seed(t, {
        top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0,
        handsByIdx: { 0: hand(["cKs", "S", "K"]), 1: filler(5, "a"), 2: filler(5, "b") },
      });
      await t.send(0, "sayUna");
      await pause(t, 200);
      await t.pages[0].getByTestId("hand").getByTestId("card-cKs").click();
      await t.pages[0].getByTestId("hand-end").waitFor({ timeout: 5000 });
      await pause(t, 300);
      return 0;
    },
  },
  {
    // G1: la carta debe viajar de la mano/asiento del jugador hasta la mesa. Capturamos a
    // un OPONENTE jugando (siempre animado; la jugada propia por drag se suprime <500ms).
    key: "jugada-normal", label: "Carta viajando a la mesa (G1)", players: 3, video: true, optional: true,
    build: async (t) => {
      await startGame(t);
      await seed(t, {
        top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 1,
        handsByIdx: { 0: filler(5, "h"), 1: hand(["g7h", "H", "7"], ["g1", "D", "3"], ["g2", "D", "3"], ["g3", "D", "3"]), 2: filler(2, "b") },
      });
      await pause(t, 300);
      await t.pages[1].getByTestId("hand").getByTestId("card-g7h").click();
      await pause(t, 900); // dejar correr la animación (~640ms)
      return 0; // host mira la carta viajar desde el asiento de Walter
    },
  },
  {
    // G8: la carta de Joker debe verse como un bufón colorido, NO "JK". Screenshot del comodín en mano.
    key: "comodin-en-mano", label: "Carta Joker en mano (G8)", players: 3, optional: true,
    build: async (t) => {
      await startGame(t);
      await seed(t, {
        top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0,
        handsByIdx: {
          0: hand(["cJK", "S", "JOKER"], ["cKs", "S", "K"], ["cQs", "S", "Q"], ["c9d", "D", "9"], ["c10c", "C", "10"], ["c4h", "H", "4"], ["c5c", "C", "5"]),
          1: filler(4, "a"), 2: filler(2, "b"),
        },
      });
      await pause(t, 400);
      return 0;
    },
  },
  {
    // G7: debe haber animación específica al jugar un comodín. Oponente juega el Joker.
    key: "comodin-jugado", label: "Comodín jugado (G7)", players: 3, video: true, optional: true,
    build: async (t) => {
      await startGame(t);
      await seed(t, {
        top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 1,
        handsByIdx: { 0: filler(5, "h"), 1: hand(["gJK", "S", "JOKER"], ["g1", "D", "3"], ["g2", "D", "3"]), 2: filler(2, "b") },
      });
      await pause(t, 300);
      await t.send(1, "playCards", { cardIds: ["gJK"], declaredSuit: "C", observedVersion: 0 });
      await pause(t, 1000);
      return 0;
    },
  },
  {
    // G13: al "joderse" (penalización) debe haber animación + glow ROJO. Acusamos UNA a quien tiene 1 carta.
    key: "se-jode", label: "Alguien se jode (glow rojo) (G13)", players: 3, video: true, optional: true,
    build: async (t) => {
      await startGame(t);
      await seed(t, {
        top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0,
        handsByIdx: {
          0: hand(["cKs", "S", "K"], ["cQs", "S", "Q"], ["c9d", "D", "9"], ["c10c", "C", "10"], ["c4h", "H", "4"], ["c5c", "C", "5"], ["c3d", "D", "3"]),
          1: hand(["solo", "H", "9"]), 2: filler(3, "b"),
        },
      });
      await pause(t, 300);
      await t.send(0, "accuseUna", { targetId: t.ids[1] }); // Walter tiene 1 y no dijo UNA → roba 3
      await pause(t, 1000);
      return 0;
    },
  },
  {
    key: "carta-rechazada", label: "Carta rechazada (error)", players: 3, optional: true,
    build: async (t) => {
      await startGame(t);
      await seed(t, {
        top: { id: "TOP", suit: "S", rank: "7" }, currentIdx: 0,
        handsByIdx: {
          0: hand(["c3h", "H", "3"], ["cKs", "S", "K"], ["cQs", "S", "Q"], ["c9c", "C", "9"], ["c10c", "C", "10"], ["c4h", "H", "4"], ["c5c", "C", "5"]),
          1: filler(4, "a"), 2: filler(2, "b"),
        },
      });
      // 3♥ es ilegal sobre 7♠; jugada inmediata (<permanencia) => actionRejected
      await t.pages[0].getByTestId("hand").getByTestId("card-c3h").click();
      await t.pages[0].getByTestId("error").waitFor({ timeout: 4000 });
      return 0;
    },
  },
];
