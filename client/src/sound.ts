// Sonidos generados con Web Audio API (sin archivos):
//  - playThrow : tirar una carta a la mesa ("shhh" brillante)
//  - playDraw  : robar del mazo (swish grave)
//  - playGlass : espejito (campana de vidrio / cristal)
//  - playHover : pasar por una carta (swish muy corto)

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Habilita/reanuda el audio dentro de un gesto del usuario. */
export function primeAudio() {
  ac();
}

function noiseBuffer(c: AudioContext, dur: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// Ráfaga de ruido filtrado con envolvente rápida (swish).
function swish(dur: number, vol: number, freq: number, q: number, hp: number) {
  const c = ac();
  if (!c) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const hpf = c.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = hp;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hpf);
  hpf.connect(bp);
  bp.connect(g);
  g.connect(c.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** Tirar una carta a la mesa. */
export function playThrow() {
  swish(0.2, 0.5, 2600, 0.6, 800);
}

/** Robar del mazo (más grave/apagado que tirar). */
export function playDraw() {
  swish(0.26, 0.42, 1200, 0.5, 300);
}

// Throttle del hover.
let lastHover = 0;
/** Pasar por una carta. */
export function playHover() {
  const now = performance.now();
  if (now - lastHover < 55) return;
  lastHover = now;
  swish(0.05, 0.12, 4200, 1.2, 1500);
}

/** Espejito: campana de vidrio / cristal. */
export function playGlass() {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const master = c.createGain();
  master.gain.value = 0.9;
  master.connect(c.destination);
  // Armónicos altos e inarmónicos = timbre "vidrio".
  const partials = [3150, 4700, 6300, 8300];
  partials.forEach((f, i) => {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = f * (1 + i * 0.003);
    const g = c.createGain();
    const vol = 0.3 / (i + 1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0 - i * 0.14);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 1.05);
  });
  // "tilín" inicial de cristal (ruido muy agudo y corto).
  swish(0.04, 0.18, 9000, 2, 5000);
}
