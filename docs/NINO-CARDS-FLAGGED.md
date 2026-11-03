# NINO-CARDS-FLAGGED — how to turn it on, what was measured, why it sits where it sits

Step 2.3b. Base `4a2c185`, delivered commit is the one this file ships in.

Two static cards — Niño 1+2 and Niño 4 — rendered from the inert display model
(`src/lib/ninoCard.ts` → `src/lib/ninoRelation.ts`), behind a **default-OFF** flag, so that with the
flag off the app is structurally identical to `4a2c185`.

---

## Turning it on

```
http://localhost:5173/?nino=1
```

Exactly `nino=1`. Every other spelling is OFF, deliberately:

| query | cards | why |
|---|---|---|
| *(none)* | **off** | default |
| `?nino=1` | **on** | the one value |
| `?nino=0` | off | the natural way to say "off"; a presence test would have made this ON |
| `?nino=` | off | empty value |
| `?nino` | off | bare key, presence is not enough |
| `?nino=true` | off | a word, not the value |
| `?NINO=1` | off | keys are case-sensitive |
| `?dbg=1&nino=1` | **on** | composes with the existing debug flag |

`isNinoUiEnabled(search)` (`src/lib/ninoFlag.ts`) is `new URLSearchParams(search).get('nino') === '1'`.
It is read **once** at module load in `App.tsx` (`const NINO_UI = isNinoUiEnabled(location.search)`) and
once per render in `SheetBody.tsx`. It is **not persisted** — there is no `localStorage`, no
`history.pushState` and no URL sync anywhere in `src/` — and it is **not in the Snapshot**:
`buildReportHtml` (`src/lib/report.ts:52`) receives only scenario, metrics, analytics, activeRegion and
snapshot, so the flag has no path into the exported report. Nothing in the app writes or strips the
parameter, because nothing in the app writes the query string at all.

---

## The placement decision

The step required all three of: cards inside the `[data-occluder="right-panel"]` element, the globe
disc centre never inside `nino-cards`, and no horizontal overflow.

**Chosen: inside the occluder, stacked in the same 268 px column as the region cards.**

The 2.3a memo had warned the new stack must sit *outside* the occluder inset. That warning was about the
flag being ON-but-EMPTY — an empty wrapper would have widened the right inset for nothing. It does not
apply here, because with the flag OFF nothing renders at all: the mount is a ternary whose OFF branch is
the original, unwrapped `<RegionCards>`, not a wrapper with a class. The M1 fingerprint is what proves
that rather than asserting it. With the flag ON, the panel *should* move the inset, and it does:
the occluder measured **316 px wide** (268 + 2×24 padding), which is what the free rect uses.

### The defect the first measurement caught

`App.tsx:247` is a flex **row**. The first implementation appended `<NinoCards>` as a second child of
it, which put the cards *beside* the region cards, and — having no width of its own — let the section
shrink-wrap to its longest caption:

```
nino-cards rect  x=642  y=238  w=614  h=252      ← first attempt
occluder rect    x=350  y=206  w=930  h=308      ← the panel blew out to 930 px
```

The fix is one wrapper, in the ON branch only:

```jsx
{NINO_UI ? (
  <div className="flex max-h-[calc(100vh-3rem)] w-[268px] shrink-0 flex-col gap-2 overflow-y-auto">
    <RegionCards … />
    <NinoCards … layout="desktop" />
  </div>
) : (
  <RegionCards … />
)}
```

`w-[268px]` matches `RegionCards`' own `w-[268px]`, so both stacks share one column; `flex-col` turns
the row into a stack; `max-h` + `overflow-y-auto` let the panel scroll when two more cards outgrow a
720 px viewport, which the step permits ("the desktop right panel may scroll"). Those two classes sit on
the wrapper rather than on the panel itself precisely so the OFF branch stays untouched.

Measured after the fix: **268 px wide, inside the occluder, no overflow.**

---

## M1 — flag-OFF identity

Method: a `git worktree` at `4a2c185` under `_triage/wt-4a2c185`, `pnpm install --offline
--frozen-lockfile --ignore-scripts` (432 packages reused from the store), both trees built, both served
by the repo's own Brotli server (`tests/e2e/brotli-server.mjs`) on separate ports, Chromium with the
same SwiftShader flags `playwright.config.ts:60-61` uses.

Fingerprint = ordered list of `tag|role|data-testid|class` for every element in `<body>`, excluding text,
`style` attributes, `script`/`style`/`link`/`meta`, and canvas internals; class kept as a **sorted** token
list so a harmless reorder is not a difference while an added class is.

| viewport | A/A control (ref vs ref) | A/B (ref vs flag-OFF) | elements | difference |
|---|---|---|---|---|
| 1280×720 | **identical**, 283/283 | **identical**, 283/283 | 283 | none |
| 390×844 | **identical**, 199/199 | **identical**, 199/199 | 199 | none |
| 1032×1376 | **identical**, 199/199 | **identical**, 199/199 | 199 | none |

`nino-cards` appears in the flag-OFF DOM: **no**, at every viewport.

