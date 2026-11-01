/**
 * The Reset View control — the one new rect step 3B2 adds, and the reason `viewIsDefault` exists.
 *
 * ## Why a component and not three lines in `Header.tsx`
 *
 * It needs `useSyncExternalStore` on `scene/viewStore` (the director publishes `viewIsDefault` every
 * frame and the store drops no-change writes), and a unit test needs to drive that store without
 * mounting the header's metrics/units/export props. Keeping it separate is also what lets the header stay
 * a pure presentational component.
 *
 * ## Why `aria-disabled` AND `disabled`
 *
 * `aria-disabled` is the semantics a screen reader announces and the attribute the acceptance spec
 * asserts; `disabled` is what actually stops the click and removes it from the tab order. Both, because a
 * button that only looks disabled still fires a pointless RESET, and a button that is only `disabled`
 * has no accessible state. The button is deliberately NOT removed from the DOM when default: a control
 * that appears and disappears under the cursor is a worse affordance than one that greys out.
 *
 * ## Why `pointer-events-auto`
 *
 * The header is `pointer-events-none` (it is an overlay over a full-viewport canvas, and a HUD that
 * swallowed orbit drags would be unusable). Every interactive child re-enables pointer events for
 * itself — same construction as the unit toggle and Snapshot beside it.
 */
import { useSyncExternalStore } from 'react';
import { RotateCcw } from 'lucide-react';
import { getViewState, requestReset, subscribeViewState } from '@/scene/viewStore';

export function ResetViewButton() {
  const { viewIsDefault } = useSyncExternalStore(subscribeViewState, getViewState, getViewState);

  return (
    <button
      type="button"
      onClick={requestReset}
      disabled={viewIsDefault}
      aria-disabled={viewIsDefault}
      aria-label="Reset view"
      data-testid="reset-view"
      className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-300 backdrop-blur-md transition-all duration-300 hover:border-white/20 hover:text-slate-100 disabled:opacity-40 disabled:hover:border-white/[0.08] disabled:hover:text-slate-300"
    >
      <RotateCcw size={12} />
      <span className="hidden sm:inline">Reset view</span>
    </button>
  );
}
