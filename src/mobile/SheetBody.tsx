/**
 * The sheet's BODY — everything below the handle row — shared by the portrait sheet and the landscape dock.
 *
 * ## Why this is a separate component
 *
 * MOBILE1 had one surface: the portrait snap sheet, whose body showed a peek paragraph, the Half tier's controls
 * and the Full tier's narrative. Step MOBILE2 adds a second surface (the landscape dock) that shows the SAME
 * content with no tiers at all, and the prompt's requirement is explicit: the two must not be two copies, because
 * two copies is how a region switcher ends up selecting through one path in portrait and another in landscape.
 *
 * So the body lives here and both surfaces pass it the same props. `tier` is a LAYOUT hint rather than state: the
 * sheet uses it to hide the Half/Full sections at peek, and the dock passes `'dock'`, which shows everything.
 *
 * ## The desktop drawer is not affected
 *
 * `RegionDrawer.tsx` keeps its own rendering. Nothing here is imported by it, and the two never mount together
 * (an `isMobile` gate in `App.tsx` decides).
 *
 * ## What changed from MOBILE1's sheet body
 *
 *   - the header zone above this component WRAPS instead of truncating (`SnapSheet.tsx`), so `GLOBAL ENSO STATE`
 *     reads in full at 412 px;
 *   - the region switcher's chips keep their 44 px minimum and now also wrap;
 *   - the full-tier analog table keeps its own scroll container, so the dock under it can still scroll.
 */

import { useMemo } from "react";
import type {
    AnalyticsPayload,
    RegionDefinition,
    RegionId,
    ScenarioMetrics,
    ScenarioState,
    UnitSystem,
} from "@/types/enso";
import { Stat } from "@/components/ui/Stat";
import { MetricBar } from "@/components/ui/MetricBar";
import { Sparkline } from "@/components/ui/Sparkline";
import { REGIONS, formatDelta } from "@/lib/regions";
import { SST_MAX, SST_MIN, thermalColor } from "@/lib/model";
import { fixed } from "@/lib/format";
import { isNinoUiEnabled } from "@/lib/ninoFlag";
import { NinoCards } from "@/components/NinoCards";
import { ensoCategory, ensoLabel } from "@/mobile/ensoHud";

/** Which surface is rendering the body. `dock` shows every section and has no tier concept. */
export type SheetBodySurface = "peek" | "half" | "full" | "dock";

export interface SheetBodyProps {
    surface: SheetBodySurface;
    metrics: ScenarioMetrics;
    analytics: AnalyticsPayload;
    scenarioSst: number;
    region: RegionDefinition | null;
    units: UnitSystem;
    activeRegion: RegionId | null;
    /** The SAME selection path the cards, the drawer and the dock chips use. */
    onSelect: (id: RegionId) => void;
    onClearSelection: () => void;
    /** The desktop scrubber's own action, so every copy writes the same state. */
    onSstChange: (value: number) => void;
    /** Jets and cropland weight — the teleconnection sliders, reused rather than duplicated. */
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
}

/**
 * The body.
 *
 * The three sections are gated by `surface` rather than by CSS: at peek the sheet mounts only the peek paragraph,
 * which is what keeps the M5 render counter cheap, while the dock mounts everything once.
 */