### Why an A/A control was necessary

The first three attempts reported a 1280×720 difference that was **not** this change:

1. `span … bg-sky-400 … w-1/3` versus the same span without them — a loading placeholder mid-pulse;
2. `EngineBadge.tsx:204` (`gap-2`) versus `:255` (`gap-1.5`) — the badge's *loading* shape versus its
   *ready* shape, 289 elements versus 297.

The engine badge renders a different DOM per phase and the phase depends on whether DuckDB actually
loads from the network, so two pages routinely land in different phases. The final run proves the point
directly: at 1280×720 the reference page reported
`"DuckDB engine ready, served from jsdelivr, 2073 milliseconds."` while the working page reported
`"Loading the DuckDB engine."` — **different phases, identical fingerprint.**

Two things make that measurement honest rather than convenient:

- the fingerprint **collapses the badge subtree to one token** (`div|engine-badge|(collapsed)`), keeping
  its position in the ordered list so a sibling inserted before it is still caught, and ignoring which
  phase it is in; the phase is reported separately so it is visible, not hidden;
- the **A/A control** establishes the noise floor: the same commit against itself, also identical.

---

## M2 — flag ON (`?nino=1`)

| | 1280×720 | 390×844 | 1032×1376 |
|---|---|---|---|
| `nino-cards` rect | x988 y350 **w268 h297** | x16 y980 w358 h272 | x212 y1189 w608 h260 |
| `nino-card-nino12` | x988 y370 w268 h134 | x16 y1001 w358 h122 | x212 y1210 w608 h122 |
| `nino-card-nino4` | x988 y513 w268 h134 | x16 y1131 w358 h122 | x212 y1340 w608 h109 |
| inside `data-occluder="right-panel"` | **yes** | n/a (mobile has no occluder) | n/a |
| occluder rect | x964 y49 **w316 h621** | — | — |
| `scrollWidth` / `clientWidth` | 1280 / 1280 | 390 / 390 | 1032 / 1032 |
| horizontal overflow | **no** | **no** | **no** |
| right panel scrolls | no (621 / 621) | — | — |
| `elementFromPoint` at disc centre | **`canvas`**, not inside `nino-cards` | `canvas` | `canvas` |
| `4 active` text | **"4 active"** — unchanged | — | — |
| four region cards | present, text unchanged | present | present |
| extrapolation note @1.5 / @3.0 | **absent / present** | absent / present | absent / present |
| °F toggle changes the texts | **yes** — `+5.8°F`, `+4.0 to +7.6 °F` | UNMEASURED | UNMEASURED |
| console errors / pageerrors | **0 / 0** | 0 / 0 | 0 / 0 |

Screenshots: `_triage/nino-cards-1280x720.png`, `nino-cards-390x844.png`, `nino-cards-1032x1376.png`.

**Mobile was never broken.** The first M2 run measured `ninoRect: null` at both mobile viewports because
the append sits inside the `showControls` section (`SheetBody.tsx:80`, `surface !== 'peek'`) and the sheet
boots at **peek**. The mount is a pure append and is correct; the *measurement* needed the sheet expanded.
The driver now expands it through the app's own `role="slider"` named "Sheet position" + ArrowUp
(`mobile-sheet.spec.ts:564`), no synthetic touch and no dependence on the instrumented `__mobileSheet`
probe.

**UNMEASURED:** the °F toggle at the two mobile viewports — the header's `°F` button is not reachable by
role at those sizes inside the 30 s budget. The toggle is proven at 1280×720 and by unit test.

---

## M3 — locked 15-spec batch

**NOT RUN.** The batched runner is `node scripts/e2e-batched.mjs` (`docs/STEP3-STATUS.md:857`;
`docs/E2E.md:334`), one Playwright process per spec file, no retries. It was not run in this step, and no
result is claimed for it.

What is known without running it, from the 2.3a recon: no locked spec imports `ninoCard`, `ninoRelation`
or `ninoFlag`; the new code is reachable only through `App.tsx` and `SheetBody.tsx` and only when the
flag is ON; and every locked spec loads the app **without** `?nino=1`, so none of them can see the cards.
The flag-OFF identity above is the same claim measured structurally at three viewports.

---

## Bundle

| | bytes |
|---|---|
| before (`4a2c185`) | 1,399,259 |
| after | **1,403,567** |
| delta | **+4,308** |

Expected and not a regression: in the previous two steps the new modules were inert and tree-shaken away,
so the total did not move at all. This step gives `ninoCard.ts` and `ninoRelation.ts` their first real
importer, so both now ship. The +4,308 B is the two cards' component code plus the relation module's
constants.

---

## Test tooling note

`@testing-library/react` **is** installed (16.3.3, with `@testing-library/dom` 10.4.2 and `jsdom` 25.0.1),
contrary to what the step anticipated. `NinoCards.test.tsx` uses `renderToStaticMarkup` anyway: the
component is a pure function of its props — no state, no effects, no handlers, no refs — so rendering to
a string proves exactly the markup the browser receives, and it lets the "nothing interactive" rule be
checked on the raw string. **No dependency was added.**
