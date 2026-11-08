/**
 * The mobile shell: the compact header, and then either the portrait sheet or the landscape dock.
 *
 * ## Why this is a separate component rather than a branch inside `App`
 *
 * `App` is the only place that holds `activeRegion`, `focusNonce`, `scenario` and `units`, so it has to own the
 * STATE. It should not also own two layouts' worth of markup: the desktop overlays and the mobile shell are
 * mutually exclusive trees, and keeping the mobile one in its own file means `git blame` on `App.tsx` for the
 * desktop layout stays readable, and means the whole mobile surface is one directory.
 *
 * ## What MOBILE2 changed here
 *
 *   - MOBILE1's `sr-only` h1, floating island and separate Reset cluster are GONE. `HeaderCompact` owns the
 *     heading, the ENSO chip and every control, so there is exactly one Reset View, one unit toggle and one
 *     Snapshot in the DOM per mode, and the two rotate-ccw icons in the top right (one resetting the scenario,
 *     one the view) are one control.
 *   - The shell now DISPATCHES on the mode: `portrait` gets `SnapSheet`, `phoneLandscape` gets `LandscapeDock`.
 *     Both read the same `SheetBody`, so the region switcher is one path.
 *   - Entering portrait RESETS the sheet to peek. The prompt's rule is "the sheet tier resets to peek on every
 *     portrait entry", and portrait is reachable from landscape by rotation, so the trigger is a transition in
 *     the mode rather than a mount: a component that unmounts already lands at peek, but a rotation that keeps
 *     the shell mounted would otherwise carry the old tier across.
 *
 * The drawer, the cards and the control deck stay desktop-only; that gate is in `App.tsx` and is not this file's
 * business.
 */

import { useEffect, useRef, useState } from "react";
import type {
    AnalyticsPayload,
    RegionDefinition,
    RegionId,
    ScenarioMetrics,
    ScenarioState,
    TelemetryBundle,
    UnitSystem,
} from "@/types/enso";
import { HeaderCompact } from "@/mobile/HeaderCompact";
import { LandscapeDock } from "@/mobile/LandscapeDock";
import { SnapSheet, type SnapSheetHandle } from "@/mobile/SnapSheet";
import type { Tier } from "@/mobile/snapMath";
import type { LayoutMode2 } from "@/mobile/layoutMath";
import { NINO_BOXES } from "@/lib/regions";
import { isNinoUiEnabled } from "@/lib/ninoFlag";

/**
 * The `?nino=1` flag, read once at module load.
 *
 * The same expression `App.tsx:27` uses, and deliberately duplicated rather than shared: `App`'s
 * `NINO_UI` is a module-local const, not an export, and lifting it into the lib would edit a shared
 * file for a boolean. The value cannot change without a reload, so a second module-scope read is the
 * same fact, and it keeps `MobileShell`'s hook list identical whichever way the flag points.
 */
const NINO_UI = isNinoUiEnabled(
    typeof location === "undefined" ? "" : location.search,
);

interface MobileShellProps {
    /** The three-way mode, from the store. `desktop` is never passed: `App` does not mount this shell there. */
    mode: LayoutMode2;
    /** Layout viewport, so the dock can be exactly `dockWidth(w)` wide. */
    viewportW: number;
    /** The compact header's published bottom edge. */
    headerBottom: number;
    scenario: ScenarioState;
    metrics: ScenarioMetrics;
    analytics: AnalyticsPayload;
    region: RegionDefinition | null;
    activeRegion: RegionId | null;
    units: UnitSystem;
    exporting: boolean;
    onToggleUnits: () => void;
    /** Download the composed 1920×1080 PNG snapshot. */
    onExportPng: () => void;
    /** Open the HTML diagnostic report in a new tab. */
    onExportReport: () => void;
    onSelect: (id: RegionId | null) => void;
    onClearSelection: () => void;
    onScenarioChange: (patch: Partial<ScenarioState>) => void;
    /** The Niño box last flown to, so the sheet can collapse and the card can show selection. */
    activeNinoBox: string | null;
    /** The "Show on globe" trigger, forwarded to the cards inside the sheet. */
    onShowOnGlobe: (boxId: string) => void;
    /** Live telemetry, forwarded to the sheet and dock bodies. */
    telemetry?: TelemetryBundle | null;
}

