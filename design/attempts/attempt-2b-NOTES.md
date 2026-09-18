# attempt-2b — what one loop round actually fixed

Same file as attempt-2, but this time the loop was run: render → **measure** → name a defect → fix
→ measure again. Numbers, not opinions.

**Round 1 — defect named:** damage my own edit had caused. A collision-avoidance pass was added to
stop labels stacking in the dense districts, and while editing the loop I dropped the line that
creates the label element. The whole block threw, so **all ten incident labels silently
disappeared**.

Measured after the fix:

```
hud=10  overlap=1  offscreen=1  botsH=280
路面快拍=6行 | 供水事故=9行 | 急症室輪候=18行 | 空氣質素=6行
```

**The important part is how the defect was missed and then caught.** A vision model reviewing the
screenshot of the broken build reported that the labels "are now separated and readable" — it
described labels that no longer existed, and it invented UI elements that were never in the file.
Vision is a prompt, not a verdict. `hud=10` is the verdict.

## Three things fixed this round

1. label collision — a walk down the markers pushes any label that would clash with one already
   placed on the same side
2. panel widths — the camera panel now shows a 3-wide grid and the columns were rebalanced, so the
   previously empty right-hand space is used
3. the market panel is no longer permanent — a reviewer called it off-topic for a city monitor, so
   the permanent slot went to 空氣質素 (AQHI), which a resident actually acts on. Market data is
   real and was requested, so it moves behind a 市場 category instead of being deleted.

## Still open at the end of this round

`overlap=1` — one label pair still collides. That is the next round, not a finished state.
