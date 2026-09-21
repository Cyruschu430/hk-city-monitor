import { defineConfig } from "vite";

// base "./" — the bundle deploys by copying dist/* under an existing site root
// (e.g. /hkmonitor/), so asset URLs must stay relative.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    // deck.gl is only reachable through a dynamic import behind the 3D toggle;
    // it lands in its own chunk and never ships on first paint (PRIMITIVES §0.00).
    chunkSizeWarningLimit: 1200,
  },
});
