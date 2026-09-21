// drawer.ts — the focus drawer: one camera, big, with everything known about
// it and a link back to the source that published it. Opens over the panel
// column, closes on Esc or the chevron (DESIGN_BRIEF §4).

import { clear, h, icon } from "../lib/dom.ts";
import { stamp } from "../lib/format.ts";
import { lang } from "../lib/i18n.ts";
import { proxied } from "../config.ts";
import { hkoHdUrl, type Camera } from "../map/cameras.ts";

export interface Drawer {
  openCamera(cam: Camera): void;
  close(): void;
  isOpen(): boolean;
}

export function createDrawer(root: HTMLElement): Drawer {
  let open = false;

  const close = () => {
    open = false;
    root.hidden = true;
    clear(root);
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) close();
  });

  return {
    isOpen: () => open,
    close,
    openCamera(cam) {
      open = true;
      root.hidden = false;
      clear(root);

      const isHko = cam.kind === "hko";
      // The wall uses the small HKO frame; the drawer is where the HD one is
      // worth its 462 KB. TD snapshots are 320×240 originals, hotlinked.
      const src = isHko ? proxied(hkoHdUrl(cam.img)) : `${cam.img}?t=${Date.now()}`;
      const sourceUrl = isHko ? "https://www.hko.gov.hk/en/wxinfo/ts/index_webcam.htm" : "https://www.td.gov.hk/tc/special_news/trafficnews/index.html";
      const taken = new Date();

      const img = h("img", { class: "hero", src, alt: cam.name }) as HTMLImageElement;
      img.addEventListener("error", () => {
        img.replaceWith(
          h("div", { class: "p-empty" }, lang() === "tc" ? "暫時未能提供影像" : "image temporarily unavailable"),
        );
      });

      root.append(
        h(
          "div",
          { class: "drawer-head" },
          h("h2", { title: cam.name }, cam.name),
          h(
            "button",
            { class: "drawer-close", type: "button", onclick: close, "aria-label": lang() === "tc" ? "閂" : "Close" },
            icon("M6 6l12 12M18 6L6 18", 16),
          ),
        ),
        h(
          "div",
          { class: "drawer-body" },
          img,
          h(
            "dl",
            { class: "kv" },
            h("dt", {}, lang() === "tc" ? "營運" : "Operator"),
            h("dd", {}, isHko ? "香港天文台" : "運輸署"),
            cam.district ? h("dt", {}, lang() === "tc" ? "地區" : "District") : "",
            cam.district ? h("dd", {}, cam.district) : "",
            cam.region ? h("dt", {}, lang() === "tc" ? "區域" : "Region") : "",
            cam.region ? h("dd", {}, cam.region) : "",
            h("dt", {}, lang() === "tc" ? "座標" : "Position"),
            h("dd", {}, `${cam.lat.toFixed(5)}, ${cam.lon.toFixed(5)}`),
            h("dt", {}, lang() === "tc" ? "影像編號" : "Camera ID"),
            h("dd", {}, cam.id),
            h("dt", {}, lang() === "tc" ? "讀取時間" : "Fetched"),
            h("dd", {}, stamp(taken)),
          ),
          h(
            "p",
            { class: "p-empty" },
            lang() === "tc"
              ? "快照由官方攝影機提供，畫面內的時間戳由該署印上。本頁唔會改圖。"
              : "Snapshot served by the official camera; the timestamp burned into the frame is the publisher's. Nothing is altered here.",
          ),
          h(
            "p",
            {},
            h("a", { href: sourceUrl, target: "_blank", rel: "noopener" }, lang() === "tc" ? "資料來源 ↗" : "Source ↗"),
          ),
        ),
      );
    },
  };
}
