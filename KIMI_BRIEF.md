# Design challenge — 香港城市監察 visual identity

**For:** Kimi, running unattended overnight.
**Goal:** produce something that looks *world-class* — the register of World Monitor's dashboard
and God's Eye View, but with Hong Kong's own identity, not theirs.

Read this whole file before writing a line. It exists so you do not repeat four failed attempts.

---

## 1. The product

**香港城市監察 · HK City Monitor** — a **big-screen situation dashboard** (1920×1080) that a Hong
Kong resident or a journalist opens to see, in one look, what is happening in the city right now.

- **Audience:** HK public, journalists, curious people. Traditional Chinese is the default,
  English switchable.
- **It is a public open-source project**, not a government system and not an AI product. Do not
  imply official status. Do not name any individual.
- **What it is not:** a general news site, a map viewer, a data catalogue. It answers
  *「香港而家發生咩事」* in one screen.

## 2. The one thing that matters most

**This is a dashboard, not a webpage.** The difference is hierarchy: a webpage stacks sections; a
dashboard has one dominant instrument and everything else supporting it.

If a viewer cannot tell in two seconds where to look first, it has failed.

## 3. Required layout (hard)

- **A top status bar:** product name, LIVE indicator, number of data sources (171), clock
  (`2026-09-18 21:52 HKT`).
- **One hero that owns the screen** — the map of Hong Kong. Not one tile among many. Roughly the
  top half or more.
- **A control rail** (left or right): time range (1小時/6小時/24小時/7日), category
  (全部/供水/醫療/交通/天氣/口岸), and a layer checklist. This is where drill-down lives.
- **Two to four functional panels** below the hero: 路面快拍 (camera snapshots), 供水事故
  (water incidents), 急症室輪候 (A&E waits).
- **A ticker** with the latest incident.

## 4. Real data — use these exact values, invent nothing

**Emergency water suspensions, in progress, 4 (all 恢復時間未定):**
| District | Location |
|---|---|
| 東區 | 港運城 1-3 座, 港運大廈, 七姊妹道 15-23A,25-31 號 |
| 深水埗區 | 發祥街西公廁對出至發祥街西遊樂場 |
| 九龍城區 | 太子道西 331-341 號、九龍城道 98-124 號 |
| 油尖旺區 | 加連威老道 2-6 號, 加連威老廣場, 彌敦道 130-134 號 |

**Scheduled water suspensions:** 康怡廣場 23/09 00:30 · 青宏苑 22/09 10:00

**A&E non-urgent waits (median, 50th percentile):** 基督教聯合醫院 8 小時 ·
廣華醫院 7.5 小時 · 瑪嘉烈醫院 6.5 小時 （18 間醫院）

**Market:** 恒生指數 24,750.78 (+0.15%) · 騰訊 419.0 (−1.64%) · 阿里巴巴 109.3 (+4.00%)

**Border crossings:** several reporting 0 minutes.

## 5. Basemap — already measured, do not re-litigate

Use the Lands Department XYZ tiles. They are **keyless** and must be credited on screen:
**「地圖及地名：地政總署」**.

```
topographic  https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png
labels (tc)  https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/WGS84/{z}/{x}/{y}.png
imagery      https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/imagery/WGS84/{z}/{x}/{y}.png
```

**Tile order is `{z}/{x}/{y}` here. Esri is `{z}/{y}/{x}` — swapped order gives a plausible-looking
but wrong map.**

Two findings already measured with real pixels, so trust them:

1. **The aerial imagery is unusable as a night basemap.** At 21:52 the frames are almost black and
   the map stops reading as a map.
2. **Darken the topographic tiles; do not desaturate them.** `Brightness(0.52)` + `Contrast(1.12)`
   keeps roads, coastline, urban blocks and hills legible on dark chrome. A desaturated version
   loses the roads entirely. **`invert` + `hue-rotate` is banned** — it turns a map into a
   meaningless heatmap blob. The label layer is light text and needs no treatment.

You may also use the **abstract map** approach (drawn Hong Kong coastline shapes) if the real tiles
fight your design — but say so and show why.

## 6. Banned — these read as amateur or AI-generated

- purple/blue gradients, aurora washes
- glassmorphism cards (frosted blur panels)
- glow, neon bloom, drop shadows with colour
- large border radii (anything above ~6px on panels)
- emoji as UI
- tracked ALL-CAPS eyebrow labels above every heading
- joining phrases with `·` as a separator
- Inter / Roboto / Montserrat as the UI font
- decorative animation that carries no information

