// droneassist.ts — 無人機模式的 SUA assistant, embedded.
//
// In drone mode the map's corner offers the assistant for the mode's own subject: a button
// above the Lands Department notice that opens the whole SUA assistant in a frame. The
// frame is created on FIRST OPEN and never at boot — a third-party page loaded unasked is
// a page every reader pays for, and the readers who never open it are most of them.
//
// Two things this file has to respect, both of which fail silently:
//   · #mapHud is a pointer-events:none pass-through layer, so this child opts back in.
//   · The page's own Content-Security-Policy lists frame-src origins explicitly
//     (web/public/_headers). A frame for an origin that is not listed is blocked by the
//     browser and renders as an empty box — with no error anywhere. The origin is listed
//     there; check-shell.mjs asserts the frame actually loads.
import { h } from "../lib/dom.ts";
import { lang, onLangChange } from "../lib/i18n.ts";

/** Where the assistant lives. Keep this origin in step with frame-src in _headers. */
export const DRONE_ASSIST_SRC = "https://sua-assistant.pages.dev/embed";

export function droneAssist(): HTMLElement {
  const body = h("div", { class: "drone-assist-body" });
  const caret = h("span", { class: "drone-assist-caret", "aria-hidden": "true" }, "\u25be");
  const head = h(
    "button",
    { class: "drone-assist-head", type: "button", "aria-expanded": "false" },
    h("span", { class: "drone-assist-title" }),
    caret,
  );
  const wrap = h("div", { class: "drone-assist" }, head, body);

  const title = () => (lang() === "tc" ? "無人機助手" : "Drone assistant");
  const render = () => {
    head.querySelector(".drone-assist-title")!.textContent = title();
    head.title =
      lang() === "tc"
        ? "小型無人機操作助手（外部頁面，撳一下展開）"
        : "Small unmanned aircraft assistant (external page, tap to open)";
  };
  render();
  onLangChange(render);

  head.addEventListener("click", () => {
    const open = wrap.classList.toggle("is-open");
    head.setAttribute("aria-expanded", String(open));
    if (open && !body.querySelector("iframe")) {
      // Loading it here, not in the markup: see the header comment.
      body.append(
        h("iframe", {
          class: "drone-assist-frame",
          src: DRONE_ASSIST_SRC,
          title: title(),
          loading: "lazy",
          referrerpolicy: "no-referrer",
          allow: "clipboard-write",
        }),
      );
    }
  });

  return wrap;
}
