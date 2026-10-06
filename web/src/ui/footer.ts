// footer.ts — who makes this, what it is built on, and what it is not.
//
// "又唔使寫同港府無關嘅 ... 我都係想用呢個 contribute
// 呢個社會". So it credits the publishers warmly instead of disclaiming them coldly. It still
// does not claim official status — "maintained by volunteers" is true and does the same job as a
// disclaimer without reading like a lawyer's note bolted onto a public dashboard.
//
// It lives at the end of the panel column, not fixed to the viewport: a permanent strip costs
// map height on every screen for something a reader checks once, and the column already has a
// bottom to put it at.
import { h } from "../lib/dom.ts";
import { lang, onLangChange } from "../lib/i18n.ts";

const REPO = "https://github.com/Cyruschu430/hk-city-monitor";
const LICENSE = "https://www.gnu.org/licenses/agpl-3.0.html";

const T = {
  data: {
    tc: "數據來源：政府各部門及公共機構的開放數據（CSDI、data.gov.hk 等），各有其授權條款。本項目為開源社群項目，由義工維護，希望以開放數據回饋社會。",
    en: "Data: open data published by Hong Kong government departments and public bodies (CSDI, data.gov.hk and others), each under its own licence. This is an open-source community project, maintained by volunteers, to put open data to public use.",
  },
  source: { tc: "原始碼", en: "Source" },
  licence: { tc: "AGPL-3.0 授權", en: "AGPL-3.0" },
  author: { tc: "由 Cyrus Chu 建立", en: "Built by Cyrus Chu" },
  built: { tc: "決定性規則引擎 · 零追蹤 · 零 cookie", en: "Deterministic rule engine · no tracking · no cookies" },
};

/** Filled GitHub octocat mark (the app's `icon()` helper is stroke-only, so this is its own). */
function ghIcon(size = 16): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute(
    "d",
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  );
  svg.append(p);
  return svg;
}

export function createFooter(parent: HTMLElement): void {
  // APPEND, never replaceChildren: `parent` is `#panelCol`, a LIVE container whose children
  // (#panelTabs, #panels, #panelRestore) are built elsewhere. The first version of this function
  // called `parent.replaceChildren(...)` and wiped all three - boot died with "Cannot read
  // properties of null (reading 'replaceChildren')" inside setTabs, 4 checks went to a readiness
  // timeout, and the cause was a footer. A component that takes a container must add to it.
  const foot = h("footer", { class: "app-foot" });
  const build = () => {
    const tc = lang() === "tc";
    foot.replaceChildren(
      h(
        "footer",
        { class: "app-foot" },
        h(
        "div",
        { class: "foot-row" },
        h("span", { class: "foot-author" }, T.author[tc ? "tc" : "en"]),
        h("a", { class: "foot-gh", href: REPO, target: "_blank", rel: "noopener noreferrer", title: T.source[tc ? "tc" : "en"], "aria-label": T.source[tc ? "tc" : "en"] }, ghIcon()),
        h("a", { class: "foot-link", href: LICENSE, target: "_blank", rel: "noopener noreferrer" }, T.licence[tc ? "tc" : "en"]),
      ),
        h("p", { class: "foot-data" }, T.data[tc ? "tc" : "en"]),
        h("p", { class: "foot-note" }, T.built[tc ? "tc" : "en"]),
      ),
    );
  };
  build();
  onLangChange(build);
  parent.append(foot);
}
