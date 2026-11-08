import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { GlobeScene } from "@/scene/GlobeScene";
import { MobileShell } from "@/mobile/MobileShell";
import {
    getLayoutSignal,
    startLayoutObserver,
    subscribeLayout,
} from "@/scene/viewStore";
import { isMobileMode } from "@/mobile/layoutMath";
import { Header } from "@/components/Header";
import { ControlDeck } from "@/components/ControlDeck";
import { RegionDrawer } from "@/components/RegionDrawer";
import { RegionCards } from "@/components/RegionCards";
import { NinoCards } from "@/components/NinoCards";
import { useScenario } from "@/state/useScenario";
import { REGION_MAP } from "@/lib/regions";
import {
    buildReportHtml,
    captureCanvas,
    downloadPng,
    openReport,
} from "@/lib/report";
import { isNinoUiEnabled } from "@/lib/ninoFlag";
import { submitNinoFocus } from "@/scene/cameraIntents";
import type { RegionId } from "@/types/enso";
import { fixed } from "@/lib/format";

/**
 * The `?nino=1` flag, read exactly once at module load.
 *
 * Module scope rather than `useMemo`/`useState` in the component for two reasons: the value cannot change
 * without a reload, and a hook here would have to sit before the existing `useScenario` call or after it —
 * either way it changes nothing about order today but adds a hook for a boolean that never moves. A const
 * keeps the component's hook list byte-identical whether the flag is on or off.
 */
const NINO_UI = isNinoUiEnabled(
    typeof location === "undefined" ? "" : location.search,
);

