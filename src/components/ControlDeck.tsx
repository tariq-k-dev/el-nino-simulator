import {
    CircleDot,
    Radio,
    RotateCcw,
    ThermometerSun,
    Waves,
    Wheat,
    Wind,
} from "lucide-react";
import type {
    ScenarioState,
    ScenarioMetrics,
    TelemetryBundle,
} from "@/types/enso";
import { Slider } from "@/components/ui/Slider";
import { Sparkline } from "@/components/ui/Sparkline";
import type { HistoryState } from "@/state/useEngine";
import { thermalColor, SST_MAX, SST_MIN } from "@/lib/model";
import { fixed } from "@/lib/format";
import { deltaDisplay } from "@/lib/regions";

interface ControlDeckProps {
    scenario: ScenarioState;
    metrics: ScenarioMetrics;
    timeline: number[];
    history: HistoryState;
    onRetryHistory: () => void;
    onChange: (patch: Partial<ScenarioState>) => void;
    onReset: () => void;
    telemetry?: TelemetryBundle | null;
    onApplyLiveTelemetry?: () => void;
    units?: "metric" | "imperial";
}

const RISK_STOPS = [
    { at: 0.0, label: "Neutral" },
    { at: 1.0, label: "Moderate" },
    { at: 2.0, label: "Strong" },
    { at: 3.0, label: "Mega" },
];

