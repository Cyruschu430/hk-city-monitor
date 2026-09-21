// dom.ts — the small DOM helper the stack decision allows (no framework).
// h("div", {class: "x", onclick: fn}, child, "text") — attributes vs children
// stay explicit; nothing magical, nothing global.

type Attrs = {
  [k: string]: string | number | boolean | EventListener | undefined;
};
type Child = Node | string | null | undefined | false;

export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "dataset" && typeof v === "object") {
      Object.assign(el.dataset, v as Record<string, string>);
    } else if (v === true) {
      el.setAttribute(k, "");
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c as Node | string);
  }
  return el;
}

/** Inline SVG icon, 1.5px stroke, round caps, currentColor (DESIGN_BRIEF §7:
    icons are inline SVG only — never an emoji, never an icon font). */
export function icon(paths: string, size = 20): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of paths.split("|")) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.firstChild.remove();
}
