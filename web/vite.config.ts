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

// ── The Rollup warning that is deliberately NOT fixed ─────────────────────────
//
// `vite build` prints:
//
//   Export "WebGLDevice" of module "@luma.gl/webgl/dist/adapter/webgl-device.js" was
//   reexported through module "@luma.gl/webgl/dist/index.js" while both modules are
//   dependencies of each other and will end up in different chunks ... this scenario is
//   not well supported at the moment as it will produce a circular dependency between
//   chunks and will likely lead to broken execution order.
//   Either change the import in "@deck.gl/core/dist/lib/layer.js" ... or reconfigure
//   output.manualChunks to ensure these modules end up in the same chunk.
//
// MEASURED 2026-09-27 — the warning is real and the suggested fix is WORSE:
//
//   · The 3D path WORKS TODAY. Toggling 3D 樓宇 loads its lazy payload and logs nothing,
//     so this is a latent execution-order hazard, not a live failure.
//   · Following the advice (manualChunks pinning @deck.gl + @luma.gl, and separately the
//     whole vis stack) MERGED the ~938KB lazy 3D chunk INTO the graph index.html
//     preloads, because deck.gl is ALSO imported statically for the 2D overlay layers.
//     First paint went from 925KB of JS to 2,931KB of JS+CSS. Both variants, both worse.
//
// So the warning stays and the measurement stays with it. The real fix is not a build
// setting: it is to stop routing the 2D overlays through deck.gl, so the library is only
// reachable behind the 3D toggle. That is a rewrite of map/overlays.ts, not a config
// tweak, and it is not worth a 3x first paint to silence one warning.
//
// If you try manualChunks again: measure first paint before and after. `npm run
// measure:boot` prints the byte total and every file on the critical path.
