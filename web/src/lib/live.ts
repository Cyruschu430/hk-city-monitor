// live.ts — runtime "is this YouTube stream actually live right now?"
//
// The design-brief's measured fact: hardcoding a channel embed is a black
// rectangle most of the time (the live_stream?channel= pattern failed every
// test). YouTube has no keyless isLive API, but the platform publishes a
// second thumbnail only while a video is truly live:
//   https://i.ytimg.com/vi/<ID>/hqdefault_live.jpg  → 200 only when live
// That is what this module probes, cached 90s so a wall refresh doesn't
// hammer YouTube. Label shown to users is 直播 / 現時無直播 — never a guessed
// on/off state.

const TTL_MS = 90_000;
const cache = new Map<string, { live: boolean; at: number }>();

export async function probeLive(videoId: string): Promise<boolean> {
  const hit = cache.get(videoId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.live;
  const live = await new Promise<boolean>((resolve) => {
    if (typeof Image === "undefined") {
      resolve(false); // non-browser (tests): the wall just shows no-LIVE state
      return;
    }
    const img = new Image();
    const done = (v: boolean) => {
      clearTimeout(timer);
      // Do NOT clear img.src here: assigning "" aborts the decode and Chromium
      // logs "InvalidStateError: The source image could not be decoded" —
      // real noise that doubles as false failure signals.
      resolve(v);
    };
    const timer = setTimeout(() => done(false), 6000); // slow network ≠ live
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = `https://i.ytimg.com/vi/${videoId}/hqdefault_live.jpg`;
  });
  cache.set(videoId, { live, at: Date.now() });
  return live;
}

export function liveThumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}