export function SheetBody({
    surface,
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
}: SheetBodyProps) {
    const accent = thermalColor(metrics.sst, 0.95);
    const category = ensoCategory(scenarioSst);
    const showControls = surface !== "peek";
    const showFull = surface === "full" || surface === "dock";

    return (
        <>
            {/*
        PEEK: the region pill and the anomaly badge live in the header zone above this component (they are the
        sheet's own title row), so all that is left here is the one-sentence orientation for a reader who has just
        opened the sheet.
      */}
            {!region ? (
                <p className="text-[11px] leading-relaxed text-slate-400">
                    No impact zone selected. Tap a pin or pick a region below.
                    The global signal is{" "}
                    <span style={{ color: accent }}>{ensoLabel(category)}</span>{" "}
                    at {fixed(scenarioSst, 2)} °C.
                </p>
            ) : null}

            {/* ---------------- HALF (and the dock): sliders, core metrics, region switcher ------------ */}
            {showControls ? (
                <div data-sheet-section="controls" className="mt-3 space-y-3">
                    <label className="block">
                        <span className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
                            <span>Global SST anomaly</span>
                            <span className="text-slate-300">
                                {fixed(scenarioSst, 2)} °C
                            </span>
                        </span>
                        <input
                            type="range"
                            min={SST_MIN}
                            max={SST_MAX}
                            step={0.01}
                            value={scenarioSst}
                            onChange={(e) =>
                                onSstChange(Number(e.target.value))
                            }
                            aria-label="Global SST anomaly"
                            className="slider w-full"
                            style={{ touchAction: "pan-y", minHeight: "44px" }}
                        />
                    </label>
                    <label className="block">
                        <span className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
                            <span>Jet stream shift</span>
                            <span className="text-slate-300">
                                {fixed(metrics.jet, 2)}
                            </span>
                        </span>
                        <input
                            type="range"
                            min={-1}
                            max={1}
                            step={0.01}
                            value={metrics.jet}
                            onChange={(e) =>
                                onChangeScenario({
                                    jetStreamShift: Number(e.target.value),
                                })
                            }
                            aria-label="Jet stream shift"
                            className="slider w-full"
                            style={{ touchAction: "pan-y", minHeight: "44px" }}
                        />
                    </label>
                    <label className="block">
                        <span className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
                            <span>Agriculture exposure weight</span>
                            <span className="text-slate-300">
                                {fixed(metrics.agri, 2)}
                            </span>
                        </span>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={metrics.agri}
                            onChange={(e) =>
                                onChangeScenario({
                                    agricultureWeight: Number(e.target.value),
                                })
                            }
                            aria-label="Agriculture exposure weight"
                            className="slider w-full"
                            style={{ touchAction: "pan-y", minHeight: "44px" }}
                        />
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                        <Stat
                            label="Global impact"
                            value={fixed(metrics.globalImpactIndex, 1)}
                            unit="/100"
                            accent={accent}
                            size="sm"
                        />
                        <Stat
                            label="Agri exposure"
                            value={fixed(metrics.agricultureExposure, 1)}
                            unit="%"
                            accent="#34d399"
                            size="sm"
                        />
                    </div>

                    {/* The FIX2 region switcher. Same REGIONS source, same `onSelect` path, same no-op on the active chip. */}
                    <div
                        role="group"
                        aria-label="Switch impact region"
                        className="flex flex-wrap gap-1.5"
                    >
                        {REGIONS.map((r) => {
                            const active = activeRegion === r.id;
                            return (
                                <button
                                    key={r.id}
                                    type="button"
                                    data-region-id={r.id}
                                    aria-current={active ? "true" : undefined}
                                    onClick={() => {
                                        if (active) return;
                                        onSelect(r.id);
                                    }}
                                    className={[
                                        "rounded-full border px-2.5 py-2 font-mono text-[9px] uppercase tracking-[0.12em] transition-colors",
                                        "min-h-[44px] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                                        active
                                            ? "border-white/35 bg-white/12 text-white"
                                            : "border-white/[0.1] bg-black/25 text-slate-400",
                                    ].join(" ")}
                                    style={
                                        active
                                            ? {
                                                  boxShadow: `0 0 12px -4px ${r.accent}`,
                                              }
                                            : undefined
                                    }
                                >
                                    {r.shortName}
                                </button>
                            );
                        })}
                    </div>

                    {/*
            Niño 1+2 / Niño 4 empirical cards — the SAME component and the same numbers as the desktop panel,
            appended after the region switcher so the sheet gains one block and no structural change.

            Mobile reads the flag through the same `isNinoUiEnabled` helper. It is imported rather than passed
            as a prop because the alternative is a new prop threaded through `MobileShell` → `SnapSheet` /
            `LandscapeDock` → here, which would touch three files to deliver a constant.
          */}
                    {isNinoUiEnabled(
                        typeof location === "undefined" ? "" : location.search,
                    ) ? (
                        <NinoCards
                            nino34Anomaly={scenarioSst}
                            unit={units === "imperial" ? "F" : "C"}
                            layout="mobile"
                            onShowOnGlobe={onShowOnGlobe}
                            activeBoxId={activeNinoBox}
                        />
                    ) : null}
                </div>
            ) : null}

            {/* ---------------- FULL (and the dock): narrative, the DuckDB-backed sections ------------ */}
            {showFull ? (
                <div data-sheet-section="full" className="mt-3">
                    <FullSections
                        region={region}
                        metrics={metrics}
                        analytics={analytics}
                        units={units}
                        accent={accent}
                        onClearSelection={onClearSelection}
                    />
                </div>
            ) : null}
        </>
    );
}

/**
 * The full tier's own content.
 *
 * Split out so the lazy mount stays a real boundary in `SnapSheet`: this body does not run until the reader has
 * reached full, so the analogs table and the dataset footer cost nothing at peek. The dock always renders it,
 * which is correct — the dock has no tiers.
 */
