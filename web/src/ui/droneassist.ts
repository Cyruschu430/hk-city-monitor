// droneassist.ts — 無人機模式的 SUA assistant, embedded.
//
// In drone mode the map's corner carries the assistant for that mode's own subject: a round
// button above the Lands Department notice — the chat-widget shape, the app's own mark inside
// it — which unfolds the assistant over the map.
//
// The frame is created on FIRST OPEN and never at boot: a third-party page loaded unasked is
// a page every reader pays for, and the readers who never open it are most of them.
//
// WHY IT IS A FULL OVERLAY RATHER THAN A SMALL FLOATING BOX. A box in the corner either
// leaves fragments of the map's own furniture showing at its edges — half a placard, a clipped
// clock — which reads as broken, or it has to be dodged around until it fits in no corner
// properly. Covering the map band outright is the tidy version of the same thing: the reader
// sees one deliberate panel, closes it, and the map is exactly as it was. The button stays
// above the LandsD notice so the licence credit is never hidden.
//
// Three things here fail silently and are asserted instead of trusted:
//   · #mapHud is a pointer-events:none pass-through layer, so this child opts back in.
//   · The page's own Content-Security-Policy lists frame-src origins explicitly
//     (web/public/_headers). A frame for an unlisted origin is blocked and drawn as an empty
//     box, with no error anywhere — check-shell watches the network for the response.
//   · The button carries no visible text, so its accessible name comes from aria-label and has
//     to survive a language switch.
import { h, icon } from "../lib/dom.ts";
import { lang, onLangChange } from "../lib/i18n.ts";

/** Where the assistant lives. Keep this origin in step with frame-src in _headers. */
export const DRONE_ASSIST_SRC = "https://sua-assistant.pages.dev/embed";
/** The chosen crop of the project's own mark: robot head + AI badge, 88px for a 44px button. */
const MARK = "brand/drone-assist.png";

const CLOSE = "M8 8l8 8|M16 8l-8 8";

export function droneAssist(): HTMLElement {
  const mark = h("img", { class: "drone-assist-mark", src: MARK, alt: "", width: "30", height: "30" });
  mark.classList.add("drone-assist-bot");
  const close = icon(CLOSE, 20);
  close.classList.add("drone-assist-close");

  const title = h("b", { class: "drone-assist-title" }, "");
  const note = h("span", { class: "drone-assist-note" }, "");
  const panelClose = h("button", { class: "drone-assist-x", type: "button" }, icon(CLOSE, 16));
  const top = h("div", { class: "drone-assist-top" }, mark.cloneNode(true), title, note, panelClose);
  const loading = h("div", { class: "drone-assist-load" }, "");
  const body = h("div", { class: "drone-assist-body" }, top, loading);

  const head = h("button", { class: "drone-assist-head", type: "button", "aria-expanded": "false" }, mark, close);
  const wrap = h("div", { class: "drone-assist" }, head, body);

  const names = () => {
    const tc = lang() === "tc";
    return {
      title: tc ? "無人機助手" : "Drone assistant",
      hint: tc ? "撳一下展開（外部頁面）" : "tap to open (external page)",
      note: tc ? "外部頁面" : "external page",
      loading: tc ? "載入中…" : "Loading…",
    };
  };

  const render = () => {
    const n = names();
    head.setAttribute("aria-label", `${n.title} — ${n.hint}`);
    head.title = `${n.title} — ${n.hint}`;
    title.textContent = n.title;
    note.textContent = n.note;
    loading.textContent = n.loading;
    panelClose.setAttribute("aria-label", n.title);
    body.querySelector(".drone-assist-top .drone-assist-mark")?.setAttribute("alt", n.title);
    const frame = body.querySelector("iframe");
    if (frame) frame.setAttribute("title", n.title);
  };

  const setOpen = (open: boolean) => {
    wrap.classList.toggle("is-open", open);
    head.setAttribute("aria-expanded", String(open));
    if (open && !body.querySelector("iframe")) {
      // Loading it here, not in the markup: see the header comment.
      const frame = h("iframe", {
        class: "drone-assist-frame",
        src: DRONE_ASSIST_SRC,
        title: names().title,
        loading: "lazy",
        referrerpolicy: "no-referrer",
        allow: "clipboard-write",
      });
      // The third-party page takes a moment; without this the panel is an empty rectangle
      // that looks broken for as long as that takes.
      frame.addEventListener("load", () => loading.remove());
      body.append(frame);
    }
  };

  head.addEventListener("click", () => setOpen(!wrap.classList.contains("is-open")));
  panelClose.addEventListener("click", () => setOpen(false));

  render();
  onLangChange(render);

  return wrap;
}
