// drawer.ts — the focus drawer: one camera, big, with everything known about
// it and a link back to the source that published it. Opens over the panel
// column, closes on Esc or the chevron (DESIGN_BRIEF §4).

import { clear, h, icon } from "../lib/dom.ts";
import { stamp } from "../lib/format.ts";
import { lang } from "../lib/i18n.ts";
import { proxied } from "../config.ts";
import { liveThumb } from "../lib/live.ts";
import { hkoHdUrl, type Camera } from "../map/cameras.ts";

export interface Drawer {
  openCamera(cam: Camera): void;
  /** Live-stream video: thumbnail + LIVE badge, or an honest off-air state. */
  openVideo(v: { id: string; title: string; channel?: string; live: boolean }): void;
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
    openVideo(v) {
      open = true;
      root.hidden = false;
      clear(root);
      const now = new Date();
      let body: HTMLElement;
      if (v.live) {
        // Direct video-id embed of a CONFIRMED-live stream. Autoplay muted so
        // the screen is not blasting sound at boot; the user unmutes.
        const frame = h("div", { class: "live-frame" });
        const iframe = document.createElement("iframe");
        iframe.src = `https://www.youtube.com/embed/${v.id}?autoplay=1&mute=1&playsinline=1`;
        iframe.allow = "autoplay; encrypted-media; picture-in-picture";
        iframe.title = v.title;
        frame.append(iframe);
        body = frame;
      } else {
        body = h(
          "div",
          { class: "pimg", style: "margin:0" },
          h("img", { src: liveThumb(v.id), alt: v.title, loading: "lazy" }),
          h(
            "figcaption",
            { class: "note" },
            lang() === "tc" ? "現時無直播（第三方串流）" : "Not live right now (third-party stream)",
          ),
        );
      }
      root.append(
        h(
          "div",
          { class: "drawer-head" },
          h("h2", { title: v.title }, `${v.title}${v.live ? " · LIVE" : ""}`),
          h(
            "button",
            { class: "drawer-close", type: "button", onclick: close, "aria-label": lang() === "tc" ? "閂" : "Close" },
            icon("M6 6l12 12M18 6L6 18", 16),
          ),
        ),
        h(
          "div",
          { class: "drawer-body" },
          body,
          h(
            "dl",
            { class: "kv" },
            h("dt", {}, lang() === "tc" ? "頻道" : "Channel"),
            h("dd", {}, v.channel ?? "—"),
            h("dt", {}, lang() === "tc" ? "性質" : "Nature"),
            h("dd", {}, lang() === "tc" ? "第三方直播（非官方）" : "Third-party stream (not official)"),
            h("dt", {}, lang() === "tc" ? "讀取時間" : "Fetched"),
            h("dd", {}, stamp(now)),
          ),
          h(
            "p",
            { class: "p-empty" },
            lang() === "tc"
              ? "直播狀態由系統即時偵測；串流內容由該第三方頻道提供，本頁唔會核實或轉載內容。"
              : "Live state is detected at runtime; the stream is the channel's own and is not endorsed here.",
          ),
        ),
      );
    },
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
      // Transient failures happen (HKO through the proxy, back-to-back panics);
      // give the drawer a retry instead of a dead end.
      const deadState = () =>
        h(
          "div",
          { class: "p-error" },
          h("span", {}, lang() === "tc" ? "暫時未能提供影像" : "image temporarily unavailable"),
          h(
            "button",
            {
              type: "button",
              onclick: () => {
                const fresh = h("img", { class: "hero", src: `${isHko ? proxied(hkoHdUrl(cam.img)) : cam.img}?t=${Date.now()}`, alt: cam.name }) as HTMLImageElement;
                fresh.addEventListener("error", () => {
                  const host = img.parentElement;
                  host?.replaceWith(deadState());
                });
                img.replaceWith(fresh);
              },
            },
            lang() === "tc" ? "重試" : "Retry",
          ),
        );
      img.addEventListener("error", () => img.replaceWith(deadState()));

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
