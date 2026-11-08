import { useEffect, useMemo, useRef } from "react";
import { Activity, Gauge, Waves, X } from "lucide-react";
import type {
    AnalyticsPayload,
    RegionDefinition,
    RegionId,
    ScenarioMetrics,
} from "@/types/enso";
import { Stat } from "@/components/ui/Stat";
import { MetricBar } from "@/components/ui/MetricBar";
import { Sparkline } from "@/components/ui/Sparkline";
import { REGIONS, deltaDisplay, formatDelta } from "@/lib/regions";
import { thermalColor } from "@/lib/model";
import { fixed } from "@/lib/format";

interface RegionDrawerProps {
    region: RegionDefinition | null;
    metrics: ScenarioMetrics;
    analytics: AnalyticsPayload;
    units: "metric" | "imperial";
    onClose: () => void;
    /**
     * Retarget the selection — the SAME `selectRegion` the Impact Zones cards and the pins call.
     *
     * Not a close, not a new selection path: the switcher exists so a reader who is already in the drawer
     * can move to another region without leaving it, and routing it through `selectRegion` is what keeps
     * the camera, the machine and the cards agreeing about which region is active.
     */
    onSelect: (id: RegionId) => void;
}

interface RegionHud {
    headline: { label: string; value: string; unit: string };
    stats: Array<{
        label: string;
        value: string;
        unit: string;
        hint?: string;
        accent: string;
    }>;
    bars: Array<{
        label: string;
        value: number;
        accent: string;
        divergent?: boolean;
    }>;
    narrative: string;
    footprint: number;
}