export function ControlDeck({
    scenario,
    metrics,
    timeline,
    history,
    onRetryHistory,
    onChange,
    onReset,
    telemetry,
    onApplyLiveTelemetry,
    units = "metric",
}: ControlDeckProps) {
    const accent = thermalColor(metrics.sst, 0.95);
    const isLiveAvailable = telemetry?.tao.status === "active";
    const isCurrentlyLive =
        isLiveAvailable &&
        Math.abs(scenario.sstAnomaly - (telemetry?.tao.anomaly ?? 0)) < 0.005;
    const anomalyDisplay = deltaDisplay(scenario.sstAnomaly, units);

    return (
        <div className="pointer-events-auto w-full max-w-[352px]">
            <div className="glass overflow-hidden rounded-2xl">
                {/* Header strip */}
                <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
                    <div className="flex items-center gap-2">
                        <CircleDot size={11} style={{ color: accent }} />
                        <span className="text-[9.5px] font-medium uppercase tracking-[0.18em] text-slate-300">
                            Scenario Engine
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {isLiveAvailable && (
                            <button
                                type="button"
                                onClick={onApplyLiveTelemetry}
                                className={[
                                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-[8.5px] uppercase tracking-[0.1em] transition-all",
                                    isCurrentlyLive
                                        ? "border border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
                                        : "border border-white/10 bg-white/[0.04] text-slate-400 hover:border-emerald-400/30 hover:text-emerald-300",
                                ].join(" ")}
                                title="Sync scenario slider to live NOAA TAO observation"
                            >
                                <Radio
                                    size={9}
                                    className={
                                        isCurrentlyLive
                                            ? "animate-pulse text-emerald-400"
                                            : ""
                                    }
                                />
                                Live NOAA
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onReset}
                            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-slate-500 transition-colors hover:text-slate-200"
                            title="Reset to Super El Niño baseline"
                        >
                            <RotateCcw size={9} />
                            Reset
                        </button>
                    </div>
                </div>

                <div className="space-y-4 px-4 pb-4 pt-3.5">
                    {/* Primary lever */}
                    <div>
                        <div className="mb-2 flex items-end justify-between">
                            <div className="flex items-center gap-1.5">
                                <ThermometerSun
                                    size={11}
                                    className="text-slate-400"
                                />
                                <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-300">
                                    Global SST Anomaly
                                </span>
                                {isCurrentlyLive && (
                                    <span className="rounded bg-emerald-400/15 px-1 py-[1px] font-mono text-[7.5px] font-medium uppercase tracking-wider text-emerald-300">
                                        Live
                                    </span>
                                )}
                            </div>
                            <div className="text-right leading-none">
                                <span
                                    className="num text-[22px] font-semibold tracking-[-0.04em]"
                                    style={{ color: accent }}
                                >
                                    {fixed(anomalyDisplay.value, 2)}
                                </span>
                                <span className="num ml-0.5 text-[10px] text-slate-400">
                                    {anomalyDisplay.unit}
                                </span>
                            </div>
                        </div>

                        <Slider
                            label=""
                            value={scenario.sstAnomaly}
                            min={SST_MIN}
                            max={SST_MAX}
                            step={0.01}
                            accent={accent}
                            onChange={(v) => onChange({ sstAnomaly: v })}
                            markers={RISK_STOPS}
                            scale={["Neutral", "Mega El Niño"]}
                        />

                        {/* Historical context strip */}
                        <div className="relative mt-2.5 overflow-hidden rounded-lg border border-white/[0.05] bg-black/25 px-2 pb-1 pt-1.5">
                            <div className="mb-0.5 flex items-center justify-between">
                                <span className="text-[8px] uppercase tracking-[0.14em] text-slate-500">
                                    Niño 3.4 · observed record
                                </span>
                                {history.status === "ready" ? (
                                    <span className="num text-[8px] text-slate-500">
                                        {timeline.length} mo
                                    </span>
                                ) : (
                                    <span className="num text-[8px] text-slate-600">
                                        —
                                    </span>
                                )}
                            </div>

                            {history.status === "unavailable" ? (
                                <button
                                    type="button"
                                    onClick={onRetryHistory}
                                    className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md border border-amber-400/25 bg-amber-400/[0.06] text-[10px] font-medium text-amber-200 transition-colors hover:border-amber-400/40 hover:bg-amber-400/10"
                                >
                                    <RotateCcw size={11} />
                                    History unavailable · Retry
                                </button>
                            ) : timeline.length === 0 ? (
                                <div className="flex h-[34px] items-center justify-center">
                                    <span className="h-[2px] w-24 animate-pulse rounded-full bg-sky-400/40" />
                                </div>
                            ) : (
                                <Sparkline
                                    data={timeline}
                                    height={34}
                                    accent="#38bdf8"
                                    markerValue={scenario.sstAnomaly}
                                    ariaLabel="Historical Niño 3.4 anomaly record with current scenario marker"
                                />
                            )}
                        </div>
                    </div>

                    <div className="hairline h-px w-full" />

                    {/* Secondary levers */}
                    <div className="space-y-3.5">
                        <div className="flex items-center gap-1.5">
                            <Waves size={10} className="text-slate-500" />
                            <span className="text-[8.5px] uppercase tracking-[0.2em] text-slate-500">
                                Teleconnection modifiers
                            </span>
                        </div>

                        <Slider
                            label="Jet Stream Displacement"
                            value={scenario.jetStreamShift}
                            min={-1}
                            max={1}
                            step={0.01}
                            accent="#a78bfa"
                            onChange={(v) => onChange({ jetStreamShift: v })}
                            format={(v) =>
                                v >= 0 ? `+${fixed(v, 2)}` : fixed(v, 2)
                            }
                            hint="Negative = equatorward, positive = poleward displacement"
                        />

                        <Slider
                            label="Agriculture Vulnerability"
                            value={scenario.agricultureWeight}
                            min={0}
                            max={1}
                            step={0.01}
                            accent="#34d399"
                            onChange={(v) => onChange({ agricultureWeight: v })}
                            format={(v) => `${Math.round(v * 100)}`}
                            unit="%"
                            hint="Cropland share exposed to the regional precip anomaly"
                        />
                    </div>

                    {/* Live composite readout */}
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                            <div className="flex items-center gap-1">
                                <Wind size={9} className="text-sky-400/70" />
                                <span className="text-[8px] uppercase tracking-[0.13em] text-slate-500">
                                    Impact Index
                                </span>
                            </div>
                            <div className="num mt-1 text-[17px] font-semibold leading-none text-slate-100">
                                {fixed(metrics.globalImpactIndex, 1)}
                                <span className="ml-0.5 text-[8.5px] font-medium text-slate-500">
                                    /100
                                </span>
                            </div>
                        </div>
                        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                            <div className="flex items-center gap-1">
                                <Wheat
                                    size={9}
                                    className="text-emerald-400/70"
                                />
                                <span className="text-[8px] uppercase tracking-[0.13em] text-slate-500">
                                    Ag Exposure
                                </span>
                            </div>
                            <div className="num mt-1 text-[17px] font-semibold leading-none text-slate-100">
                                {fixed(metrics.agricultureExposure, 0)}
                                <span className="ml-0.5 text-[8.5px] font-medium text-slate-500">
                                    %
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
