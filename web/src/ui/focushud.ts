// focushud.ts — the God's-Eye-View grammar on a flat map: when a camera is
// selected, a COMPACT boxed HUD is tethered to the point by a thin leader line
// (name, coordinates, live thumbnail), while the full-size drawer still opens.
// The HUD tracks the camera as the map moves, eases in at 200ms, and closes on
// Esc / a click on the map / its own chevron.

import type maplibregl from "maplibre-gl";
import { clear, h } from "../lib/dom.ts";
import { lang } from "../lib/i18n.ts";
import { proxied } from "../config.ts";
import { hkoStandardUrl, type Camera } from "../map/cameras.ts";

export interface FocusHud {
  show(cam: Camera): void;
  clear(): void;
}

export function createFocusHud(map: maplibregl.Map, container: HTMLElement): FocusHud {
  let camera: Camera | null = null;

  const hud = h("div", { class: "focus-hud", hidden: "" });
  const leader = h("div", { class: "focus-leader", hidden: "" });
  container.append(hud, leader);

  function thumbSrc(cam: Camera): string {
    return cam.kind === "hko" ? proxied(hkoStandardUrl(cam.img)) : cam.img;
  }

  function close(ev?: Event): void {
    if (ev) ev.stopPropagation();
    hud.hidden = true;
    leader.hidden = true;
    camera = null;
  }

  /** Recompute the box + leader geometry from the camera's projected position. */
  function position(): void {
    if (!camera || hud.hidden) return;
    const rect = container.getBoundingClientRect();
    const p = map.project([camera.lon, camera.lat]);
    const px = p.x - rect.left;
    const py = p.y - rect.top;

    // Box sits up-left of the point; clamp inside the map so it never trails
    // off-screen. Metrics tuned for the 260px-wide box.
    const BOX_W = 260;
    const BOX_H = 78;
    let x = px - BOX_W - 18;
    let y = py - BOX_H - 8;
    if (x < 10) x = px + 20;
    if (y < 10) y = py + 20;
    if (x + BOX_W > rect.width - 10) x = rect.width - BOX_W - 10;
    if (y + BOX_H > rect.height - 10) y = rect.height - BOX_H - 10;

    hud.style.left = `${x}px`;
    hud.style.top = `${y}px`;

    // Leader line: a thin div spanning from the box's nearest edge to the point.
    const boxCx = x + BOX_W / 2;
    const boxCy = y + BOX_H / 2;
    const dx = px - boxCx;
    const dy = py - boxCy;
    const len = Math.max(0, Math.hypot(dx, dy) - 0);
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Anchor the line at the box centre and rotate; width = distance.
    leader.style.width = `${len}px`;
    leader.style.left = `${boxCx}px`;
    leader.style.top = `${boxCy}px`;
    leader.style.transform = `rotate(${ang}deg)`;
    leader.hidden = false;
  }

  map.on("move", position);
  map.on("zoom", position);
  map.on("rotate", position);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  // A click anywhere on the map surface (not the HUD) dismisses the label.
  container.addEventListener("mousedown", (e) => {
    if (!hud.contains(e.target as Node)) close();
  });

  return {
    clear: () => close(),
    show(cam) {
      camera = cam;
      clear(hud);
      const img = h("img", { class: "focus-thumb", src: thumbSrc(cam), alt: cam.name, loading: "lazy" }) as HTMLImageElement;
      img.addEventListener("error", () => img.replaceWith(h("div", { class: "focus-thumb focus-thumb-dead" })));
      hud.append(
        h("div", { class: "focus-box" },
          img,
          h("div", { class: "focus-meta" },
            h("b", {}, cam.name),
            h("span", { class: "focus-coords" }, `${cam.lat.toFixed(5)}, ${cam.lon.toFixed(5)}`),
            cam.district ? h("span", { class: "focus-district" }, cam.district) : "",
          ),
          h("button", { class: "focus-close", type: "button", "aria-label": lang() === "tc" ? "閂" : "Close", onclick: (e) => close(e) }, "×"),
        ),
      );
      hud.hidden = false;
      hud.style.animation = "none";
      // re-trigger the 200ms slide-in
      void hud.offsetWidth;
      hud.style.animation = "";
      position();
    },
  };
}