function buildHud(
    id: RegionId,
    m: ScenarioMetrics,
    units: "metric" | "imperial",
): RegionHud {
    switch (id) {
        case "pacific": {
            const dev = deltaDisplay(m.pacificSstDev, units);
            const basin = deltaDisplay(m.sst, units);
            return {
                headline: {
                    label: "SST Deviation",
                    value: `${dev.value >= 0 ? "+" : ""}${fixed(dev.value, 2)}`,
                    unit: dev.unit,
                },
                stats: [
                    {
                        label: "Convection Shift",
                        value: fixed(m.pacificConvection, 0),
                        unit: "/100",
                        accent: "#38bdf8",
                    },
                    {
                        label: "Walker Displacement",
                        value:
                            m.pacificConvection > 60
                                ? "Severe"
                                : m.pacificConvection > 35
                                  ? "Moderate"
                                  : "Weak",
                        unit: "",
                        accent: "#38bdf8",
                    },
                    {
                        label: "Basin Anomaly",
                        value: fixed(basin.value, 2),
                        unit: basin.unit,
                        accent: "#38bdf8",
                    },
                ],
                bars: [
                    {
                        label: "Convection displacement",
                        value: m.pacificConvection,
                        accent: "#38bdf8",
                    },
                    {
                        label: "SST stress vs. 1.0°C threshold",
                        value: Math.min(100, (m.pacificSstDev / 3.45) * 100),
                        accent: "#22d3ee",
                    },
                ],
                narrative:
                    m.sst >= 2
                        ? "Deep convection has migrated fully east of the dateline. The Walker circulation is inverted — expect record basin-wide warming and a strongly coupled atmosphere-ocean state."
                        : "Warm water is pooling eastward but the coupling is still partial. Trade winds have weakened without fully reversing.",
                footprint: m.pacificConvection,
            };
        }
        case "us-west":
            return {
                headline: {
                    label: "Precip Change",
                    value: formatDelta(m.usPrecip, "%"),
                    unit: "",
                },
                stats: [
                    {
                        // A deviation, not an absolute reading — see deltaDisplay().
                        label: "Temp Deviation",
                        value: (() => {
                            const d = deltaDisplay(
                                m.usTempDevF * (5 / 9),
                                units,
                            );
                            return `${d.value >= 0 ? "+" : ""}${fixed(d.value, 1)}`;
                        })(),
                        unit: units === "imperial" ? "°F" : "°C",
                        accent: "#a78bfa",
                    },
                    {
                        label: "Base Precip Model",
                        value: formatDelta(m.usPrecipBase, "%"),
                        unit: "",
                        accent: "#a78bfa",
                    },
                    {
                        label: "Jet Contribution",
                        value: formatDelta(m.usPrecip - m.usPrecipBase, "%"),
                        unit: "",
                        accent: "#c4b5fd",
                    },
                ],
                bars: [
                    {
                        label: "Precipitation anomaly",
                        value: m.usPrecip,
                        accent: "#a78bfa",
                        divergent: true,
                    },
                    {
                        label: "Snowpack / reservoir recharge proxy",
                        value: Math.min(100, Math.max(0, m.usPrecip * 1.1)),
                        accent: "#8b5cf6",
                    },
                ],
                narrative:
                    m.usPrecip > 45
                        ? "An atmospheric-river pattern is locked in. Flood control and reservoir operations become the binding constraint, not water supply."
                        : m.usPrecip > 15
                          ? "A wet signal dominates, concentrated in a handful of high-intensity events rather than steady seasonal rainfall."
                          : "The jet has not displaced far enough south to deliver a clear wet signal to California.",
                footprint: Math.abs(m.usPrecip),
            };
        case "se-asia":
            return {
                headline: {
                    label: "Precip Change",
                    value: formatDelta(m.asiaPrecip, "%"),
                    unit: "",
                },
                stats: [
                    {
                        label: "Drought Index",
                        value: fixed(m.asiaDrought, 2),
                        unit: "/10",
                        accent: "#fb923c",
                    },
                    {
                        label: "Monsoon Deficit",
                        value: `${fixed(Math.min(100, Math.abs(m.asiaPrecip)), 0)}`,
                        unit: "%",
                        accent: "#fb923c",
                    },
                    {
                        label: "Fire Weather",
                        value:
                            m.asiaDrought > 6
                                ? "Extreme"
                                : m.asiaDrought > 3
                                  ? "Elevated"
                                  : "Normal",
                        unit: "",
                        accent: "#f97316",
                    },
                ],
                bars: [
                    {
                        label: "Precipitation anomaly",
                        value: m.asiaPrecip,
                        accent: "#fb923c",
                        divergent: true,
                    },
                    {
                        label: "Drought severity",
                        value: (m.asiaDrought / 10) * 100,
                        accent: "#f97316",
                    },
                ],
                narrative:
                    m.asiaDrought > 6
                        ? "The Maritime Continent is drying hard. Peatland fire risk and transboundary haze become the dominant regional hazards."
                        : "Rainfall is suppressed but groundwater buffers are still absorbing the deficit.",
                footprint: Math.abs(m.asiaPrecip),
            };
        case "horn-africa":
            return {
                headline: {
                    label: "Precip Change",
                    value: formatDelta(m.africaPrecip, "%"),
                    unit: "",
                },
                stats: [
                    {
                        label: "Flood Index",
                        value: fixed(m.africaFlood, 2),
                        unit: "/10",
                        accent: "#34d399",
                    },
                    {
                        label: "Short-Rains Surplus",
                        value: `+${fixed(Math.max(0, m.africaPrecip), 0)}`,
                        unit: "%",
                        accent: "#34d399",
                    },
                    {
                        label: "Displacement Risk",
                        value:
                            m.africaFlood > 5
                                ? "High"
                                : m.africaFlood > 2.5
                                  ? "Moderate"
                                  : "Low",
                        unit: "",
                        accent: "#10b981",
                    },
                ],
                bars: [
                    {
                        label: "Precipitation anomaly",
                        value: m.africaPrecip,
                        accent: "#34d399",
                        divergent: true,
                    },
                    {
                        label: "Flood severity",
                        value: (m.africaFlood / 10) * 100,
                        accent: "#10b981",
                    },
                ],
                narrative:
                    m.africaFlood > 5
                        ? "Short-rains totals are overwhelming arid catchments. Riverine flooding and vector-borne disease risk both spike."
                        : "Moisture flux is above normal but within the range dryland infrastructure can usually absorb.",
                footprint: m.africaFlood * 10,
            };
        case "amazon-basin":
            return {
                headline: {
                    label: "Precip Change",
                    value: formatDelta(m.amazonPrecip, "%"),
                    unit: "",
                },
                stats: [
                    {
                        label: "Drought Index",
                        value: fixed(m.amazonDrought, 2),
                        unit: "/10",
                        accent: "#22c55e",
                    },
                    {
                        label: "Rainfall Deficit",
                        value: `${fixed(Math.min(100, Math.abs(m.amazonPrecip)), 0)}`,
                        unit: "%",
                        accent: "#22c55e",
                    },
                    {
                        label: "Fire Weather",
                        value:
                            m.amazonDrought > 5
                                ? "Extreme"
                                : m.amazonDrought > 2.5
                                  ? "Elevated"
                                  : "Normal",
                        unit: "",
                        accent: "#16a34a",
                    },
                ],
                bars: [
                    {
                        label: "Precipitation anomaly",
                        value: m.amazonPrecip,
                        accent: "#22c55e",
                        divergent: true,
                    },
                    {
                        label: "Drought severity",
                        value: (m.amazonDrought / 10) * 100,
                        accent: "#16a34a",
                    },
                ],
                narrative:
                    m.amazonDrought > 5
                        ? "Rainfall deficits are deep enough to push the canopy past its buffering capacity. Fire risk and carbon loss climb together."
                        : "Throughfall is suppressed but the forest is still drawing on stored soil moisture.",
                footprint: Math.abs(m.amazonPrecip),
            };
        case "gulf-coast":
            return {
                headline: {
                    label: "Precip Change",
                    value: formatDelta(m.gulfPrecip, "%"),
                    unit: "",
                },
                stats: [
                    {
                        label: "Winter Surplus",
                        value: `+${fixed(Math.max(0, m.gulfPrecip), 0)}`,
                        unit: "%",
                        accent: "#0ea5e9",
                    },
                    {
                        label: "Wind Shear",
                        value:
                            m.gulfPrecip > 20
                                ? "Strong"
                                : m.gulfPrecip > 12
                                  ? "Moderate"
                                  : "Weak",
                        unit: "",
                        accent: "#0ea5e9",
                    },
                    {
                        label: "Flood Risk",
                        value:
                            m.gulfPrecip > 25
                                ? "High"
                                : m.gulfPrecip > 15
                                  ? "Moderate"
                                  : "Low",
                        unit: "",
                        accent: "#0284c7",
                    },
                ],
                bars: [
                    {
                        label: "Precipitation anomaly",
                        value: m.gulfPrecip,
                        accent: "#0ea5e9",
                        divergent: true,
                    },
                    {
                        label: "Hurricane suppression proxy",
                        value: Math.min(100, Math.max(0, m.gulfPrecip * 2)),
                        accent: "#0284c7",
                    },
                ],
                narrative:
                    m.gulfPrecip > 25
                        ? "A strengthened subtropical jet is delivering repeated winter rain events while shear keeps tropical systems from organising."
                        : "Winter rainfall is running above normal, with a corresponding drop in tropical cyclone activity.",
                footprint: Math.abs(m.gulfPrecip),
            };
    }
}

