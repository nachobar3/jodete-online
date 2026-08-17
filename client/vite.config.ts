import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // escucha en 0.0.0.0 para jugar desde otros dispositivos de la red
  },
});
