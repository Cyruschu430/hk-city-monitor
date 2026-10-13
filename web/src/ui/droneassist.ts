// droneassist.ts — 無人機模式的 SUA assistant, embedded.
//
// In drone mode the map's corner offers the assistant for the mode's own subject: a round
// button above the Lands Department notice — the chat-widget shape, one bot glyph — that
// unfolds the assistant in a frame. The frame is created on FIRST OPEN and never at boot:
// a third-party page loaded unasked is a page every reader pays for, and the readers who
// never open it are most of them.
//
// Three things this file has to respect, all of which fail silently:
//   · #mapHud is a pointer-events:none pass-through layer, so this child opts back in.
//   · The page's own Content-Security-Policy lists frame-src origins explicitly
//     (web/public/_headers). A frame for an origin that is not listed is blocked by the
//     browser and renders as an empty box — with no error anywhere.
//   · The button carries NO VISIBLE TEXT now that it is an icon, so its accessible name has
//     to come from aria-label and it has to survive a language switch. An icon-only control
//     with no name is a button a screen reader cannot describe; check-shell asserts a name
//     is present rather than trusting this comment.
import { h, icon } from "../lib/dom.ts";
import { lang, onLangChange } from "../lib/i18n.ts";

/** Where the assistant lives. Keep this origin in step with frame-src in _headers. */
export const DRONE_ASSIST_SRC = "https://sua-assistant.pages.dev/embed";

/** A bot head: rounded shell, two eyes, one antenna. Inline SVG, never an emoji. */
const BOT = "M6 10h12a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4a2 2 0 012-2z|M10 14h.01|M14 14h.01|M12 10V6.5|M10.2 6.5h3.6";
/** Close: the same button ends up as the only way to put the frame away. */
const CLOSE = "M8 8l8 8|M16 8l-8 8";

export function droneAssist(): HTMLElement {
  const bot = icon(BOT, 22);
  bot.classList.add("drone-assist-bot");
  const close = icon(CLOSE, 20);
  close.classList.add("drone-assist-close");

  const body = h("div", { class: "drone-assist-body" });
  const head = h("button", { class: "drone-assist-head", type: "button", "aria-expanded": "false" }, bot, close);
  const wrap = h("div", { class: "drone-assist" }, head, body);

  const render = () => {
    const tc = lang() === "tc";
    const name = tc ? "無人機助手" : "Drone assistant";
    const hint = tc ? "撳一下展開（外部頁面）" : "tap to open (external page)";
    head.setAttribute("aria-label", `${name} — ${hint}`);
    head.title = `${name} — ${hint}`;
    const frame = body.querySelector("iframe");
    if (frame) frame.setAttribute("title", name);
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
          title: lang() === "tc" ? "無人機助手" : "Drone assistant",
          loading: "lazy",
          referrerpolicy: "no-referrer",
          allow: "clipboard-write",
        }),
      );
    }
  });

  return wrap;
}