export function RegionDrawer({
    region,
    metrics,
    analytics,
    units,
    onClose,
    onSelect,
}: RegionDrawerProps) {
    const panelRef = useRef<HTMLElement>(null);
    const open = region !== null;
    const hud = useMemo(
        () => (region ? buildHud(region.id, metrics, units) : null),
        [region, metrics, units],
    );

    // Esc to close — the drawer covers a lot of the viewport, so a keyboard exit
    // is not optional.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    const accent = region?.accent ?? "#38bdf8";
    const intensityColor = thermalColor(metrics.sst, 0.95);

    const analogSpark = analytics.timeline.map((p) => p.anomaly);

    return (
        <aside
            ref={panelRef}
            // `data-occluder` marks the drawer for the insets registry (step C). Closed, it sits
            // off-canvas via translate-x-[110%], so its rect does not overlap the canvas and the
            // registry contributes nothing — from geometry, not from a special case.
            data-occluder="right-drawer"
            aria-hidden={!open}
            aria-label={
                region
                    ? `${region.name} impact analysis`
                    : "Region impact analysis"
            }
            className={[
                "pointer-events-none absolute bottom-0 right-0 top-0 z-30 flex w-full max-w-[418px] flex-col",
                // Top padding clears the header's control row so neither overlaps.
                "p-3 sm:px-4 sm:pb-4 sm:pt-[76px]",
                "transition-transform duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]",
                open ? "translate-x-0" : "translate-x-[110%]",
            ].join(" ")}
        >
            <div className="glass pointer-events-auto flex h-full flex-col overflow-hidden rounded-2xl">
                {/* Header */}
                <div className="relative shrink-0 overflow-hidden border-b border-white/[0.08] px-4 pb-3.5 pt-4">
                    <div
                        className="absolute inset-x-0 top-0 h-[2px]"
                        style={{
                            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
                        }}
                    />
                    <div
                        className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-[0.14] blur-2xl"
                        style={{ background: accent }}
                    />

                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="mb-1 flex items-center gap-1.5">
                                <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{
                                        background: accent,
                                        boxShadow: `0 0 8px ${accent}`,
                                    }}
                                />
                                <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-slate-400">
                                    Impact Zone · {fixed(region?.lat ?? 0, 0)}°
                                    {region && region.lat >= 0 ? "N" : "S"}{" "}
                                    {fixed(Math.abs(region?.lon ?? 0), 0)}°
                                    {region && region.lon >= 0 ? "E" : "W"}
                                </span>
                            </div>
                            <h2 className="truncate text-[17px] font-semibold leading-tight tracking-[-0.015em] text-slate-50">
                                {region?.name ?? "—"}
                            </h2>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="shrink-0 rounded-full border border-white/[0.08] p-1.5 text-slate-400 transition-colors hover:border-white/20 hover:text-slate-100"
                            aria-label="Close region panel"
                        >
                            <X size={13} />
                        </button>
                    </div>

                    {/* Headline metric */}
                    {hud ? (
                        <div className="relative mt-3 overflow-hidden rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2.5">
                            <div className="flex items-end justify-between">
                                <div>
                                    <div className="text-[8.5px] uppercase tracking-[0.18em] text-slate-500">
                                        {hud.headline.label}
                                    </div>
                                    <div className="mt-0.5 flex items-baseline gap-1">
                                        <span
                                            className="num text-[30px] font-semibold leading-none tracking-[-0.045em]"
                                            style={{ color: accent }}
                                        >
                                            {hud.headline.value}
                                        </span>
                                        <span className="num text-[11px] text-slate-400">
                                            {hud.headline.unit}
                                        </span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-[8.5px] uppercase tracking-[0.18em] text-slate-500">
                                        Signal
                                    </div>
                                    <div
                                        className="num mt-0.5 text-[10px] font-medium"
                                        style={{ color: intensityColor }}
                                    >
                                        {metrics.riskTier}
                                    </div>
                                </div>
                            </div>
                            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
                                <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                        width: `${Math.min(100, hud.footprint)}%`,
                                        background: `linear-gradient(90deg, ${accent}66, ${accent})`,
                                        boxShadow: `0 0 14px -2px ${accent}`,
                                    }}
                                />
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* ------------------------------------------------------------------ switcher */}
                {/*
          Region switcher — a compact row of one native button per region, so a reader inside the drawer can
          move to another region without closing it, dragging the globe, or hunting for the Impact Zones
          cards behind the panel.

          DESIGN CONSTRAINTS, each of which is the reason a class here looks the way it does:

          - **After the close button in DOM order, before the body.** It is a `shrink-0` sibling of the
            scrolling body rather than its first child, so the extra height is absorbed by the body
            (`flex-1 overflow-y-auto`) and the PANEL's own box is untouched. Measured before writing it:
            the body already scrolls at both spec viewports (783 px of content in 613 px at 1440x900 and in
            433 px at 1280x720), so adding a row cannot introduce a scrollbar that was not there and cannot
            change the wrapper rect, the panel rect or the 418 px right inset.
          - **`flex-wrap`, never `nowrap`.** Four chips at ~90 px plus gaps exceed the 384 px content width
            at the narrowest panel, so the row wraps to a second line instead of overflowing horizontally.
            `overflow-x: hidden` is not used: wrapping is what makes horizontal scroll impossible, and a
            hidden overflow would clip a long label silently.
          - **The active chip is `aria-current` and visually distinct**, and clicking it does NOTHING. The
            no-op is enforced here rather than in `App.selectRegion`, because `selectRegion` deliberately
            re-centres on a repeat click (`App.tsx:31-36` bumps `focusNonce`) — that is the right behaviour
            for the cards and the pins, and the wrong one for a row whose only job is to move to a
            different region.
          - **`tabIndex={-1}` when the drawer is closed.** The drawer is never unmounted; closed, it sits
            off-canvas at `translate-x-[110%]` with `aria-hidden`. The close button is already such a node
            (pre-existing), but a new control must not add four more tab stops in an off-canvas panel.
        */}
                <div
                    className="shrink-0 border-b border-white/[0.08] px-4 pb-2.5 pt-0.5"
                    data-testid="drawer-switcher"
                    role="group"
                    aria-label="Switch impact region"
                >
                    <div className="flex flex-wrap gap-1.5">
                        {REGIONS.map((r) => {
                            const isActive = region?.id === r.id;
                            return (
                                <button
                                    key={r.id}
                                    type="button"
                                    // The ids and labels come from the same `REGIONS` source the cards map over, so the two
                                    // lists cannot drift apart.
                                    data-region-id={r.id}
                                    aria-current={isActive ? "true" : undefined}
                                    tabIndex={open ? 0 : -1}
                                    onClick={() => {
                                        if (isActive) return;
                                        onSelect(r.id);
                                    }}
                                    className={[
                                        "rounded-full border px-2 py-1 font-mono text-[8.5px] uppercase tracking-[0.12em] transition-colors duration-200",
                                        "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                                        isActive
                                            ? "border-white/35 bg-white/12 text-white"
                                            : "border-white/[0.1] bg-black/25 text-slate-400 hover:border-white/25 hover:text-slate-100",
                                    ].join(" ")}
                                    style={
                                        isActive
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
                </div>

                {/* Scrollable body */}
                <div className="scroll-thin flex-1 overflow-y-auto overscroll-contain px-4 py-3.5">
                    {hud && region ? (
                        <div className="space-y-4">
                            <p className="text-[11.5px] leading-relaxed text-slate-300/90">
                                {region.summary}
                            </p>

                            {/* Stat trio */}
                            <div className="grid grid-cols-3 gap-2.5">
                                {hud.stats.map((s) => (
                                    <Stat
                                        key={s.label}
                                        label={s.label}
                                        value={s.value}
                                        unit={s.unit}
                                        accent={s.accent}
                                        size="sm"
                                    />
                                ))}
                            </div>

                            <div className="hairline h-px w-full" />

                            {/* Anomaly bars */}
                            <div>
                                <div className="mb-2 flex items-center gap-1.5">
                                    <Gauge
                                        size={10}
                                        className="text-slate-500"
                                    />
                                    <span className="text-[8.5px] uppercase tracking-[0.2em] text-slate-500">
                                        Model Output
                                    </span>
                                </div>
                                <div className="space-y-2.5">
                                    {hud.bars.map((b) => (
                                        <MetricBar
                                            key={b.label}
                                            label={b.label}
                                            value={b.value}
                                            accent={b.accent}
                                            divergent={b.divergent}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Mechanism */}
                            <div className="rounded-xl border border-white/[0.06] bg-white/[0.018] p-3">
                                <div className="mb-1.5 flex items-center gap-1.5">
                                    <Activity
                                        size={10}
                                        style={{ color: accent }}
                                    />
                                    <span className="text-[8.5px] uppercase tracking-[0.18em] text-slate-500">
                                        Mechanism
                                    </span>
                                </div>
                                <p className="text-[10.5px] leading-relaxed text-slate-400">
                                    {region.mechanism}
                                </p>
                                <p className="mt-2 border-t border-white/[0.05] pt-2 text-[10.5px] leading-relaxed text-slate-300/85">
                                    {hud.narrative}
                                </p>
                            </div>

                            {/* Historical analogs */}
                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <Waves
                                            size={10}
                                            className="text-slate-500"
                                        />
                                        <span className="text-[8.5px] uppercase tracking-[0.2em] text-slate-500">
                                            Historical Analogs
                                        </span>
                                    </div>
                                    <span className="num text-[8.5px] text-slate-500">
                                        {analytics.summary.analogCount} months
                                        within ±0.35°C
                                    </span>
                                </div>

                                {analytics.analogs.length > 0 ? (
                                    <div className="overflow-hidden rounded-xl border border-white/[0.06]">
                                        <table className="w-full border-collapse text-left">
                                            <thead>
                                                <tr className="border-b border-white/[0.06] bg-white/[0.025]">
                                                    {[
                                                        "Month",
                                                        "N3.4 anom",
                                                        "SST",
                                                        "Δ",
                                                        "Tier",
                                                    ].map((h) => (
                                                        <th
                                                            key={h}
                                                            className="px-2 py-1.5 text-[8px] font-medium uppercase tracking-[0.12em] text-slate-500"
                                                        >
                                                            {h}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {analytics.analogs
                                                    .slice(0, 5)
                                                    .map((a) => (
                                                        <tr
                                                            key={a.date}
                                                            className="border-b border-white/[0.035] last:border-0 hover:bg-white/[0.03]"
                                                        >
                                                            <td className="num px-2 py-1.5 text-[10px] text-slate-300">
                                                                {a.label}
                                                            </td>
                                                            <td className="num px-2 py-1.5 text-[10px] text-slate-100">
                                                                {fixed(
                                                                    a.anomaly,
                                                                    2,
                                                                )}
                                                            </td>
                                                            <td className="num px-2 py-1.5 text-[9.5px] text-slate-400">
                                                                {a.absoluteSst >
                                                                0
                                                                    ? fixed(
                                                                          a.absoluteSst,
                                                                          1,
                                                                      )
                                                                    : "—"}
                                                            </td>
                                                            <td className="num px-2 py-1.5 text-[9.5px] text-slate-500">
                                                                ±
                                                                {fixed(
                                                                    a.delta,
                                                                    2,
                                                                )}
                                                            </td>
                                                            <td className="px-2 py-1.5">
                                                                <span
                                                                    className="rounded-full px-1.5 py-[1px] text-[8px] font-medium"
                                                                    style={{
                                                                        background: `${thermalColor(a.anomaly, 0.14)}`,
                                                                        color: thermalColor(
                                                                            a.anomaly,
                                                                            0.95,
                                                                        ),
                                                                    }}
                                                                >
                                                                    {a.riskTier}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[10px] text-slate-500">
                                        Analog matching unavailable — DuckDB
                                        engine is not running.
                                    </div>
                                )}
                            </div>

                            {/* Dataset footer */}
                            <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2.5">
                                <div className="mb-1 flex items-center justify-between">
                                    <span className="text-[8px] uppercase tracking-[0.14em] text-slate-500">
                                        Dataset window
                                    </span>
                                    <span className="num text-[8.5px] text-slate-400">
                                        {analytics.summary.firstDate} →{" "}
                                        {analytics.summary.lastDate}
                                    </span>
                                </div>
                                <Sparkline
                                    data={analogSpark}
                                    height={30}
                                    accent={accent}
                                    ariaLabel="Dataset anomaly timeline"
                                />
                                <div className="mt-1 flex items-center justify-between text-[8px] uppercase tracking-[0.1em] text-slate-500">
                                    <span>
                                        {analytics.summary.rowCount} monthly obs
                                    </span>
                                    <span>
                                        peak{" "}
                                        {fixed(analytics.summary.maxAnomaly, 2)}
                                        °C · {analytics.summary.maxAnomalyDate}
                                    </span>
                                </div>
                                {/* Provenance: a reader must be able to tell observed from modelled. */}
                                <div className="mt-1.5 flex items-start gap-1 border-t border-white/[0.05] pt-1.5">
                                    <span className="mt-[2px] h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                                    <span className="text-[8px] leading-snug text-slate-500">
                                        <span className="text-slate-400">
                                            {analytics.summary.source}
                                        </span>{" "}
                                        — SST observed · regional impact
                                        modelled
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* Footer CTA */}
                <div className="shrink-0 border-t border-white/[0.07] px-4 py-2.5">
                    <div className="flex items-center justify-between">
                        <span className="num text-[8.5px] uppercase tracking-[0.12em] text-slate-500">
                            {analytics.queryMs > 0
                                ? `query ${fixed(analytics.queryMs, 1)} ms`
                                : "engine warming up"}
                        </span>
                        <span className="flex items-center gap-1 text-[8.5px] uppercase tracking-[0.12em] text-slate-500">
                            <span className="h-1 w-1 rounded-full bg-emerald-400" />
                            local · no server
                        </span>
                    </div>
                </div>
            </div>
        </aside>
    );
}
