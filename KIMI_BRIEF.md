# Overnight work order — HK City Monitor

**For:** an autonomous coding agent running unattended on Cyrus's PC for one night.
**Read `AGENTS.md` first — it is the authority.** This file only adds: tonight's scope, the working
discipline, the stop rules, and the handover format. Do not treat it as a second spec.

## 0. You are expected to beat this, not comply with it

**Cyrus's concern, verbatim: 「但佢有可能比佢設計得更好，寫佢冇得改好大鑊，佢係頂級國產模型」.**

So: the design in this repo is **one attempt, not a ceiling**. Cyrus believes you may well design it
better than the attempt that produced it, and he is explicit that boxing you in would be the bigger
failure. **You have permission to redesign the front end from scratch.** You do not need to ask.

Two kinds of constraint, and only one of them binds you:

**Binding — these are measured facts, not opinions.** Contradicting one requires your own measurement,
not a paragraph of reasoning:
- LandsD aerial imagery is unusable as a night basemap (measured at 21:52: the map stops reading as a map)
- darken the topographic tiles (`Brightness(0.52)` + `Contrast(1.12)`); a desaturated version loses
  the roads entirely; `invert` is banned
- LandsD tile order is `{z}/{x}/{y}`; Esri's is `{z}/{y}/{x}` — swapping them gives a plausible-looking
  wrong map
- a vision model reviewing a screenshot **invented** labels that a broken build had deleted, and
  invented UI that was never in the file. **A count beats an adjective.**
- YouTube's `embed/live_stream?channel=` pattern is unreliable — verified across three channels, none
  live, and it errored over both `file://` and `https://`
- the real data values in §4 below
- the security and cost stops in §3 — these are not design choices

**Not binding — this is taste, and it is yours:** layout, hierarchy, palette, typography, type scale,
whether there is a hero at all, how labels are drawn, which panels exist and in what order, motion.
**If you discard the whole structure, do it, and say what you replaced and why.**

The banned list in `DESIGN_BRIEF.md` is a diagnostic for amateur tells, not a law. If you want to use
something on it, name the item and argue it — a considered exception is fine; silently inheriting my
taste is not.

`design/attempts/` exists as **evidence of what went wrong**, not as a style to follow. The useful
part of each is the verdict, not the pixels.

## 0.1 Read these before writing anything (in this order)

`AGENTS.md` → `TECH_SPEC.md` → `PRIMITIVES.md` → `VERTICALS.md` → `DESIGN_BRIEF.md` →
`SECURITY.md` → `COST.md`

`AGENTS.md` carries the fixed tech stack, the Run sequence (Run 0–6), the hard constraints, the
verification requirements, and eleven pitfalls already paid for. Read the pitfalls — they are the
cheapest section in the whole repo.

## 1. Tonight's scope

Work **`AGENTS.md`'s Run sequence, in order**: Run 1 → Run 6. One Run per commit, in order.

- **Run 1 — the Worker** (`worker/`). Write it. **Do not deploy it.**
- **Run 2 — the renderer.** Vite/TS scaffold, design tokens, and the render types. This is where the
  visual work lives — see §2.
- **Run 3 — trigger and context.** Pure functions, with the assert-based tests the spec asks for.
- **Run 4 — 停水模式. ⚠️ This is the gate.** The whole architecture claim is that adding a vertical
  changes only config, never a code path. When you finish Run 4 you must answer, in writing, in the
  log: **did you change any code outside configuration?** If yes, the shared primitives are wrong —
  say so plainly and fix the primitives. That honest answer is worth more than a green tick.
- **Run 5 — 颱風 and 口岸, config only.** When you are done, `git diff` must show changes to
  **`verticals.json` only**. Run that command and paste the output into the log as evidence. If it
  shows anything else, the config boundary leaked — report it as a failure, do not tidy it up.
- **Run 6 — the basemap.** LandsD XYZ tiles plus the Traditional Chinese label layer, and the lazy
  3D layer.

Run 0 is Cyrus's, not yours — it is already satisfied if you are reading this on his PC.

## 2. The design loop — for anything visual (this part IS binding)

Four earlier attempts at the front end all failed, and every one was a **single generation**. The
strongest of them scored 6.5/10 — *"competent but generic"*. The variable was never the model. It
was that none of them rendered, looked, and fixed.

So for any visual work, loop. Per round:

