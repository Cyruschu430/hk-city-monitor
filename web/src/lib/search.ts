// search.ts — the reader's search queries.
//
// Its own module on purpose: render.ts must not import adapters.ts. The renderer is a pure function of
// the data it is handed and has no business knowing the data layer exists - and the
// honesty test suite loads render.ts under plain node ESM, where adapters.ts (which pulls a JSON index
// and the source registry) cannot resolve at all. Two ten-line helpers living alone keeps both true.

/** The reader's query for a panel. A search is state, not configuration: a panel rebuilt from the
    registry on every poll would otherwise forget what the reader just typed. Same lesson layercontrol
    already learned with its module-state query. */
export function searchQuery(panelId: string): string {
  try {
    return (localStorage.getItem(`hkcm.search.${panelId}`) ?? "").trim();
  } catch {
    return "";
  }
}

export function setSearchQuery(panelId: string, q: string): void {
  try {
    if (q.trim()) localStorage.setItem(`hkcm.search.${panelId}`, q.trim());
    else localStorage.removeItem(`hkcm.search.${panelId}`);
  } catch {
    /* private mode: the search still works for this render, it just does not persist */
  }
}
