// palette.ts — ⌘K/Ctrl-K command palette, World Monitor's "jump to any layer,
// panel or country without learning the UI first".
//
// Search space = everything the user might want: the modes (verticals), every
// panel in the registry, and every camera (name/district). Substring match on
// the current language. Keyboard: Ctrl/Cmd+K open, ↑/↓ move, Enter run, Esc
// close. No dependencies.

import { clear, h } from "../lib/dom.ts";
import { lang } from "../lib/i18n.ts";
import type { Camera } from "../map/cameras.ts";
import type { Registry } from "../lib/sources.ts";

interface Entry {
  kind: "mode" | "panel" | "camera";
  label: string;
  hint: string;
  modeId?: string;
  panelId?: string;
  cam?: Camera;
}

export interface PaletteDeps {
  registry: Registry;
  cameras: { td: Camera[]; hko: Camera[] };
  onMode(id: string): void;
  onCamera(cam: Camera): void;
  currentMode(): string;
}

export function createPalette(deps: PaletteDeps): void {
  let open = false;
  let index: Entry[] = [];
  let sel = 0;

  const root = h("div", { class: "palette", hidden: "", role: "dialog", "aria-label": "command palette" });
  const input = h("input", { class: "palette-input", type: "text", placeholder: lang() === "tc" ? "搜尋模式、面板、相機…" : "Search modes, panels, cameras…" }) as HTMLInputElement;
  const list = h("ul", { class: "palette-list" });
  root.append(input, list);
  document.body.append(root);

  function buildIndex(): void {
    const L = lang();
    index = [];
    index.push({ kind: "mode", label: L === "tc" ? "總覽" : "Overview", hint: L === "tc" ? "全部重要面板" : "all key panels", modeId: "overview" });
    for (const v of deps.registry.verticals) {
      index.push({ kind: "mode", label: L === "tc" ? v.name.tc : v.name.en, hint: L === "tc" ? v.question.tc : v.question.en, modeId: v.id });
    }
    for (const p of deps.registry.panels) {
      const tn = L === "tc" ? p.title.tc : p.title.en;
      index.push({ kind: "panel", label: tn, hint: p.id, panelId: p.id, modeId: modeOfPanel(p.id) });
    }
    for (const c of [...deps.cameras.td, ...deps.cameras.hko]) {
      index.push({ kind: "camera", label: c.name, hint: c.district || (c.kind === "hko" ? "天氣攝影機" : "交通快拍"), cam: c });
    }
  }

  /** Which mode shows a given panel? (overview-only panels point back to overview.) */
  function modeOfPanel(panelId: string): string | undefined {
    const v = deps.registry.verticals.find((x) => x.panels.includes(panelId));
    return v ? v.id : "overview";
  }

  function filter(q: string): Entry[] {
    const qq = q.trim().toLowerCase();
    return index.filter((e) => !qq || e.label.toLowerCase().includes(qq) || e.hint.toLowerCase().includes(qq));
  }

  function paint(results: Entry[]): void {
    clear(list);
    sel = Math.min(sel, Math.max(0, results.length - 1));
    results.forEach((e, i) => {
      const li = h(
        "li",
        { class: "palette-item", role: "option", onclick: () => run(e) },
        h("span", { class: `palette-kind k-${e.kind}` }, e.kind === "mode" ? "模式" : e.kind === "panel" ? "面板" : "相機"),
        h("span", { class: "palette-label" }, e.label),
        h("span", { class: "palette-hint" }, e.hint),
      );
      if (i === sel) li.setAttribute("data-sel", "true");
      list.append(li);
    });
  }

  function run(e: Entry): void {
    close();
    if (e.kind === "mode" && e.modeId) deps.onMode(e.modeId);
    else if (e.kind === "camera" && e.cam) deps.onCamera(e.cam);
    else if (e.kind === "panel" && e.panelId && e.modeId) {
      if (deps.currentMode() !== e.modeId) deps.onMode(e.modeId);
      // The panel mounts after its mode's setPanels; give it a beat, then
      // scroll it into view and flash it so the jump is visible.
      setTimeout(() => {
        const el = document.querySelector(`[data-panel="${e.panelId}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.classList.add("flash");
        setTimeout(() => el?.classList.remove("flash"), 1400);
      }, 500);
    }
  }

  function openIt(): void {
    open = true;
    buildIndex();
    root.hidden = false;
    input.value = "";
    paint(index);
    input.focus();
  }
  function close(): void {
    open = false;
    root.hidden = true;
  }

  input.addEventListener("input", () => paint(filter(input.value)));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel++; paint(filter(input.value)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel--; paint(filter(input.value)); }
    else if (e.key === "Enter") { const r = filter(input.value)[sel]; if (r) run(r); }
    else if (e.key === "Escape") close();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      open ? close() : openIt();
    }
  });
  // Click-outside closes.
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) close();
  });
}