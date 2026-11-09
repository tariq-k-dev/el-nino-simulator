/**
 * The Reset View control, and the reason `viewIsDefault` exists.
 *
 * ## Why a component and not three lines in `Header.tsx`
 *
 * It needs `useSyncExternalStore` on `scene/viewStore` (the director publishes the view state every frame
 * and the store drops no-change writes), and a unit test needs to drive that store without mounting the
 * header's metrics/units/export props. Keeping it separate is also what lets the header stay a purely
 * presentational component.
 *
 * ## Reset means "the load state"
 *
 * Reset must return the CAMERA to the framed default pose AND clear `activeRegion`, so the region card
 * and the drawer do not stay open over a default-pose globe — a state the app never loads into. It
 * therefore calls `scene/resetView.ts`'s `resetView()`, which drives BOTH channels: the camera's RESET
 * intent and `selectRegion(null)`, the same selection clearer the drawer's X and the Escape key use.
 *
 * ## Enabled whenever a region is open, even if the camera looks default
 *
 * `viewIsDefault` alone is a question about the POSE. With a region open the camera can be exactly at the
 * default pose (gaze on the pin's normal is not implied by any pose, but the distance and direction
 * channels can both be at their defaults after a Reset that never closed the drawer), and the button
 * would disable itself in the one state where it has work to do. An open region is by itself a reason to
 * be able to Reset: `hasRegion` from `viewStore` (published by `GlobeScene` from the `activeRegion` prop)
 * is OR-ed into the disabled test, so the control is only ever disabled when the app is genuinely at its
 * load state.
 *
 * ## Keyboard focus
 *
 * If focus is INSIDE the drawer when Reset closes it, the focused node ends up in an `aria-hidden`,
 * off-canvas panel — the element is not removed from the DOM, but it is no longer perceivable, and a
 * keyboard user is then tabbing through a hidden region. The drawer itself cannot fix this (the panel is
 * what is closing, and moving focus outward from inside a closing panel is the same trap). The button that
 * caused the close is the correct destination: it is a stable, visible control, and this is where the click
 * or keypress came from. `document.activeElement.closest('[data-occluder="right-drawer"]')` is the test,
 * so focus is only moved when it was actually in the drawer.
 *
 * ## Why `aria-disabled` AND `disabled`
 *
 * `aria-disabled` is the semantics a screen reader announces and the attribute the acceptance spec asserts;
 * `disabled` is what actually stops the click and removes it from the tab order. Both, because a button
 * that only looks disabled still fires a pointless RESET, and a button that is only `disabled` has no
 * accessible state. The button is deliberately NOT removed from the DOM when default: a control that
 * appears and disappears under the cursor is a worse affordance than one that greys out.
 *
 * ## Why `pointer-events-auto`
 *
 * The header is `pointer-events-none` (it is an overlay over a full-viewport canvas, and a HUD that
 * swallowed orbit drags would be unusable). Every interactive child re-enables pointer events for itself —
 * same construction as the unit toggle and Snapshot beside it.
 */
import { useCallback, useRef, useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import {
    getViewState,
    publishHasRegion,
    requestReset,
    subscribeViewState,
} from "@/scene/viewStore";
import { resetView } from "@/scene/resetView";

interface ResetViewButtonProps {
    /** The selection clearer — `App.tsx`'s `selectRegion`, i.e. the drawer X / Escape path. */
    onClearSelection: () => void;
}

export function ResetViewButton({ onClearSelection }: ResetViewButtonProps) {
    const { viewIsDefault, hasRegion } = useSyncExternalStore(
        subscribeViewState,
        getViewState,
        getViewState,
    );
    const buttonRef = useRef<HTMLButtonElement>(null);

    const disabled = viewIsDefault && !hasRegion;

    const onClick = useCallback(() => {
        /*
         * Capture whether focus is inside the drawer BEFORE closing it: after `resetView()` the panel is
         * `aria-hidden` and off-canvas, so the check would still pass but the intent would be harder to read.
         */
        const active = document.activeElement;
        const focusWasInDrawer = Boolean(
            active &&
            active instanceof Element &&
            active.closest('[data-occluder="right-drawer"]'),
        );

        resetView({
            clearSelection: onClearSelection,
            requestViewReset: requestReset,
        });

        if (focusWasInDrawer) buttonRef.current?.focus();
        /* The selection is now cleared by construction, so the published region flag must follow at once. */
        publishHasRegion(false);
    }, [onClearSelection]);

    return (
        <button
            ref={buttonRef}
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-disabled={disabled}
            aria-label="Reset view"
            data-testid="reset-view"
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-300 backdrop-blur-md transition-all duration-300 hover:border-white/20 hover:text-slate-100 disabled:opacity-40 disabled:hover:border-white/[0.08] disabled:hover:text-slate-300"
        >
            <RotateCcw size={12} />
            <span className="hidden sm:inline">Reset view</span>
        </button>
    );
}
