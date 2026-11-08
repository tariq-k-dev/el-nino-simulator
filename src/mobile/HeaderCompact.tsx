/**
 * The compact Header — the only header the two mobile modes render.
 *
 * ## Why a second header component rather than a responsive `Header.tsx`
 *
 * The desktop header is measured: its height (118.25 px at every desktop viewport) drives the desktop free
 * rectangle, and the locked pixel specs compare against it. Anything that makes it re-render differently — a
 * shared child, a conditional wrapper, a class that changes its flex behaviour — is a risk to a number this step
 * must not move. So the desktop file is not touched at all (see `docs/MOBILE2-AUDIT.md` §2, STOP condition (a)),
 * and the compact header is its own tree that reuses only what is ALREADY shared: `ResetViewButton` (which the
 * desktop header and MOBILE1's shell both mount today) and the same three callbacks `App` already passes.
 *
 * ## Why the island was deleted
 *
 * MOBILE1 rendered the live ENSO state in a floating island at the top centre and the Reset controls in a
 * separate fixed cluster at the top right, which left two rotate-ccw icons in the same corner (the island's
 * neighbour reset the SCENARIO; the other reset the VIEW) and a duplicate affordance the prompt names the "ghost".
 * One header owns all of it now: the chip and its scrubber live here, the controls are here, and there is exactly
 * one of each.
 *
 * ## The rows, per mode
 *
 *   - **portrait**: two rows — `h1` and the controls on the first, the ENSO chip on the second. The `h1` may wrap
 *     to two lines and is NEVER ellipsised: it is the page's only heading and its subject, so a truncated title
 *     would be a content loss rather than a style choice.
 *   - **phoneLandscape**: one row — `h1`, then the chip, then the controls. Height is the scarce dimension there,
 *     so a second row would eat the globe's band.
 *
 * Both rows are inside one `<header>` element, and the header's measured BOTTOM EDGE is what the free rectangle
 * starts below (`publishHeaderBottom`). That is the reason the header is `pointer-events-none` with
 * `pointer-events-auto` children: the band under its controls must still reach OrbitControls.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Download, Gauge, Globe2 } from "lucide-react";
import type { UnitSystem } from "@/types/enso";
import { REGIONS } from "@/lib/regions";
import { SST_MAX, SST_MIN, thermalColor } from "@/lib/model";
import { fixed } from "@/lib/format";
import { ResetViewButton } from "@/components/ResetViewButton";
import { ensoCategory, ensoLabel, formatIsland } from "@/mobile/ensoHud";
import { anomalyDeltaUnit } from "@/mobile/layoutMath";
import type { LayoutMode2 } from "@/mobile/layoutMath";
import {
    LANDSCAPE_CHIP_W,
    LANDSCAPE_CONTROL_H,
    LANDSCAPE_IDENTITY_H,
    LANDSCAPE_ROW_GAP_PX,
    landscapeHeaderHeight,
    landscapeHeaderRows,
} from "@/mobile/headerMath";
import { publishHeaderBottom } from "@/scene/viewStore";

/** Where the anomaly is right now, with its own scrollbar-free slider. */
interface HeaderCompactProps {
    mode: LayoutMode2;
    /**
     * The layout viewport width, px.
     *
     * Used ONLY to choose the landscape row count (`landscapeHeaderRows`). It is a viewport number, not
     * a measurement of any header element, so the header's geometry stays a pure function of the
     * viewport: no chip text, no font load and no `h1` wrap can reach it.
     */
    viewportW: number;
    /** The live global anomaly, °C. The chip, the popover and the slider all read THIS. */
    anomalyC: number;
    units: UnitSystem;
    onToggleUnits: () => void;
    onExport: () => void;
    exporting: boolean;
    /** The drawer X / Escape path, driven by the Reset control. */
    onClearSelection: () => void;
    onSstChange: (value: number) => void;
    /** Hide the ENSO chip (portrait, sheet at full). Fades out rather than unmounting. */
    hideChip?: boolean;
}

