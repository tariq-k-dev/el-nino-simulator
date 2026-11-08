/**
 * The landscape dock — the right-hand panel a phone gets when it is turned on its side.
 *
 * ## Why a dock and not the sheet
 *
 * In landscape the scarce dimension is HEIGHT (390 px on an 844x390 phone), so a bottom sheet that can cover 88 %
 * of it destroys the globe it is describing, and a three-tier gesture has nowhere to travel. A fixed dock that
 * takes a fraction of the WIDTH keeps a full-height globe visible, which is the shape the prompt asks for.
 *
 * ## Where it starts, and why
 *
 * `top` is the compact header's own bottom edge, published by the header's ResizeObserver — the same number the
 * camera's free rectangle starts below. Reading it from the store rather than re-measuring means the dock edge and
 * the globe's band can never disagree by a pixel, which is the kind of defect that shows up only as a pin that
 * looks half-covered.
 *
 * Subtracting the safe-area insets is NOT needed on the right: `viewport-fit=cover` plus a landscape notch puts
 * the inset on the left on one orientation and the right on the other, so `env(safe-area-inset-right)` is added
 * to the dock's own padding rather than to its width — the width must stay exactly `dockWidth(w)` so the camera's
 * free rect (which is computed from that number) matches the DOM.
 *
 * ## No tiers, native scroll
 *
 * The dock has no drag handle and no snap points: its whole height is visible, so a tier would be a gesture with
 * no purpose. Its body scrolls natively with `touch-action: pan-y` and `overscroll-behavior: contain`, so a flick
 * that reaches the end does not scroll the PAGE (which on a phone is a pull-to-refresh).
 *
 * ## It is outside the R3F event source
 *
 * A sibling of `#globe-canvas`, like the sheet, so a tap on it never reaches `onPointerMissed` and never clears
 * the region selection.
 */

import type {
    AnalyticsPayload,
    RegionDefinition,
    RegionId,
    ScenarioMetrics,
    ScenarioState,
    TelemetryBundle,
    UnitSystem,
} from "@/types/enso";
import { dockWidth } from "@/mobile/layoutMath";
import { SheetBody } from "@/mobile/SheetBody";

interface LandscapeDockProps {
    /** Layout-viewport width, so the dock can be exactly `dockWidth(w)` wide. */
    viewportW: number;
    /** The compact header's published bottom edge. The dock starts there. */
    headerBottom: number;
    metrics: ScenarioMetrics;
    analytics: AnalyticsPayload;
    scenarioSst: number;
    region: RegionDefinition | null;
    units: UnitSystem;
    activeRegion: RegionId | null;
    onSelect: (id: RegionId) => void;
    onClearSelection: () => void;
    onSstChange: (value: number) => void;
    onChangeScenario: (
        patch: Pick<
            Partial<ScenarioState>,
            "jetStreamShift" | "agricultureWeight"
        >,
    ) => void;
    /** The Niño box last flown to (C2.1), forwarded to the cards for `aria-pressed`. */
    activeNinoBox: string | null;
    /** The "Show on globe" trigger. The ONLY way a Niño box is flown to. */
    onShowOnGlobe: (boxId: string) => void;
    /** Live telemetry, forwarded to the shared body. */
    telemetry?: TelemetryBundle | null;
}

export function LandscapeDock({
    viewportW,
    headerBottom,
    metrics,
    analytics,
    scenarioSst,
    region,
    units,
    activeRegion,
    onSelect,
    onClearSelection,
    onSstChange,
    onChangeScenario,
    activeNinoBox,
    onShowOnGlobe,
    telemetry,
}: LandscapeDockProps) {
    const width = dockWidth(viewportW);

    return (
        <aside
            data-landscape-dock=""
            aria-label="Impact analysis"
            className="fixed right-0 z-30 flex flex-col border-l border-white/[0.08] bg-slate-950/90"
            style={{
                width: `${width}px`,
                top: `${headerBottom}px`,
                bottom: 0,
                paddingRight: "env(safe-area-inset-right)",
                boxShadow: "-8px 0 40px -12px rgba(0,0,0,0.9)",
            }}
        >
            {/*
        The title row. It WRAPS rather than truncating, for the same reason the sheet's does: `GLOBAL ENSO STATE`
        is the whole label and an ellipsis in a 250 px column would hide the subject of every number under it.
      */}
            <div className="shrink-0 border-b border-white/[0.06] px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span
                        data-testid="dock-title"
                        className="min-w-0 break-words font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400"
                    >
                        {region ? region.name : "Global ENSO state"}
                    </span>
                </div>
            </div>

            {/*
        The scroll container. `touch-action: pan-y` lets the browser own vertical scroll while a horizontal drag
        still reaches nothing in here; `overscroll-behavior: contain` keeps the bounce local.
      */}
            <div
                data-dock-scroll=""
                className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-[env(safe-area-inset-bottom)] pt-2"
                style={{ touchAction: "pan-y", overscrollBehavior: "contain" }}
            >
                <SheetBody
                    surface="dock"
                    metrics={metrics}
                    analytics={analytics}
                    scenarioSst={scenarioSst}
                    region={region}
                    units={units}
                    activeRegion={activeRegion}
                    onSelect={onSelect}
                    onClearSelection={onClearSelection}
                    onSstChange={onSstChange}
                    onChangeScenario={onChangeScenario}
                    activeNinoBox={activeNinoBox}
                    onShowOnGlobe={onShowOnGlobe}
                    telemetry={telemetry}
                />
            </div>
        </aside>
    );
}