1. Render at 1920×1080 exactly as the screenshot command in `AGENTS.md`/`DESIGN_BRIEF.md` says.
2. **Look at the PNG** if you can see images.
3. **Measure it.** DOM counts, element bounds, `scrollHeight`, overlap counts. A screenshot tells you
   what it looks like; a count tells you what is true.
4. **Name ONE concrete defect.**
5. Fix that one thing. Re-render. Re-measure.

**Vision is a prompt, not a verdict.** Measured this session: a vision model reviewed the screenshot
of a broken build and reported that the incident labels "are now separated and readable" — after a
bad edit had deleted all ten of them. It then invented UI elements that were never in the file.
`hud=0` was the truth. **Prefer a count to an adjective.**

Read before designing:
- `design/attempts/README.md` — the four failures and why each failed. Do not rebuild any of them.
- `design/attempts/attempt-2b-NOTES.md` — what one honest loop round looks like, with the numbers.

And remember the direction: the reference products are for **grammar, not identity**. Borrow the
hierarchy, the leader-line labels, the rule that colour only means something. Do not borrow their
palette, their globe, their thermal imaging, or their status theatre. Cyrus's words: **「唔係叫你抄足」**.

## 3. Hard stops — do not do these, tonight or ever

- **Do not deploy anything.** No `wrangler deploy`, no publishing, no pushing to `master`.
- **Do not create accounts**, sign up for anything, or accept any terms.
- **No secrets in any file.** No keys, no tokens, no passwords, no cookies. If a task needs one,
  stop and write it in the log as blocked.
- **No VPS IP addresses or hostnames in any file in this repo.** This repo is public. Not even as an
  example, not even in a comment.
- **Do not install software** globally or change any machine setting.
- **Do not spend money.** Nothing that costs, nothing metered. The project target is zero cost — an
  endpoint that could bill is a defect, not a shortcut.
- **Stay inside the repo clone.** Do not read or write anywhere else on the machine. Do not open a
  browser profile that is logged in to anything.
- **Do not rewrite history** or force-push. Work on a branch.

## 4. When you are blocked

Write the blocker in the log with the exact command and the exact error, then **move to the next
Run**. Do not fake a result, do not stub and call it done, and do not quietly skip.

**A claim without a command output is not a result.** "The Worker is written" means nothing;
"`node --check worker/src/index.js` exits 0, here is the output" is a result. Never mark something
verified that you did not run.

## 4.5 Long-running processes: the mistake that will hang your round

**Measured twice on 2026-09-18:** the round ran `wrangler dev`, which is a server that never exits.
The shell tool waited for it, so the round produced nothing for 13 minutes and then forever. Killing
it and relaunching with `Start-Process` **did not help** — because without a redirect the child
inherits the tool's pipe and the wait never ends.

**Any command that does not exit must have its output redirected to a file AND be fully detached:**

```powershell
Start-Process -FilePath cmd -ArgumentList '/c','wrangler dev --port 8787 > C:\hk-city-monitor\dev.log 2>&1' -WindowStyle Hidden
```

The rule in one line: **if a command does not return, redirect its output and detach it — otherwise
the tool waits forever.** Start the server in one step, then in a *separate* step `curl` it and read
`dev.log`. Never start it and wait in the same call.

If you already have a dev server running from an earlier round, do not start a second one — check
first (`netstat -ano | findstr :8787`).

## 5. Work in rounds, not one long sprint

Cap yourself at a fixed number of rounds and stop. For each round, append to
`design/OVERNIGHT_LOG.md`:

```
## Round N — <what you set out to do>
- Did: <what changed>
- Evidence: <the exact command and its output>
- Defect found and fixed: <ONE concrete thing>
- Still broken / still weak: <honest>
- Next: <the single next thing>
```

**A round where nothing changed is a failed round — write that down and move on.** Do not pad the
log with activity. An honest "I could not get past X" is a better night's work than three fabricated
successes.

## 6. Handover for the morning

Leave behind:

- commits on a branch, one per Run, with messages that say what is verified and what is not
- `design/OVERNIGHT_LOG.md` — the round-by-round log
- the final screenshot(s)
- **a short `design/MORNING.md`**: what is done, what is broken, what you would do next, and
  anything you were unsure about. Write it for the person who has to trust it, because they will
  check it.

Be blunt about what is unfinished. The value of the night is the honest state of the work, not the
impression of progress.
