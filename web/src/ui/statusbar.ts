// statusbar.ts — 40px strip: product identity, live pulse, and the facts a
// control room keeps in the corner (camera count, tile route, clock).
// The language switch lives here because it is a session-wide switch, not a
// per-panel choice (PRIMITIVES §2.5: the renderer picks the language).

import { clear, h } from "../lib/dom.ts";
import { clockNow } from "../lib/format.ts";
import { lang, setLang, type Lang } from "../lib/i18n.ts";

export interface StatusBar {
  setCameras(td: number, hko: number): void;
  setMode(name: string, question: string): void;
  setTiles(via: string): void;
}

export function createStatusBar(root: HTMLElement): StatusBar {
  clear(root);
  const pulse = h("span", { class: "live-pulse", title: "live" });
  const modeEl = h("span", {});
  const camsEl = h("span", { class: "hide-s" });
  const tilesEl = h("span", { class: "hide-s" });
  const clockEl = h("span", {});
  const langBox = h("div", { id: "langSwitch", role: "group", "aria-label": "language" });

  const buttons = new Map<Lang, HTMLElement>();
  for (const [code, label] of [["tc", "繁中"], ["en", "EN"]] as [Lang, string][]) {
    const b = h("button", { type: "button", onclick: () => setLang(code) }, label);
    b.setAttribute("aria-pressed", String(lang() === code));
    buttons.set(code, b);
    langBox.append(b);
  }
  const syncPressed = () => {
    for (const [code, b] of buttons) b.setAttribute("aria-pressed", String(lang() === code));
  };
  syncPressed();

  root.append(
    h(
      "div",
      { class: "brand" },
      pulse,
      h("h1", {}, "HK CITY MONITOR"),
      h("span", { class: "sub" }, "香港城市監察"),
    ),
    h("div", { class: "meta" }, modeEl, camsEl, tilesEl, clockEl, langBox),
  );

  const timer = window.setInterval(() => (clockEl.textContent = `${clockNow()} HKT`), 1000);
  clockEl.textContent = `${clockNow()} HKT`;
  window.addEventListener("beforeunload", () => window.clearInterval(timer));

  return {
    setCameras(td, hko) {
      camsEl.textContent = `相機 ${(td + hko).toLocaleString("en-US")}`;
    },
    setMode(name, question) {
      modeEl.textContent = name;
      modeEl.title = question;
    },
    setTiles(via) {
      tilesEl.textContent = via === "direct" ? "底圖：LandsD 直連" : "底圖：經 Worker 快取";
    },
  };
}