## 7. Borrow discipline, not identity

World Monitor and God's Eye View are references for **grammar only**. What is worth borrowing:

- one dominant visual with everything else supporting it
- boxed labels **tethered by thin leader lines** to the exact point they describe
- colour used **only to mean something** (red = critical, amber = upcoming, green = live)
- a rail or bar of mode/filter controls treated as a first-class control
- a dense cluster of many small camera frames inside one panel

What is **theirs and must not be copied**: their dark-teal/neon-green palette, FLIR thermal
imaging, the 3D globe, DEFCON-style status theatre, their typography.

> Cyrus's words: **「唔係叫你抄足」** — do not copy it wholesale.

**Where the Hong Kong identity comes from** — not from the layout:
- a city dense enough that **1,013 traffic cameras + 34 weather cameras** are all pointing at *one*
  place. No global dashboard can do this.
- **繁體中文 place names on the official basemap** — it should feel like *our* map.
- real public-service numbers a resident actually opens the page for (a water suspension, an 8-hour
  A&E wait, a border queue)
- the idea that the dashboard **reshapes itself around the situation** (pick 停水 and the wall
  reorganises around water) — World Monitor shows everything at once; we follow the incident

## 8. What already failed — do not repeat these

Four attempts exist in `design/attempts/`. Read them and the notes. Summary of what went wrong:

1. **attempt-1 / attempt-2 (tile walls)** — a 12×5 grid of equal tiles. Rejected: no hierarchy, it
   reads as a webpage of boxes. Equal-size tiles are the amateur tell here.
2. **attempt-3 (reference grammar)** — hero + HUD labels + rail + panels. Right structure, but:
   labels overlap in dense areas, panels have unused space on the right, and the market panel is
   questioned as off-topic for a city monitor.
3. **attempt-4 (deepseek-v4-pro, one-shot)** — scored 6.5/10, "competent but generic". The verdict
   named exactly the failure mode to avoid: **incident labels look like absolutely-positioned HTML
   boxes floating on top of the map**, the map reads as a placeholder rather than a designed
   component, typography is generic, and there is no memorable idea.

**The pattern across all four: every one was generated in a single pass.** One-shot generation does
not reach world-class, whatever the model. The gap is not intelligence, it is iteration.

## 9. How to work tonight — the loop, not a single answer

**Do not write one file and stop.** Work in rounds. For each round:

1. Write a complete single-file `index.html` (inline CSS, vanilla JS, **no framework, no CDN**).
2. **Render it and look at it.** Screenshot at 1920×1080:
   ```
   chromium --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
     --window-size=1920,1080 --virtual-time-budget=8000 \
     --screenshot=shot-NN.png file:///path/to/index.html
   ```
   If you have vision, **look at that PNG**. If you do not, at minimum open the DOM and check that
   every element you intended is present and positioned — never assume it rendered.
3. **Name ONE concrete defect** you can see. Not "make it better" — a specific thing: *"the two
   labels in 油尖旺 overlap at this zoom"*, *"the panel header row is 6px taller than its sibling
   so the borders do not line up"*.
4. **Fix exactly that.** Then round again.

Log every round in `design/ITERATION_LOG.md`: round number, the defect you named, what you changed,
what you would attack next. **A round where you changed nothing is a failed round** — say so.

Cap it at 10–12 rounds, then stop and write a summary of where you got to and what is still weak.
**Ship the honest state, not a polished claim.**

## 10. Definition of done

- `index.html` — one file, opens with no build step, correct at 1920×1080
- `shot-final.png` — a screenshot of the final state
- `design/ITERATION_LOG.md` — an honest round-by-round log
- `design/NOTES.md` — what you are proud of, what you know is still weak, what you would do next

## 11. Rules

- **Simplified Chinese is wrong. Write 繁體中文** (Hong Kong). English where labelled.
- **No secrets, no tokens, no API keys in any file.** If you need one, stop and ask.
- **No VPS IP addresses or hostnames in any file in this repo.** Never.
- Work on a branch; do not push to `master`.
- Do not touch any file outside `design/`.
- Credit 地政總署 wherever LandsD tiles appear.
- If a tile or endpoint does not load, **say so** and show the fallback. Do not fake it.
