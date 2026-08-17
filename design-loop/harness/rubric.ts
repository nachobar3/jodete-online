// Rúbrica subjetiva (1..5) que puntúa el juez de visión por cada momento×viewport.
// Los pesos reflejan que Jodete es un juego de VELOCIDAD: leer el estado al instante
// (turno, jugables) pesa más que la cohesión estética.
export interface Dimension {
  key: string;
  label: string;
  weight: number;
  prompt: string; // guía concreta para el juez
}

export const DIMENSIONS: Dimension[] = [
  { key: "turn_clarity", label: "Claridad de turno", weight: 1.5,
    prompt: "En 1 segundo, ¿se entiende si es MI turno o de otro? Indicador de turno visible e inequívoco." },
  { key: "affordance", label: "Affordance de jugables", weight: 1.5,
    prompt: "¿Se distingue sin pensar qué cartas puedo tirar? Las jugables deben destacar de las no-jugables." },
  { key: "hierarchy", label: "Jerarquía visual", weight: 1.2,
    prompt: "¿El ojo va primero a lo importante (tope, tu mano, tu turno) y no a decoración?" },
  { key: "legibility", label: "Legibilidad de la mano", weight: 1.2,
    prompt: "Palos y números claros y distinguibles a este tamaño de pantalla. Rojo/negro diferenciados." },
  { key: "feedback", label: "Feedback de eventos", weight: 1.2,
    prompt: "Espejito, challenge (JODETE), UNA, carta rechazada, robo pendiente: ¿se entiende qué pasó?" },
  { key: "mobile_ergonomics", label: "Ergonomía mobile", weight: 1.0,
    prompt: "El pulgar alcanza las acciones; la mano no queda tapada; nada crítico pegado a los bordes." },
  { key: "aesthetics", label: "Cohesión estética", weight: 0.8,
    prompt: "Paleta, spacing y ritmo coherentes; se siente terminado, no un placeholder." },
  { key: "typography", label: "Tipografía", weight: 0.8,
    prompt: "Jerarquía tipográfica, tamaños y tracking adecuados. Acá evaluar propuestas de fuentes." },
];

export const DIMENSION_KEYS = DIMENSIONS.map((d) => d.key);
export const TOTAL_WEIGHT = DIMENSIONS.reduce((s, d) => s + d.weight, 0);

// score compuesto ponderado a partir de {dimKey: value}
export function composite(scores: Record<string, number>): number {
  let acc = 0;
  for (const d of DIMENSIONS) acc += (scores[d.key] ?? 0) * d.weight;
  return acc / TOTAL_WEIGHT;
}
