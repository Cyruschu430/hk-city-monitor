// statusbar.ts — the 40px instrument strip: identity, live pulse, and the
// discrete readouts a control room keeps in the corner. Readouts are LABEL +
// VALUE cells rather than one run-on sentence, so each number is scannable and
// has a fixed home (a value that moves around reads as an amateur dashboard).

import { clear, h } from "../lib/dom.ts";
import { clockNow } from "../lib/format.ts";
import { lang, setLang, type Lang } from "../lib/i18n.ts";

export interface StatusBar {
  setCameras(td: number, hko: number): void;
  setMode(name: string): void;
  setTiles(via: string): void;
  /** readout for the currently active vertical's data age, if any */
  setFreshness(text: string, state: "ok" | "warn" | "bad"): void;
}

/** One label+value readout cell. */
function stat(label: string, value: HTMLElement | string, extraClass = ""): HTMLElement {
  return h("div", { class: `stat ${extraClass}` }, h("span", { class: "stat-label" }, label), h("span", { class: "stat-value" }, value));
}

export function createStatusBar(root: HTMLElement): StatusBar {
  clear(root);
  const pulse = h("span", { class: "live-pulse", title: "live" });
  const modeEl = h("span", {});
  const camsEl = h("span", {});
  const tilesEl = h("span", {});
  const clockEl = h("span", {});
  const freshEl = h("span", {});
  const freshDot = h("i", { class: "stat-dot" });
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

  const freshStat = stat("狀態", h("span", {}, freshDot, freshEl), "stat-fresh");

  root.append(
    h("div", { class: "brand" }, pulse, h("h1", {}, "HK CITY MONITOR"), h("span", { class: "sub" }, "香港城市監察")),
    h(
      "div",
      { class: "meta" },
      freshStat,
      stat("模式", modeEl),
      stat("相機", camsEl, "hide-s"),
      stat("底圖", tilesEl, "hide-s"),
      stat("HKT", clockEl),
      langBox,
    ),
  );

  const timer = window.setInterval(() => (clockEl.textContent = clockNow()), 1000);
  clockEl.textContent = clockNow();
  window.addEventListener("beforeunload", () => window.clearInterval(timer));

  return {
    setCameras(td, hko) {
      camsEl.textContent = (td + hko).toLocaleString("en-US");
    },
    setMode(name) {
      modeEl.textContent = name;
    },
    setTiles(via) {
      tilesEl.textContent = via === "direct" ? "LandsD 直連" : "Worker 快取";
    },
    setFreshness(text, state) {
      freshEl.textContent = text;
      freshStat.setAttribute("data-fresh", state);
    },
  };
}