function FullSections({
    region,
    metrics,
    analytics,
    units,
    accent,
    onClearSelection,
}: {
    region: RegionDefinition | null;
    metrics: ScenarioMetrics;
    analytics: AnalyticsPayload;
    units: UnitSystem;
    accent: string;
    onClearSelection: () => void;
}) {
    const bars = useMemo(
        () => [
            {
                label: "US precip anomaly",
                value: metrics.usPrecip,
                accent: "#a78bfa",
                divergent: true,
            },
            {
                label: "SE Asia precip anomaly",
                value: metrics.asiaPrecip,
                accent: "#fb923c",
                divergent: true,
            },
            {
                label: "Horn precip anomaly",
                value: metrics.africaPrecip,
                accent: "#34d399",
                divergent: true,
            },
            {
                label: "Pacific convection",
                value: metrics.pacificConvection,
                accent: "#38bdf8",
            },
        ],
        [metrics],
    );

    return (
        <div className="space-y-3">
            {region ? (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.018] p-3">
                    <p className="text-[10.5px] leading-relaxed text-slate-400">
                        {region.mechanism}
                    </p>
                    <p className="mt-2 border-t border-white/[0.05] pt-2 text-[10.5px] leading-relaxed text-slate-300/85">
                        {region.summary}
                    </p>
                </div>
            ) : null}

            <div className="space-y-2.5">
                <div className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-slate-500">
                    Impact breakdown
                </div>
                {bars.map((b) => (
                    <MetricBar
                        key={b.label}
                        label={b.label}
                        value={b.value}
                        accent={b.accent}
                        divergent={b.divergent}
                    />
                ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
                <Stat
                    label="US precip"
                    value={formatDelta(metrics.usPrecip, "%")}
                    unit=""
                    accent="#a78bfa"
                    size="sm"
                />
                <Stat
                    label="Temp dev"
                    value={formatDelta(
                        units === "imperial"
                            ? metrics.usTempDevF
                            : metrics.usTempDevF * (5 / 9),
                        "°",
                    )}
                    unit={units === "imperial" ? "F" : "C"}
                    accent="#a78bfa"
                    size="sm"
                />
                <Stat
                    label="Asia drought"
                    value={fixed(metrics.asiaDrought, 2)}
                    unit="/10"
                    accent="#fb923c"
                    size="sm"
                />
                <Stat
                    label="Africa flood"
                    value={fixed(metrics.africaFlood, 2)}
                    unit="/10"
                    accent="#34d399"
                    size="sm"
                />
            </div>

            {/* The DuckDB-backed analog table. */}
            <div>
                <div className="mb-2 flex items-center justify-between font-mono text-[8.5px] uppercase tracking-[0.2em] text-slate-500">
                    <span>Historical analogs</span>
                    <span>{analytics.summary.analogCount} within ±0.35°C</span>
                </div>
                {analytics.analogs.length > 0 ? (
                    <div className="overflow-hidden rounded-xl border border-white/[0.06]">
                        <table className="w-full border-collapse text-left">
                            <thead>
                                <tr className="border-b border-white/[0.06] bg-white/[0.025]">
                                    {["Month", "N3.4", "SST", "Tier"].map(
                                        (col) => (
                                            <th
                                                key={col}
                                                className="px-2 py-1.5 font-mono text-[8px] font-medium uppercase tracking-[0.12em] text-slate-500"
                                            >
                                                {col}
                                            </th>
                                        ),
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {analytics.analogs.slice(0, 5).map((a) => (
                                    <tr
                                        key={a.date}
                                        className="border-b border-white/[0.035] last:border-0"
                                    >
                                        <td className="num px-2 py-1.5 text-[10px] text-slate-300">
                                            {a.label}
                                        </td>
                                        <td className="num px-2 py-1.5 text-[10px] text-slate-100">
                                            {fixed(a.anomaly, 2)}
                                        </td>
                                        <td className="num px-2 py-1.5 text-[9.5px] text-slate-400">
                                            {a.absoluteSst > 0
                                                ? fixed(a.absoluteSst, 1)
                                                : "—"}
                                        </td>
                                        <td className="px-2 py-1.5 text-[8px] text-slate-400">
                                            {a.riskTier}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[10px] text-slate-500">
                        Analog matching unavailable — DuckDB engine is not
                        running.
                    </div>
                )}
            </div>

            <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2.5">
                <div className="mb-1 flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.14em] text-slate-500">
                    <span>Dataset window</span>
                    <span className="text-slate-400">
                        {analytics.summary.firstDate} →{" "}
                        {analytics.summary.lastDate}
                    </span>
                </div>
                <Sparkline
                    data={analytics.timeline.map((p) => p.anomaly)}
                    height={30}
                    accent={accent}
                    ariaLabel="Dataset anomaly timeline"
                />
                <div className="mt-1 flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.1em] text-slate-500">
                    <span>{analytics.summary.rowCount} monthly obs</span>
                    <span>
                        {analytics.queryMs > 0
                            ? `query ${fixed(analytics.queryMs, 1)} ms`
                            : "engine warming up"}
                    </span>
                </div>
            </div>

            {region ? (
                <button
                    type="button"
                    onClick={onClearSelection}
                    className="min-h-[44px] w-full rounded-xl border border-white/[0.08] bg-white/[0.03] font-mono text-[9px] uppercase tracking-[0.14em] text-slate-300"
                >
                    Clear selection
                </button>
            ) : null}
        </div>
    );
}
