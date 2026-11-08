/**
 * The Reset View rule, as one handler (step 3B2-FIX1 B2).
 *
 * ## The defect this closes
 *
 * Reset used to raise only `requestReset()`, which reached `CameraDirector` and returned the camera to the
 * framed default pose with the spin resumed. The React selection in `App.tsx` was never touched, so the
 * region card and the drawer STAYED OPEN over a default-pose globe: the app was left in a state no load
 * ever produces.
 *
 * Reset now means "the load state": no region, drawer closed, idle, default direction, `d_fit`,
 * `userZoomed` false, spin running.
 *
 * ## Why both channels, and why in this order
 *
 * There are two pieces of state and one function each reache:
 *
 *   - `clearSelection` is `selectRegion(null)` — the SAME path the drawer's X and the Escape key take, so
 *     Reset cannot leave the app in a state the other close paths cannot reach (or vice versa). It is what
 *     closes the drawer, because the drawer's open/closed is a function of `activeRegion`.
 *   - `requestViewReset` is the existing `viewStore.requestReset()` intent. It is what clears
 *     `userZoomed` — `SELECT(null)` routes to the machine's CLOSE rule, which deliberately PRESERVES a
 *     user zoom (closing a region you had zoomed into keeps your distance) — and it is what starts a return
 *     when nothing was selected at all (Reset after a plain wheel, where there is no close to perform).
 *
 * `requestViewReset` is called FIRST. It dispatches `RESET` synchronously, so the machine is already in
 * `returning` with `userZoomed: false` and `regionId: null` when React re-renders and the director's
 * selection effect fires `SELECT(null)`. `SELECT(null)` in `returning` is `closeOrStay`, which returns the
 * snapshot unchanged — so the two paths cannot start competing returns, and the second one cannot undo the
 * flag the first just cleared. The reverse order still works (the effect runs after the handler returns, so
 * `RESET` would land first anyway), but it makes correctness depend on React's batching rather than on the
 * code, and it would silently start producing two `USER_ZOOM`-clearing transitions the day the machine
 * gains one.
 *
 * ## What it does NOT do
 *
 * It does not touch the camera, the machine or the store directly: it only calls the two channels the app
 * already owns. That is what keeps the single-writer guard intact — no new camera writer appears, and the
 * final pose is produced by the same `returning` animation a CLOSE uses, from a machine in the same state.
 *
 * ## Keyboard focus
 *
 * If focus is inside the drawer when it closes, the focused node is left under an `aria-hidden` off-canvas
 * panel. `ResetViewButton` owns the handoff for that (it is the only node it can legally move focus to),
 * and this module stays free of DOM so it can be unit-tested without a browser.
 */

/** The two channels Reset drives. Injected so the wiring can be tested without mounting the app. */
export interface ResetViewChannels {
    /** Clear the app's selection — `selectRegion(null)`, the drawer X / Escape path. */
    clearSelection: () => void;
    /** Raise the camera's RESET intent — `viewStore.requestReset()`. */
    requestViewReset: () => void;
}

/**
 * Apply the Reset View rule: back to the exact load state.
 *
 * Both channels fire on every call, unconditionally. Deciding "which one is needed" from the current
 * state would be a second, unreachable-from-the-outside rule: `SELECT(null)` with nothing selected is a
 * machine no-op and `RESET` from `idle` is the return animation, so calling both is always either
 * necessary or harmless, and it keeps the number of transitions independent of timing.
 */
export function resetView({
    clearSelection,
    requestViewReset,
}: ResetViewChannels): void {
    /* RESET first: see the header. It makes the machine `returning` before the selection effect can run. */
    requestViewReset();
    /* Then the selection, through the same path the other close affordances use. */
    clearSelection();
}