export function MobileShell({
    mode,
    viewportW,
    headerBottom,
    scenario,
    metrics,
    analytics,
    region,
    activeRegion,
    units,
    exporting,
    onToggleUnits,
    onExportPng,
    onExportReport,
    onSelect,
    onClearSelection,
    onScenarioChange,
    activeNinoBox,
    onShowOnGlobe,
    telemetry,
}: MobileShellProps) {
    const sheetRef = useRef<SnapSheetHandle>(null);
    /** The sheet's current tier, mirrored here so the header can hide the chip at full. */
    const [sheetTier, setSheetTier] = useState<Tier>("peek");

    /*
     * The tier reset on portrait entry.
     *
     * `wasPortrait` starts false, so the FIRST entry (which is the mount on a phone held upright) resets too — the
     * sheet mounts at peek anyway, so that costs nothing and keeps the rule unconditional. A rotation out and back
     * resets again, which is the case the prompt names.
     */
    const wasPortrait = useRef(false);
    useEffect(() => {
        const isPortrait = mode === "portrait";
        if (isPortrait && !wasPortrait.current) sheetRef.current?.resetTier();
        wasPortrait.current = isPortrait;
    }, [mode]);

    /**
     * When a Niño box is flown to, collapse the sheet to peek.
     *
     * NINO-HARDEN B6(c): this now says phone AND TABLET, because that is what it does. The original
     * comment claimed "on a PHONE" while the effect below is gated on `activeNinoBox` alone — it fires at
     * 1032x1376 too, and A7 measured the tablet collapse as real (`tier` Peek after a press at both
     * 390x844 and 1032x1376). Either the comment or the behaviour was wrong; the behaviour is right
     * (a tablet Full sheet hides the globe exactly as a phone one does), so the comment is corrected.
     *
     * The step requires the globe to be visible after the button is pressed, and the button lives inside
     * the sheet — so leaving the sheet at the tier the user pressed from would hide the very thing the
     * press was for. Checked what a REGION selection does: it does not touch the tier at all (the mobile
     * region switcher just calls `onSelect`), so there is no existing behaviour to mirror here and the
     * collapse has to be explicit. `resetTier()` is the sheet's own handle — the same one the portrait
     * rotation rule uses — so this adds no new mechanism.
     */
    const wasNinoBox = useRef<string | null>(null);
    useEffect(() => {
        if (activeNinoBox && activeNinoBox !== wasNinoBox.current) {
            sheetRef.current?.resetTier();
            /*
             * NINO-HARDEN B6(b): move focus to the slider handle after the collapse.
             *
             * The card the user just pressed is inside the sheet body, and the body UNMOUNTS at Peek — so
             * focus fell to `BODY` and a keyboard or screen-reader user lost their place entirely. A7 measured
             * `activeElement` as BODY at both 390x844 and 1032x1376, with zero `aria-pressed="true"` nodes
             * surviving. The handle (`SnapSheet.tsx:297-303`, `role="slider"`, `tabIndex=0`) is the nearest
             * control that survives the collapse and it is what moves the sheet back, so it is the honest
             * destination rather than an arbitrary one.
             *
             * Deferred one frame: `resetTier()` animates and the sheet body is still mounted in this task, so
             * focusing synchronously would land on an element that is about to be removed.
             */
            requestAnimationFrame(() => {
                const handle = document.querySelector<HTMLElement>(
                    '[role="slider"][aria-label="Sheet position"]',
                );
                handle?.focus();
            });
        }
        wasNinoBox.current = activeNinoBox;
    }, [activeNinoBox]);

    /*
     * NINO-HARDEN B6(a): the flight announcement lives HERE, at shell level, not in the sheet body.
     *
     * The body unmounts at Peek — which is exactly the tier a box press collapses to — so an
     * `aria-live` node inside it is removed in the same frame its text would have been announced, and the
     * announcement is lost. Mounted on the shell it survives every tier, every mode change and every
     * sheet unmount, which is the only way the message is reliably spoken.
     *
     * The label comes from `NINO_BOXES.anchorLat`-bearing registry entries rather than a second hardcoded
     * table: `NINO_BOXES` already carries each box's display `label` ('NIÑO 1+2', 'NIÑO 4', 'NIÑO 3.4'),
     * so the announcement cannot drift from the card.
     *
     * The node is `aria-live="polite"` and visually hidden rather than `display:none` or `aria-hidden`:
     * a hidden node is not announced. Flag-ON only — the JSX below does not render the node at all when
     * `NINO_UI` is false, because M1 caught it adding one element to the flag-off DOM.
     */
    const announcedBox = activeNinoBox
        ? NINO_BOXES.find((b) => b.id === activeNinoBox)
        : undefined;
    const ninoAnnouncement = announcedBox
        ? `Showing ${announcedBox.label} on the globe`
        : "";

    return (
        <>
            {/*
        NINO-HARDEN B6(a): the persistent announcement node. FLAG-ON ONLY.

        Mounted FIRST in the shell and OUTSIDE every tier conditional, so it exists in every mode,
        every sheet tier and every sheet-body unmount — the property the brief asks for ("mounted
        persistently at shell level, flag-on only, NOT inside the sheet body").

        The `NINO_UI` gate is not decoration. The first version rendered this unconditionally and M1
        caught it: the flag-off fingerprint at 390x844 and 1032x1376 read 200/199 elements with
        firstDiff `DIV|status|nino-live|` against `HEADER|...|` — one extra node in the flag-on tree. A
        `role="status"` region is part of the accessibility tree whether or not it has text, so it is a
        real DOM difference, not a cosmetic one. Flag off must be byte-identical, so the node does not
        exist there at all.

        `sr-only`-style clipping rather than `hidden`/`display:none`: those remove the node from the
        accessibility tree and it would never be spoken.
      */}
            {NINO_UI ? (
                <div
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    data-testid="nino-live"
                    style={{
                        position: "absolute",
                        width: 1,
                        height: 1,
                        padding: 0,
                        margin: -1,
                        overflow: "hidden",
                        clip: "rect(0, 0, 0, 0)",
                        whiteSpace: "nowrap",
                        border: 0,
                    }}
                >
                    {ninoAnnouncement}
                </div>
            ) : null}

            <HeaderCompact
                mode={mode}
                viewportW={viewportW}
                anomalyC={scenario.sstAnomaly}
                units={units}
                onToggleUnits={onToggleUnits}
                onExportPng={onExportPng}
                onExportReport={onExportReport}
                exporting={exporting}
                onClearSelection={onClearSelection}
                onSstChange={(value) => onScenarioChange({ sstAnomaly: value })}
                hideChip={mode === "portrait" && sheetTier === "full"}
            />

            {mode === "portrait" ? (
                <SnapSheet
                    ref={sheetRef}
                    metrics={metrics}
                    analytics={analytics}
                    scenarioSst={scenario.sstAnomaly}
                    region={region}
                    units={units}
                    activeRegion={activeRegion}
                    onSelect={(id) => onSelect(id)}
                    activeNinoBox={activeNinoBox}
                    onShowOnGlobe={onShowOnGlobe}
                    onClearSelection={onClearSelection}
                    onSstChange={(value) =>
                        onScenarioChange({ sstAnomaly: value })
                    }
                    onChangeScenario={(patch) => onScenarioChange(patch)}
                    telemetry={telemetry}
                    onTierChange={setSheetTier}
                />
            ) : null}

            {mode === "phoneLandscape" ? (
                <LandscapeDock
                    viewportW={viewportW}
                    headerBottom={headerBottom}
                    metrics={metrics}
                    analytics={analytics}
                    scenarioSst={scenario.sstAnomaly}
                    region={region}
                    units={units}
                    activeRegion={activeRegion}
                    onSelect={(id) => onSelect(id)}
                    activeNinoBox={activeNinoBox}
                    onShowOnGlobe={onShowOnGlobe}
                    onClearSelection={onClearSelection}
                    onSstChange={(value) =>
                        onScenarioChange({ sstAnomaly: value })
                    }
                    onChangeScenario={(patch) => onScenarioChange(patch)}
                    telemetry={telemetry}
                />
            ) : null}
        </>
    );
}