export default function App() {
    const {
        scenario,
        setScenario,
        reset,
        applyLiveTelemetry,
        analytics,
        history,
        retryHistory,
        units,
        toggleUnits,
        telemetry,
    } = useScenario();

    /**
     * Which layout to render, and the two numbers the mobile free rectangle starts from.
     *
     * `useSyncExternalStore` on the same module-scope lane `CameraDirector` reads non-reactively inside its frame
     * loop. One listener, one value, three readers (this shell, the director, the probe): the camera and the DOM
     * can therefore never disagree about which layout is mounted, which is the property the M1 case checks at 767,
     * 768 and 1024.
     *
     * The observer is started HERE rather than only by the director because `data-layout-mode` has to be right on
     * the first paint, and `startLayoutObserver` reads synchronously. `App` mounts before the scene does, so this
     * is the first component that can start it. It is ref-counted, so the director's own call joins this one.
     */
    useEffect(() => startLayoutObserver(), []);
    const layout = useSyncExternalStore(
        subscribeLayout,
        getLayoutSignal,
        getLayoutSignal,
    );
    const isMobile = isMobileMode(layout.mode);

    const [activeRegion, setActiveRegion] = useState<RegionId | null>(null);
    /**
     * The Niño box the user last pressed "Show on globe" for (step 2.3c-1, C2.4).
     *
     * Lives here rather than in the scene because it drives BOTH the card's `aria-pressed` and the
     * outline highlight, and those are on opposite sides of the canvas. The camera flight itself is
     * handed to the director through `submitNinoFocus`, so this state is the UI mirror of the flight
     * rather than its source of truth. Clearing it (on reset / deselect) is what dims the outline.
     */
    const [activeNinoBox, setActiveNinoBox] = useState<string | null>(null);
    const [focusNonce, setFocusNonce] = useState(0);
    const [exporting, setExporting] = useState(false);
    const [booted, setBooted] = useState(false);

    const selectRegion = useCallback((id: RegionId | null) => {
        /*
         * NINO-HARDEN B3a (A2a): selecting a region CANCELS a Niño box focus.
         *
         * A box flight and a region flight are two camera destinations, and before this only one side of
         * the pair was wired: `showNinoOnGlobe` cleared the region, but `selectRegion` left `activeNinoBox`
         * set and left the box flight running. Measured at 1280x720 (A2a): after clicking the Pacific
         * region while Niño 4 was focused, `d` stayed at the box's 2.44292 instead of moving to the
         * region's own flight distance, the drawer said `pacific`, and the Niño 4 button was still
         * `aria-pressed=true` because nothing had cleared the state that drives it.
         *
         * Both calls sit inside `if (NINO_UI)` for the same reason as `clearSelection` (B2): flag-off must
         * not run Niño code at all. Unlike `clearSelection`, this is the NON-NULL arm — pressing "Reset" or
         * the drawer's X is `id === null` and is handled by `clearSelection`, which already clears the box.
         */
        if (id !== null && NINO_UI) {
            setActiveNinoBox(null);
            submitNinoFocus(null);
        }
        setActiveRegion((prev) => {
            // Re-clicking the active region re-centres the camera on it.
            if (prev === id && id !== null) setFocusNonce((n) => n + 1);
            return id;
        });
    }, []);

    /**
     * The selection clearer on its own, for Reset (step 3B2-FIX1 B).
     *
     * Deliberately the SAME `selectRegion(null)` the drawer's X and the Escape key call — the prompt's
     * requirement is that Reset take the existing close path rather than a parallel one, so there is one
     * piece of code that knows how the app deselects. Its signature takes no arguments, so a caller cannot
     * accidentally select a region through it.
     *
     * Step 2.3c-1 C2.4 extends it to the Niño box highlight: "clear it on view reset using the existing
     * reset path". Folding the box clear in HERE rather than adding a second call at the Reset button is
     * what keeps Reset a single rule — the drawer's X and Escape now dim the outline too, which is the
     * behaviour "cleared via the existing reset path" implies rather than a Reset-only exception.
     *
     * NINO-HARDEN B2: both Niño calls are inside `if (NINO_UI)`.
     *
     * Flag-off, `setActiveNinoBox(null)` and `submitNinoFocus(null)` were still running on every reset,
     * deselect and Escape — which made the flag-off tree call the new Niño code even though nothing on
     * screen was Niño-shaped. Both are cheap and both were behaviourally inert (`activeNinoBox` is null,
     * and `submitNinoFocus(null)` clears a `ninoFlight` that is already null), so this is not a bug fix
     * in the observable sense; it is what makes the flag-off claim literally true rather than true-by-
     * effect, and it is what the flag-off fingerprint below checks.
     *
     * `NINO_UI` is a module const, so it is not a dependency of this callback and the hook list is
     * unchanged: the callback's identity still only moves when `selectRegion` does.
     */
    const clearSelection = useCallback(() => {
        selectRegion(null);
        if (NINO_UI) {
            setActiveNinoBox(null);
            submitNinoFocus(null);
        }
    }, [selectRegion]);

    /**
     * "Show on globe" — the only Niño trigger (C2.1).
     *
     * Clears any region selection first: a region focus and a box focus are two different camera
     * destinations, and leaving both latched would have the focus machine and the box flight tweening
     * toward different targets on the same frame. Then it hands the box id to the camera director and
     * mirrors it into state for `aria-pressed` and the outline highlight.
     */
    const showNinoOnGlobe = useCallback(
        (boxId: string) => {
            /*
             * NINO-HARDEN B6(c): a SECOND press of the same card toggles OFF.
             *
             * Implemented here rather than in the card, because all three shells (desktop cards, portrait
             * sheet body, landscape dock) forward to this one callback — wiring the toggle into any of them
             * would leave the other two pressing an already-selected box with no way to deselect it, which is
             * also a keyboard trap: `aria-pressed="true"` on a button whose only action is to re-select
             * itself.
             *
             * The clear path is the SAME one Reset and the drawer's X use (`clearSelection`), so there is one
             * definition of "no box": it clears the highlight, cancels a flight in progress (via
             * `submitNinoFocus(null)`) and, through the director's derived pause, resumes the spin. The brief's
             * rule that the camera STAYS is satisfied because nothing here touches the camera pose — only the
             * flight target and the selection.
             */
            if (NINO_UI && activeNinoBox === boxId) {
                clearSelection();
                return;
            }
            selectRegion(null);
            setActiveNinoBox(boxId);
            submitNinoFocus(boxId);
        },
        [activeNinoBox, clearSelection, selectRegion],
    );

    const handleExport = useCallback(async () => {
        setExporting(true);
        try {
            const snapshot = captureCanvas();
            if (snapshot) {
                downloadPng(
                    snapshot,
                    `el-nino-snapshot-${fixed(scenario.sstAnomaly, 2)}C.png`,
                );
            }
            const html = buildReportHtml({
                scenario,
                metrics: analytics.metrics,
                analytics,
                activeRegion,
                snapshot,
            });
            openReport(html);
        } finally {
            setExporting(false);
        }
    }, [scenario, analytics, activeRegion]);

    const timeline = analytics.timeline.map((p) => p.anomaly);

    return (
        <div
            className="relative h-full w-full overflow-hidden bg-void-950"
            /* The mode as an attribute, so a spec (and a reader of the DOM) can see what the camera sees. */
            data-layout-mode={layout.mode}
        >
            {/* Ambient depth: two fixed radial washes behind the canvas */}
            <div className="pointer-events-none absolute inset-0 z-0">
                <div
                    className="absolute left-1/2 top-1/2 h-[140vh] w-[140vh] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60"
                    style={{
                        background:
                            "radial-gradient(circle, rgba(14,42,74,0.55) 0%, rgba(6,12,24,0.2) 42%, transparent 68%)",
                    }}
                />
                <div
                    className="absolute -bottom-1/3 left-1/2 h-[80vh] w-[120vw] -translate-x-1/2 opacity-40"
                    style={{
                        background:
                            "radial-gradient(ellipse at center, rgba(251,146,60,0.10) 0%, transparent 62%)",
                    }}
                />
            </div>

            {/* WebGL globe.
          `touch-action: none` is what lets OrbitControls receive a two-finger
          pinch: with the default `auto` the browser claims the gesture for
          page zoom/scroll and cancels the pointer stream, so pinch did nothing
          even once the camera was no longer being overwritten every frame.
          `overscroll-behavior: contain` stops a drag at the viewport edge from
          triggering pull-to-refresh / rubber-band over the canvas. */}
            <div
                id="globe-canvas"
                className="absolute inset-0 z-10"
                style={{ touchAction: "none", overscrollBehavior: "contain" }}
            >
                <GlobeScene
                    sst={scenario.sstAnomaly}
                    metrics={analytics.metrics}
                    activeRegion={activeRegion}
                    onSelect={selectRegion}
                    focusNonce={focusNonce}
                    onLoaded={() => setBooted(true)}
                    activeNinoBox={activeNinoBox}
                />
            </div>

            {/* Boot veil — fades the moment the first WebGL frame lands */}
            <div
                className={[
                    "pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-void-950 transition-opacity duration-700",
                    booted ? "opacity-0" : "opacity-100",
                ].join(" ")}
            >
                <div className="flex flex-col items-center gap-3">
                    <div className="relative h-10 w-10">
                        <span className="absolute inset-0 animate-ping rounded-full border border-sky-400/40" />
                        <span className="absolute inset-2 rounded-full bg-sky-400/20 blur-sm" />
                        <span className="absolute inset-[15px] rounded-full bg-sky-300" />
                    </div>
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.28em] text-slate-500">
                        Initialising globe
                    </span>
                </div>
            </div>

            {/*
        The desktop header renders only in desktop mode (step 3-MOBILE1 D). On a phone the island carries the live
        ENSO state and the scrubber, and the `MobileShell` renders an `sr-only` h1 in its place — so the document
        has exactly one level-one heading either way and never two.
      */}
            {!isMobile ? (
                <Header
                    metrics={analytics.metrics}
                    units={units}
                    onToggleUnits={toggleUnits}
                    onExport={handleExport}
                    exporting={exporting}
                    onClearSelection={clearSelection}
                    telemetry={telemetry}
                />
            ) : null}

            {/*
        Left column: control deck.

        `data-occluder` is a MEASUREMENT MARKER for the framing work (step C): the insets registry
        reads it to know which side of the canvas this element covers. It carries no styling and
        changes no layout — the attribute is the whole change.
      */}
            <div
                data-occluder="left-panel"
                className={[
                    /*
                     * The `lg:` width utility is gone from this element, and the width is chosen by the JS mode instead.
                     *
                     * Why: `lg:` is Tailwind's 1024 and `DESKTOP_MIN_W` was 1024 too, so the two agreed by coincidence, not
                     * by construction. TABLET-PORTRAIT makes the mode aspect-aware, so agreement has to be enforced rather
                     * than assumed — a `lg:` utility keeps asserting "1024 and up" no matter what the law says.
                     *
                     * This element is the benign case: its only `lg:` utility was `lg:w-auto`, a WIDTH utility that does
                     * not touch display, so it was the one of the five sites where `hidden` still won (measured). The other
                     * four carried `lg:flex` / `lg:block`, and there a responsive display utility beat the unconditional
                     * `hidden` outright — which is the mechanism this rule exists to remove. Folding the width into the
                     * mode keeps this element consistent with that fix rather than half-converted.
                     *
                     * `sm:p-6` stays: it is inside-component spacing and does not choose the shell.
                     */
                    "pointer-events-none absolute bottom-0 left-0 z-20 flex flex-col gap-3 p-4 sm:p-6",
                    /* Desktop sizes to its content; mobile is hidden, so the width never renders. */
                    isMobile ? "hidden w-full" : "w-auto",
                ].join(" ")}
            >
                <div className="pointer-events-auto flex flex-col gap-2">
                    {/* `lg:flex` removed: this row's whole existence is desktop-only, and the parent already gates on isMobile. */}
                    <div className="flex items-center gap-2 pl-1">
                        <span className="h-px w-6 bg-gradient-to-r from-sky-400/60 to-transparent" />
                        <span className="text-[8px] uppercase tracking-[0.24em] text-slate-500">
                            Live Scenario Controls
                        </span>
                    </div>
                    <ControlDeck
                        scenario={scenario}
                        metrics={analytics.metrics}
                        timeline={timeline}
                        history={history}
                        onRetryHistory={retryHistory}
                        onChange={setScenario}
                        onReset={reset}
                        telemetry={telemetry}
                        onApplyLiveTelemetry={applyLiveTelemetry}
                        units={units}
                    />
                </div>
            </div>

            {/* Right column: region cards (desktop only) — marked for the insets registry, see above. */}
            {/*
        Impact Zones cards — DESKTOP ONLY, and by CONDITIONAL RENDER rather than a CSS class. The prompt asks that
        the desktop cards be absent on mobile, and `hidden` would leave them in the DOM for a screen reader and for
        the insets registry, which reads `[data-occluder]` rects: a `display:none` panel reports a zero-area rect
        and is ignored (`layout/insets.ts:117-123`), so it would be harmless — but "absent" is a stronger and
        simpler claim than "harmless", and it is the one the spec checks.
      */}
            {!isMobile ? (
                <div
                    data-occluder="right-panel"
                    /* `lg:flex` removed — `{!isMobile ? …}` above already decides existence, so the class only added a
             second, disagreeable copy of the same decision. `p-6` is now unconditional where `lg:p-6` was: in
             mobile mode this element does not render at all, and the baseline this must reproduce was measured
             at >= 1024, where `lg:p-6` was the padding in force. */
                    className="pointer-events-none absolute right-0 top-1/2 z-20 flex -translate-y-1/2 p-6"
                >
                    {/*
            Niño 1+2 / Niño 4 empirical cards — default OFF, behind `?nino=1`.

            The ON branch introduces ONE wrapper (`flex w-[268px] flex-col gap-2`) for a measured reason: this
            element is a flex ROW (`className` above), so a bare second child would sit BESIDE the region cards
            and — with no width of its own — shrink-wrap to its longest caption. The first M2 run measured
            exactly that: the section stretched to 614 px and the cards landed at x=642, to the right of the
            panel instead of under it. The wrapper pins both stacks to the same 268 px column.

            The OFF branch is the ORIGINAL single child, unwrapped, so the flag-OFF DOM is identical to the
            commit before this one — proven by the M1 fingerprint, not asserted. `max-h` + `overflow-y-auto`
            sit on the WRAPPER, so the panel scrolls when two more cards outgrow a 720 px viewport; adding them
            to the panel itself would have changed the OFF branch.
          */}
                    {NINO_UI ? (
                        <div className="flex max-h-[calc(100vh-3rem)] w-[268px] shrink-0 flex-col gap-2 overflow-y-auto">
                            <RegionCards
                                metrics={analytics.metrics}
                                activeRegion={activeRegion}
                                onSelect={selectRegion}
                                units={units}
                            />
                            <NinoCards
                                nino34Anomaly={scenario.sstAnomaly}
                                unit={units === "imperial" ? "F" : "C"}
                                layout="desktop"
                                onShowOnGlobe={showNinoOnGlobe}
                                activeBoxId={activeNinoBox}
                            />
                        </div>
                    ) : (
                        <RegionCards
                            metrics={analytics.metrics}
                            activeRegion={activeRegion}
                            onSelect={selectRegion}
                            units={units}
                        />
                    )}
                </div>
            ) : null}

            {/*
        The drawer is DESKTOP ONLY. Its `data-occluder="right-drawer"` marker feeds the insets registry, and that
        measurement is what sets the desktop right inset — so on a phone it must not be mounted at all, or the
        registry would report an inset from a panel the mobile framing ignores.
      */}
            {!isMobile ? (
                <RegionDrawer
                    region={activeRegion ? REGION_MAP[activeRegion] : null}
                    metrics={analytics.metrics}
                    analytics={analytics}
                    units={units}
                    onClose={() => selectRegion(null)}
                    onSelect={selectRegion}
                    telemetry={telemetry}
                />
            ) : null}

            {/*
        THE MOBILE SHELL. A sibling of `#globe-canvas`, never a descendant: R3F connects its DOM listeners to the
        Canvas WRAPPER div and fires `onPointerMissed` on any click that hits nothing in the scene, so a sheet
        inside that wrapper would clear the selection on every tap. See `MOBILE-AUDIT.md` section 5.
      */}
            {isMobile ? (
                <MobileShell
                    mode={layout.mode}
                    viewportW={layout.width}
                    headerBottom={layout.headerBottom}
                    scenario={scenario}
                    metrics={analytics.metrics}
                    analytics={analytics}
                    region={activeRegion ? REGION_MAP[activeRegion] : null}
                    activeRegion={activeRegion}
                    units={units}
                    onSelect={selectRegion}
                    onClearSelection={clearSelection}
                    onScenarioChange={setScenario}
                    exporting={exporting}
                    onToggleUnits={toggleUnits}
                    onExport={handleExport}
                    activeNinoBox={activeNinoBox}
                    onShowOnGlobe={showNinoOnGlobe}
                    telemetry={telemetry}
                />
            ) : null}

            {/*
            Desktop telemetry status & attribution bar. Embeds camera navigation hotkeys directly
            in the center slot to preserve unoccluded viewport sightlines to the globe's southern limb.
            */}
            {!isMobile ? (
                <footer className="pointer-events-auto absolute bottom-0 left-0 right-0 z-20 flex flex-col md:flex-row items-center justify-between gap-3 border-t border-white/[0.06] bg-slate-950/80 px-4 py-2 backdrop-blur-md font-mono text-[11px] text-slate-400">
                    {/* Left: Attribution & Engine */}
                    <div className="flex flex-wrap items-center gap-x-2 text-[10.5px]">
                        <span className="font-medium text-slate-200">
                            © 2026 Tariq Khan
                        </span>
                        <span className="text-slate-600">·</span>
                        <span>
                            Architected with React Three Fiber, DuckDB-WASM
                            &amp; TypeScript
                        </span>
                        <span className="text-slate-600">·</span>
                        <span className="text-slate-500">Cloudflare Pages</span>
                    </div>

                    {/* Center: Navigation Hotkeys (No globe overlap) */}
                    <div className="hidden lg:flex items-center gap-3 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-0.5">
                        {[
                            ["Drag", "orbit"],
                            ["Scroll", "zoom"],
                            ["Click pin", "inspect"],
                        ].map(([k, v]) => (
                            <span
                                key={k}
                                className="flex items-center gap-1 text-[8.5px] uppercase tracking-[0.12em] text-slate-400"
                            >
                                <kbd className="rounded border border-white/12 bg-white/[0.06] px-1 py-[1px] font-mono text-[8px] text-slate-200">
                                    {k}
                                </kbd>
                                {v}
                            </span>
                        ))}
                    </div>

                    {/* Right: Recruiter Pathways */}
                    <div className="flex items-center gap-3 text-slate-300 text-[10.5px]">
                        <a
                            href="https://tariqkhan.dev"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-slate-700 underline-offset-2 transition-colors hover:text-cyan-400"
                        >
                            Portfolio
                        </a>
                        <span className="text-slate-600">·</span>
                        <a
                            href="https://github.com/tariq-k-dev/el-nino-simulator"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-slate-700 underline-offset-2 transition-colors hover:text-cyan-400"
                        >
                            GitHub
                        </a>
                        <span className="text-slate-600">·</span>
                        <a
                            href="https://www.linkedin.com/in/tariqakhan"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-slate-700 underline-offset-2 transition-colors hover:text-cyan-400"
                        >
                            LinkedIn
                        </a>
                    </div>
                </footer>
            ) : null}
        </div>
    );
}
