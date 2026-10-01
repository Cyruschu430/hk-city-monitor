// footer.ts — who makes this, what it is built on, and what it is not.
//
// The wording is Cyrus's call (2026-10-01): "又唔使寫同港府無關嘅 ... 我都係想用呢個 contribute
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
    tc: "數據來源:政府各部門及公共機構的開放數據(CSDI、data.gov.hk 等),各有其授權條款。本項目為開源社群項目,由義工維護,希望以開放數據回饋社會。",
    en: "Data: open data published by Hong Kong government departments and public bodies (CSDI, data.gov.hk and others), each under its own licence. This is an open-source community project, maintained by volunteers, to put open data to public use.",
  },
  source: { tc: "原始碼", en: "Source" },
  licence: { tc: "AGPL-3.0 授權", en: "AGPL-3.0" },
  author: { tc: "由 Cyrus Chu 建立", en: "Built by Cyrus Chu" },
  built: { tc: "決定性規則引擎 · 零追蹤 · 零 cookie", en: "Deterministic rule engine · no tracking · no cookies" },
};

export function createFooter(root: HTMLElement): void {
  const build = () => {
    const tc = lang() === "tc";
    root.replaceChildren(
      h(
        "footer",
        { class: "app-foot" },
        h(
        "div",
        { class: "foot-row" },
        h("span", { class: "foot-author" }, T.author[tc ? "tc" : "en"]),
        h("a", { class: "foot-link", href: REPO, target: "_blank", rel: "noopener noreferrer" }, T.source[tc ? "tc" : "en"]),
        h("a", { class: "foot-link", href: LICENSE, target: "_blank", rel: "noopener noreferrer" }, T.licence[tc ? "tc" : "en"]),
      ),
        h("p", { class: "foot-data" }, T.data[tc ? "tc" : "en"]),
        h("p", { class: "foot-note" }, T.built[tc ? "tc" : "en"]),
      ),
    );
  };
  build();
  onLangChange(build);
}
