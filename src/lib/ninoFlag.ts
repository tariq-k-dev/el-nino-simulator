/**
 * The `?nino=1` UI flag.
 *
 * ## Why a query-string flag and what it is not
 *
 * This is the mechanism the app already uses for UI-only switches: `?debug` is read with
 * `new URLSearchParams(window.location.search).has('debug')` (`src/main.tsx:23`,
 * `src/scene/GlobeScene.tsx:257`), and `?framing` with `.get('framing') === 'live'`
 * (`src/layout/framing.ts:86`). Nothing is persisted: there is no localStorage, no
 * `history.pushState`, and no URL sync anywhere in `src/` — so a flag read from the
 * address bar cannot leak into saved state, and nothing in the app ever writes it back.
 * It is also not part of the Snapshot: `buildReportHtml` (`src/lib/report.ts:52`) receives
 * only scenario, metrics, analytics, activeRegion and snapshot, so the flag has no path
 * into the exported report.
 *
 * ## Why `.get() === '1'` rather than `.has()`
 *
 * `?debug` is a presence flag because there is only one meaningful value. Here an explicit
 * value is worth the extra strictness: `?nino=0` is the natural way to say "off", and a
 * presence test would turn that into ON. Requiring exactly `'1'` means every other
 * spelling — `0`, empty, `true`, `yes`, `NINO=1` — stays OFF, which is the safe default
 * for a flag that changes what is on screen.
 *
 * ## Why this is a function and not a module constant
 *
 * The mount decides the flag ONCE (see `App.tsx` and `SheetBody.tsx`), which keeps the
 * value stable for the life of the page and preserves the existing hook order. Making the
 * predicate pure and parameterised is what lets it be unit-tested against a table of
 * strings without a DOM, and it keeps the single `window.location` read at the call site
 * where it is visible.
 */

/** The exact value that turns the Niño cards on. Anything else is off. */
export const NINO_FLAG_VALUE = '1';

/** The query key. Deliberately not added to any `URLSearchParams` writer, because there is none. */
export const NINO_FLAG_KEY = 'nino';

/**
 * True only when the query string carries `nino=1` exactly.
 *
 * `search` may be `''`, `'?nino=1'`, or a full query with other params; a leading `?` is
 * optional because `URLSearchParams` strips it.
 */
export function isNinoUiEnabled(search: string): boolean {
  return new URLSearchParams(search).get(NINO_FLAG_KEY) === NINO_FLAG_VALUE;
}
