import {
    ChevronDown,
    Download,
    Github,
    Globe2,
    Gauge,
    Radio,
} from "lucide-react";
import type {
    ScenarioMetrics,
    TelemetryBundle,
    UnitSystem,
} from "@/types/enso";
import { thermalColor } from "@/lib/model";
import { EngineBadge } from "@/components/EngineBadge";
import { ResetViewButton } from "@/components/ResetViewButton";

interface HeaderProps {
    metrics: ScenarioMetrics;
    units: UnitSystem;
    onToggleUnits: () => void;
    onExportPng: () => void;
    onOpenReport: () => void;
    exporting: boolean;
    /** Clear the region selection — the drawer X / Escape path, driven by the Reset control. */
    onClearSelection: () => void;
    telemetry?: TelemetryBundle | null;
}

export function Header({
    metrics,
    units,
    onToggleUnits,
    onExportPng,
    onOpenReport,
    exporting,
    onClearSelection,
    telemetry,
}: HeaderProps) {
    const alertColor = thermalColor(metrics.sst, 0.95);
    const isAlert = metrics.sst >= 1.5;
    const isLive = telemetry?.tao.status === "active";

    return (
        <header
            data-occluder="top-panel"
            className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-4 p-4 sm:p-6"
        >
            {/* Identity + live badge */}
            <div className="pointer-events-auto flex flex-col gap-2.5">
                <div className="flex items-center gap-3">
                    <div className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-sky-300/25 bg-sky-400/10">
                        <Globe2 className="text-sky-300" size={18} />
                        <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                    </div>
                    <div>
                        <h1 className="text-[15px] font-semibold leading-none tracking-[-0.01em] text-slate-50">
                            Super El&nbsp;Niño{" "}
                            <span className="font-normal text-slate-400">
                                Global Impact Simulator
                            </span>
                        </h1>
                        <p className="mt-1 hidden text-[10px] tracking-[0.02em] text-slate-500 sm:block">
                            Interactive teleconnection model · R3F + DuckDB-WASM
                        </p>
                    </div>
                </div>

                {/*
                    The status pill is static — no breathing halo, so nothing competes with the
                    live telemetry pulse beside it. Under an alert it carries a fixed orange glow
                    instead, which keeps it the loudest element in the header without animating.
                    The glow is a box-shadow rather than a border colour so the
                    `transition-colors` hand-off between tiers stays intact.
                */}
                <div
                    className={[
                        "pointer-events-auto inline-flex w-fit items-center gap-2 rounded-full border px-2.5 py-1 backdrop-blur-md transition-colors duration-500",
                        isAlert
                            ? "border-orange-400/30 bg-orange-500/10 text-orange-300 shadow-[0_0_12px_-2px_rgba(251,146,60,0.25)]"
                            : "border-sky-300/20 bg-sky-400/[0.07] text-slate-200",
                    ].join(" ")}
                >
                    <span className="relative flex h-1.5 w-1.5">
                        <span
                            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                            style={{ background: alertColor }}
                        />
                        <span
                            className="relative inline-flex h-1.5 w-1.5 rounded-full"
                            style={{ background: alertColor }}
                        />
                    </span>
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.16em]">
                        ENSO Alert: {metrics.riskTier}
                    </span>
                    <span className="hidden h-2.5 w-px bg-white/15 sm:block" />
                    {isLive ? (
                        <span className="hidden items-center gap-1 text-[9px] uppercase tracking-[0.12em] text-emerald-400 sm:inline-flex">
                            <Radio size={9} className="animate-pulse" />
                            Live NOAA Telemetry
                        </span>
                    ) : (
                        <span className="hidden text-[9px] uppercase tracking-[0.12em] text-slate-500 sm:block">
                            NOAA Diagnostic Model
                        </span>
                    )}
                </div>
            </div>

            {/* Controls */}
            <div className="pointer-events-auto flex items-center gap-1.5">
                <div className="hidden md:flex">
                    <EngineBadge />
                </div>

                <div className="flex items-center overflow-hidden rounded-full border border-white/[0.08] bg-black/40 p-0.5 backdrop-blur-md">
                    {(["metric", "imperial"] as const).map((system) => (
                        <button
                            key={system}
                            type="button"
                            onClick={onToggleUnits}
                            className={[
                                "rounded-full px-2.5 py-[3px] font-mono text-[9px] uppercase tracking-[0.12em] transition-all duration-200",
                                units === system
                                    ? "bg-white/12 text-slate-50 shadow-sm"
                                    : "text-slate-500 hover:text-slate-300",
                            ].join(" ")}
                            aria-pressed={units === system}
                        >
                            {system === "metric" ? "°C" : "°F"}
                        </button>
                    ))}
                </div>

                <a
                    href="https://github.com/tariq-k-dev"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="hidden items-center justify-center rounded-full border border-white/[0.08] bg-black/40 p-2 text-slate-400 backdrop-blur-md transition-colors hover:text-slate-100 sm:flex"
                    aria-label="GitHub profile"
                >
                    <Github size={13} />
                </a>

                <div className="group relative">
                    <button
                        type="button"
                        disabled={exporting}
                        className="peer flex items-center gap-1.5 rounded-full border border-sky-300/25 bg-sky-400/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-sky-100 backdrop-blur-md transition-all duration-300 hover:border-sky-300/45 hover:bg-sky-400/18 disabled:opacity-50"
                    >
                        {exporting ? (
                            <Gauge size={12} className="animate-pulse" />
                        ) : (
                            <Download size={12} />
                        )}
                        <span className="hidden sm:inline">
                            {exporting ? "Rendering…" : "Snapshot"}
                        </span>
                        <ChevronDown
                            size={12}
                            className="opacity-70 transition-transform group-focus-within:rotate-180 group-hover:rotate-180"
                        />
                    </button>
                    <div className="invisible absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-white/10 bg-slate-900/95 p-1 opacity-0 shadow-xl backdrop-blur-md transition-all duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                        <button
                            type="button"
                            onClick={onExportPng}
                            disabled={exporting}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-slate-200 transition-colors hover:bg-slate-800/80 disabled:opacity-50"
                        >
                            <Download size={12} />
                            Download PNG Card (1920×1080)
                        </button>
                        <button
                            type="button"
                            onClick={onOpenReport}
                            disabled={exporting}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-slate-200 transition-colors hover:bg-slate-800/80 disabled:opacity-50"
                        >
                            <Globe2 size={12} />
                            Open Diagnostic Report
                        </button>
                    </div>
                </div>

                <ResetViewButton onClearSelection={onClearSelection} />
            </div>
        </header>
    );
}
