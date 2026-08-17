// Tamaños de pantalla a probar. Landscape mobile es donde más se rompen los
// juegos de cartas (mano vs alto disponible), por eso está incluido.
export interface Viewport {
  name: string;
  width: number;
  height: number;
  mobile: boolean; // afecta thresholds objetivos (tap targets, etc.)
}

export const VIEWPORTS: Viewport[] = [
  { name: "mobile-portrait", width: 390, height: 844, mobile: true },
  { name: "mobile-landscape", width: 844, height: 390, mobile: true },
  { name: "tablet", width: 820, height: 1180, mobile: true },
  { name: "desktop", width: 1280, height: 720, mobile: false },
  { name: "desktop-wide", width: 1920, height: 1080, mobile: false },
];