/**
 * One 44 px control surface.
 *
 * The prompt's minimum is 44 px in both dimensions, and it is not a suggestion: a 36 px chip beside a 44 px one
 * puts two different hit bands in a row a thumb is aiming at. Every control in this header is built from this
 * class string, so the minimum is one edit rather than five.
 */
const TOUCH = "flex h-11 min-w-[44px] items-center justify-center rounded-full";

export function HeaderCompact({
    mode,
    viewportW,
    anomalyC,
    units,
    onToggleUnits,
    onExport,
    exporting,
    onClearSelection,
    onSstChange,
    hideChip = false,
}: HeaderCompactProps) {
    const headerRef = useRef<HTMLElement>(null);
    const landscape = mode === "phoneLandscape";
    /**
     * The landscape header's layout, chosen by viewport WIDTH and nothing else.
     *
     * `rows` comes from `landscapeHeaderRows` — a pure function of the width — so the row COUNT cannot
     * change when the ENSO chip's text changes. The inline style below then pins every row to a fixed
     * height, which is what makes the header's bottom a constant: with `gridTemplateRows: '20px 50px'`
     * a wrapped child cannot add a row, and `flex-nowrap` on the one-row branch cannot either.
     *
     * This is measurement-free CSS. There is no post-load JS that reads a rect and re-lays-out — the
     * only reader of the header's rect is the `publishHeaderBottom` observer, which is a REPORT of what
     * CSS decided, not an input to it.
     */
    const rows = landscapeHeaderRows(landscape ? viewportW : 0);
    const landscapeStyle: CSSProperties | undefined = landscape
        ? rows === 1
            ? {
                  display: "flex",
                  flexDirection: "row",
                  flexWrap: "nowrap",
                  alignItems: "center",
                  columnGap: 12,
                  rowGap: 0,
                  paddingTop: 2,
                  paddingBottom: 2,
                  height: landscapeHeaderHeight(viewportW),
              }
            : {
                  display: "grid",
                  gridTemplateColumns: "auto auto",
                  gridTemplateRows: `${LANDSCAPE_IDENTITY_H}px ${LANDSCAPE_CONTROL_H}px`,
                  columnGap: 12,
                  rowGap: LANDSCAPE_ROW_GAP_PX,
                  paddingTop: 2,
                  paddingBottom: 2,
                  height: landscapeHeaderHeight(viewportW),
              }
        : undefined;

    /* ------------------------------------------------------------------ the headerBottom publisher */

    /**
     * Publish the header's bottom edge, from a `ResizeObserver`.
     *
     * A ResizeObserver rather than a resize listener because the header's height is not a function of the viewport
     * alone: the `h1` wrapping to two lines at 320 px changes it, and so does a font finishing loading. The observer
     * fires for all three causes, and `getBoundingClientRect().bottom` is the number the free rect needs (the
     * header is at `top: 0`, so bottom == height, but measuring the bottom is what stays correct if that ever
     * changes).
     *
     * `publishHeaderBottom` drops changes under 0.5 px, so a sub-pixel settle does not re-fit the globe.
     */
    useEffect(() => {
        const el = headerRef.current;
        if (!el) return undefined;
        const publish = (): void =>
            publishHeaderBottom(el.getBoundingClientRect().bottom);
        publish();
        if (typeof ResizeObserver === "undefined")
            return () => publishHeaderBottom(null);
        const observer = new ResizeObserver(publish);
        observer.observe(el);
        return () => {
            observer.disconnect();
            /* Leaving a mobile mode: the free rect must stop starting below a header that is gone. */
            publishHeaderBottom(null);
        };
    }, []);

    return (
        <header
            ref={headerRef}
            data-occluder="compact-header"
            data-layout-header={mode}
            data-layout-rows={landscape ? rows : undefined}
            className={
                landscape
                    ? "pointer-events-none absolute inset-x-0 top-0 z-40 px-3"
                    : "pointer-events-none absolute inset-x-0 top-0 z-40 flex flex-wrap gap-x-3 gap-y-1.5 px-3 pb-2 flex-col"
            }
            style={
                landscape
                    ? landscapeStyle
                    : { paddingTop: "calc(env(safe-area-inset-top) + 8px)" }
            }
        >
            {/* ------------------------------------------------------------------ row 1: identity */}
            <div
                className={[
                    "pointer-events-auto flex min-w-0 items-center gap-2",
                    landscape ? "flex-none" : "",
                ].join(" ")}
                style={
                    landscape
                        ? rows === 1
                            ? { flex: "0 0 auto" }
                            : { gridColumn: "1 / -1", gridRow: 1, minWidth: 0 }
                        : undefined
                }
            >
                <div
                    className={
                        landscape
                            ? "relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-sky-300/25 bg-sky-400/10"
                            : "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-300/25 bg-sky-400/10"
                    }
                >
                    <Globe2
                        className="text-sky-300"
                        size={landscape ? 12 : 16}
                    />
                    <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                </div>
                {/*
          The page's only h1.
          Portrait: `break-words` plus no `truncate` and no `text-overflow` — a two-line wrap is allowed,
          an ellipsis is not. `min-w-0` on the parent is what lets `break-words` actually break a long
          word in a flex item.
          Landscape: ONE line, always. `whitespace-nowrap` and `flex-none` (or the fixed grid row) mean
          the h1 reserves its measured 229.06 px natural width and can neither wrap nor be squeezed —
          which is the defect this replaced, where a `flex-1` slot collapsed to 26.5 px and the heading
          wrapped to eleven 16.25 px line boxes, growing the header from 113.50 to 194.75 px after load.
          Still no ellipsis and no clipping: it does not need to shrink, because the row was sized for it.
        */}
                <h1
                    className={[
                        landscape
                            ? "flex-none whitespace-nowrap text-[13px] font-semibold leading-tight tracking-[-0.01em] text-slate-50"
                            : "min-w-0 break-words text-[13px] font-semibold leading-tight tracking-[-0.01em] text-slate-50",
                    ].join(" ")}
                >
                    Super El&nbsp;Niño{" "}
                    <span className="font-normal text-slate-400">
                        Global Impact Simulator
                    </span>
                </h1>
                <span className="sr-only">
                    Interactive teleconnection model · R3F + DuckDB-WASM
                </span>
            </div>

            {/* ------------------------------------------------------------------ the chip */}
            <div
                /*
                 * In landscape the chip's box is a FIXED width from `headerMath`, so its text cannot move a
                 * single pixel of layout: `formatIsland` spans 128.53 px (NEUTRAL) to 208.09 px (VERY STRONG
                 * EL NIÑO), and `LANDSCAPE_CHIP_W` reserves 218 px of text box inside 34 px of chrome.
                 *
                 * The stretching selectors are `[&>div]` and `[&_button]`, not `[&>button]`: `EnsoChip`'s root
                 * is a `<div>` and its button is a GRANDCHILD, so a `[&>button]:w-full` rule matched nothing and
                 * the button kept its natural 217.48 px (measured — the wrapper was 252 and the button was not).
                 * `_button` is safe here because the chip subtree holds exactly one button; the popover is
                 * `position: absolute`, so widening the button cannot move it.
                 */
                className={[
                    "pointer-events-auto transition-opacity duration-200",
                    hideChip ? "pointer-events-none opacity-0" : "opacity-100",
                    landscape
                        ? "flex-none [&>div]:w-full [&_button]:w-full"
                        : "order-last w-full",
                ].join(" ")}
                style={
                    landscape
                        ? {
                              width: LANDSCAPE_CHIP_W,
                              ...(rows === 1
                                  ? {}
                                  : { gridColumn: 1, gridRow: 2 }),
                          }
                        : undefined
                }
            >
                <EnsoChip
                    anomalyC={anomalyC}
                    units={units}
                    onSstChange={onSstChange}
                    wide={!landscape}
                />
            </div>

            {/* ------------------------------------------------------------------ row 1: controls */}
            <div
                className={[
                    "pointer-events-auto flex shrink-0 items-center gap-1.5",
                    landscape ? "flex-none [&_button_span]:hidden" : "",
                ].join(" ")}
                style={
                    landscape
                        ? rows === 1
                            ? { flex: "0 0 auto" }
                            : { gridColumn: 2, gridRow: 2, justifySelf: "end" }
                        : undefined
                }
            >
                <div className="flex items-center overflow-hidden rounded-full border border-white/[0.08] bg-black/40 p-0.5 backdrop-blur-md">
                    {(["metric", "imperial"] as const).map((system) => (
                        <button
                            key={system}
                            type="button"
                            onClick={() => {
                                /* Idempotent: clicking the already-active unit is a no-op. */
                                if (units === system) return;
                                onToggleUnits();
                            }}
                            className={[
                                "h-11 min-w-[44px] rounded-full px-2 font-mono text-[9px] uppercase tracking-[0.12em] transition-all duration-200",
                                units === system
                                    ? "bg-white/12 text-slate-50 shadow-sm"
                                    : "text-slate-500",
                            ].join(" ")}
                            aria-pressed={units === system}
                            aria-label={
                                system === "metric"
                                    ? "Metric units"
                                    : "Imperial units"
                            }
                        >
                            {system === "metric" ? "°C" : "°F"}
                        </button>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={onExport}
                    disabled={exporting}
                    aria-label="Snapshot"
                    className={`${TOUCH} gap-1.5 border border-sky-300/25 bg-sky-400/10 px-3 text-[10px] font-medium uppercase tracking-[0.12em] text-sky-100 backdrop-blur-md disabled:opacity-50`}
                >
                    {exporting ? (
                        <Gauge size={12} className="animate-pulse" />
                    ) : (
                        <Download size={12} />
                    )}
                    <span className="sr-only sm:not-sr-only">
                        {exporting ? "Rendering…" : "Snapshot"}
                    </span>
                </button>

                {/*
          A 44 px STRETCH BOX around the shared control.
          `ResetViewButton`'s own class string is `px-3 py-1.5`, which measures 26 px tall with its label hidden —
          under the prompt's touch minimum. Stretching it from a flex parent leaves `ResetViewButton` (and therefore
          the DESKTOP header, which mounts the same component) byte-identical: the wrapper exists only in this file.
        */}
                <div className="flex h-11 min-w-[44px] items-stretch [&>button]:w-full">
                    <ResetViewButton onClearSelection={onClearSelection} />
                </div>
            </div>
        </header>
    );
}

/**
 * The ENSO chip and its scrubber popover.
 *
 * ## The text comes from `formatIsland`, never from a literal
 *
 * `formatIsland(anomalyC)` is the same function MOBILE1's island printed and the same one the M9 case recomputes
 * in the page, so a changed store value changes the chip by construction. The popover's own readout is a
 * DIFFERENT string on purpose: it shows the anomaly in the toggled unit (`anomalyDeltaUnit`, ×1.8 with no +32)
 * while the chip keeps the °C form the ONI bands are defined in — and the CATEGORY always classifies the °C value,
 * because "strong El Niño" is a °C threshold in every published definition.
 *
 * ## The popover floats, so it never moves the globe
 *
 * It is `position: absolute` under the chip with its own stacking context (z-50, above the header's z-40), so
 * opening it changes no layout, no header height and no free rect. That is a correctness requirement, not a
 * preference: the free rect is published from a ResizeObserver on the header, and a popover that grew the header
 * would re-fit the camera every time a reader peeked at the number.
 *
 * ## Escape closes ONLY the popover
 *
 * A capture-phase keydown listener on the document, registered only while open, calls `stopPropagation` so the
 * app's own Escape handler (which closes the region drawer / clears the selection) never sees the key. Without
 * that, dismissing a popover would also drop the reader's selected region.
 */
function EnsoChip({
    anomalyC,
    units,
    onSstChange,
    wide,
}: {
    anomalyC: number;
    units: UnitSystem;
    onSstChange: (value: number) => void;
    wide: boolean;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const scrubberId = useId();
    const accent = thermalColor(anomalyC, 0.95);
    const delta = anomalyDeltaUnit(anomalyC, units);
    const category = ensoCategory(anomalyC);

    /* ------------------------------------------------------------------- close paths */

    useEffect(() => {
        if (!open) return undefined;

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") return;
            /* Capture phase, and stopped here: the popover is the innermost thing Escape can close. */
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
        };

        /*
         * "Outside" means outside the WHOLE HEADER, not outside the chip.
         *
         * The unit toggle, Snapshot and Reset are siblings of the chip in the same `<header>`, and switching units
         * while the popover is open is the ONE thing a reader is most likely to do next — they opened it to compare
         * the value. Measured: with `root.contains` as the test, tapping the unit toggle closed the popover (the toggle
         * is not in the chip's subtree), so the M9 case then waited for a popover that was gone. The header's own box
         * is the honest boundary.
         */
        const onPointerDown = (event: PointerEvent): void => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            const header = rootRef.current?.closest("header");
            if (header && header.contains(target)) return;
            if (rootRef.current?.contains(target)) return;
            setOpen(false);
        };

        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => {
            document.removeEventListener("keydown", onKeyDown, true);
            document.removeEventListener("pointerdown", onPointerDown, true);
        };
    }, [open]);

    const toggle = useCallback(() => setOpen((v) => !v), []);

    return (
        <div ref={rootRef} className="relative flex flex-col items-start">
            <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-controls={scrubberId}
                aria-label="ENSO state and live anomaly"
                data-testid="enso-chip"
                className={[
                    "flex min-h-[44px] items-center gap-2 rounded-full border border-white/12 bg-slate-950/80 px-3 backdrop-blur-md",
                    wide ? "w-full justify-between" : "",
                ].join(" ")}
            >
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                    <span
                        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                        style={{ background: accent }}
                    />
                    <span
                        className="relative inline-flex h-1.5 w-1.5 rounded-full"
                        style={{ background: accent }}
                    />
                </span>
                {/*
          One line, down to 320 px. `whitespace-nowrap` PLUS `text-[9px]` and a tightened tracking: at 320 the
          string is 28 characters of monospace and the chip has 296 px of header to live in. Measured in the LM2
          case rather than assumed.
        */}
                <span
                    data-testid="enso-chip-text"
                    className="whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.08em] text-slate-200"
                >
                    {formatIsland(anomalyC)}
                </span>
            </button>

            {/*
        The popover. `top-full` under the chip, and it is the ONLY thing in this file that is above the header in
        z-order (z-50 against the header's z-40).
      */}
            {open ? (
                <div
                    id={scrubberId}
                    data-testid="enso-popover"
                    className="absolute left-0 top-full z-50 mt-1.5 w-[min(320px,86vw)] rounded-2xl border border-white/12 bg-slate-950/95 p-3 backdrop-blur-md"
                    style={{ touchAction: "pan-y" }}
                >
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                        <span className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-slate-500">
                            Global SST anomaly
                        </span>
                        {/* The DELTA conversion: ×1.8, no +32. A deviation has no zero-offset. */}
                        <span className="num text-[13px] font-semibold text-slate-100">
                            {delta.value >= 0 ? "+" : ""}
                            {fixed(delta.value, 1)}
                            <span className="ml-0.5 text-[9px] text-slate-400">
                                {delta.unit}
                            </span>
                        </span>
                    </div>
                    <input
                        type="range"
                        min={SST_MIN}
                        max={SST_MAX}
                        step={0.01}
                        value={anomalyC}
                        onChange={(e) => onSstChange(Number(e.target.value))}
                        aria-label="Global SST anomaly"
                        className="slider w-full"
                        style={{ touchAction: "none", minHeight: "44px" }}
                    />
                    <div className="mt-1 flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.12em] text-slate-500">
                        <span>Neutral</span>
                        {/* The category is always a °C classification — the ONI bands are °C thresholds. */}
                        <span className="text-slate-300">
                            {ensoLabel(category)}
                        </span>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/**
 * The regions the in-drawer switcher offers. Re-exported so `SheetBody` and this file cannot disagree about the
 * source — they both read `lib/regions`, and `REGIONS` is the single list.
 */
export const HEADER_REGIONS = REGIONS;
