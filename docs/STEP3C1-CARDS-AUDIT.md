# Step C (cards-ux) — C1 audit, and the C2 STOP

Step 3B2-FIX1 v1, step C. Commits before this one: `2a76c2e` (P0), `9d6bbaf` (A), `aad1338` (B).
**Step C stopped at C2. No product code, no spec, no threshold and no layout rect was changed.**

## The defect as reported

> with the drawer open, mouse clicks on the cards do not reach them (elementFromPoint returns a drawer node;
> keyboard works).

Reproduced and explained. The keyboard path works because it is a real `<button>`; the mouse path fails for a
reason that is not a z-order or `pointer-events` bug.

## C1 — the measurement

Method: `.cache/c1/` (throwaway probe, removed from `tests/e2e/` afterwards so the runner's spec enumeration
is unchanged). Open `Western US & California` through the card's keyboard path at 1440x900 (so the drawer is
open with no ambiguity), then for **every card centre** record the full `document.elementsFromPoint` stack
with each node's `z-index`, `pointer-events`, `position` and `background-color`. Raw output:
`.cache/c1/run.log`; screenshot `.cache/c1/drawer-open-1440x900.png`.

### Geometry

| element | rect (x, y, w, h) | z | pointer-events |
|---|---|---|---|
| drawer wrapper (`[data-occluder="right-drawer"]`) | **1022, 0, 418, 900** | 30 | **none** |
| drawer panel (`.glass`, its first child) | **1038, 76, 386, 808** | auto | auto |
| Impact Zones panel (`[data-occluder="right-panel"]`) | 1148 … 1416 (card column) | 20 | none (wrapper) |
| card 1 — Equatorial Pacific | 1148, 328, 268, 84 — centre **(1282, 369)** | auto | auto |
| card 2 — Western US | 1148, 419, 268, 53 — centre **(1282, 446)** | auto | auto |
| card 3 — SE Asia | 1148, 480, 268, 53 — centre **(1282, 507)** | auto | auto |
| card 4 — Horn of Africa | 1148, 542, 268, 53 — centre **(1282, 569)** | auto | auto |

So the reported "the drawer is a 418 px z-30 panel over a z-20 card list" is true as a description of the
WRAPPER, and the wrapper is `pointer-events: none`. The panel inside it is `pointer-events: auto`.

### The stack at each card centre

All four centres are inside x 1148–1416, which the panel covers (1038–1424). At every one of the four
centres, `elementsFromPoint` returns, top to bottom:

| # | node | background | `pointer-events` |
|---|---|---|---|
| 0 | an **inner `<div>`/`<p>` of the drawer's content** (e.g. `.mb-1.5 flex …`, `text-[10.5px] leading-relaxed`) | `rgba(0,0,0,0)` | auto |
| 1 | `.rounded-xl border border-white/[0.06] bg-white/[0.018] p-3` (a drawer content card) | `rgba(255,255,255,0.02)` | auto |
| 2 | `.space-y-4` | `rgba(0,0,0,0)` | auto |
| 3 | `.scroll-thin flex-1 overflow-y-auto overscroll-contain px-4 …` | `rgba(0,0,0,0)` | auto |
| 4 | `.glass pointer-events-auto flex h-full flex-col overflow-hidden rounded-2xl` | `rgba(0,0,0,0)` — the paint is the CSS `background` gradient | auto |
| 5+ | the card itself and its descendants | — | auto |

`.glass` (`src/index.css:87-96`) is
`linear-gradient(160deg, rgba(19,29,48,0.86) 0%, rgba(9,14,26,0.9) 100%)` — **86–90 % opaque**, with a
`0 24px 70px -24px rgba(0,0,0,0.92)` shadow and `backdrop-filter: blur(18px)`.

Independently confirmed by the screenshot: the Impact Zones list is **not visible at all** with the drawer
open. The panel covers it with a dark, near-opaque surface (the starfield is faintly visible through 10-14 %
of it).

## Verdict on C2's own question

> Report whether the cards are visually covered by an opaque panel or only blocked by a transparent
> wrapper/overlay.

**Visually covered by a near-opaque panel.** Not a transparent wrapper, not a z-order problem, and not an
over-sized wrapper: the wrapper is already `pointer-events: none`, the panel is 386 px wide inside a 418 px
wrapper, and the cards are 268 px wide at x 1148–1416 — entirely behind an 86–90 % opaque surface with an
18 px backdrop blur.

## Why this is a STOP and not a fix

C2's rule is explicit:

> If the cards are visually covered by the drawer panel, or any fix would change a layout rect, STOP and
> report options (do not choose).

Both halves apply:

1. the cards are visually covered, so a `pointer-events` or stacking change would make a click land on a
   control the user **cannot see** — the accessibility failure mode this step exists to remove, inverted; and
2. the drawer's rect is one of the 15 layout rects S7/U10 pins (its width sets the right inset, 316 → 418),
   so `d_contain`, `d_fit` and every framing measurement downstream of it would move.

No options are chosen. The three that exist are named in the report so the author can decide; none was
implemented and no code path was left half-changed.

## What stays green

Nothing in step C was committed. The gate is unchanged from `aad1338` (900 unit tests / 40 files, lint,
build). `reset-ux.spec.ts` (11/11) and the S1 reference frame (residual 0, sha `934ecd13…`) were measured on
that commit and are unaffected by this audit, which touched only throwaway files under `.cache/`.
