/**
 * Snapshot composer.
 *
 * Takes the live WebGL frame and composites it into a fixed 1920×1080 PNG with
 * the scenario's headline numbers, the active region (if any), and a footer
 * carrying provenance. The output is a self-contained "citation shot" — the
 * same one the HTML report embeds, but at a resolution that survives being
 * dropped into a slide deck.
 *
 * ## Why a separate canvas, not the live one
 *
 * The live canvas is sized to the viewport and is the R3F render target. Drawing
 * overlays onto it would (a) be visible to the user, (b) be cleared on the next
 * frame, and (c) require resizing the element, which would break the mobile free
 * rectangle and the desktop insets registry. So the frame is copied into an
 * offscreen canvas at the target resolution and the overlays are drawn there.
 *
 * ## Why `beginPath()` before `roundRect`
 *
 * `roundRect` appends to the current path; without a `beginPath()` the previous
 * path's subpaths are still in the path and `fill()` / `stroke()` paint them
 * too. Every card here begins its own path.
 */

import type {
    RegionDefinition,
    ScenarioMetrics,
    TelemetryBundle,
    UnitSystem,
} from "@/types/enso";
import { thermalColor } from "@/lib/model";
import { fixed } from "@/lib/format";

const OUT_W = 1920;
const OUT_H = 1080;

const CARD_BG = "rgba(10, 16, 26, 0.82)";
const CARD_BORDER = "rgba(56, 189, 248, 0.25)";
const TEXT_PRIMARY = "#f1f5f9";
const TEXT_MUTED = "#94a3b8";
const TEXT_DIM = "#64748b";

/**
 * Per-region numbers for the snapshot's right-hand panel.
 *
 * Mirrors the fields `RegionDrawer.buildHud` reads, but flattened into the
 * shape the composer draws. Regions without a temperature or jet term report
 * `0` for those fields — the composer draws them as `+0.0 °C` / `0.0%`, which
 * is honest: the model genuinely has no such term for them.
 */
export interface SnapshotRegionMetrics {
    precipChange: number;
    tempDeviation: number;
    basePrecip: number;
    jetContribution: number;
    snowpackProxy: number;
    signalTier: string;
}

export interface SnapshotInput {
    /** The live WebGL canvas, already rendered into its drawing buffer. */
    source: HTMLCanvasElement;
    metrics: ScenarioMetrics;
    region: RegionDefinition | null;
    telemetry: TelemetryBundle | null;
    units: UnitSystem;
    /** Per-region numbers for the right-hand panel; null when no region is selected. */
    regionMetrics?: SnapshotRegionMetrics | null;
}

function drawCard(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
): void {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fillStyle = CARD_BG;
    ctx.fill();
    ctx.strokeStyle = CARD_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
): void {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = "500 11px ui-monospace, 'JetBrains Mono', monospace";
    ctx.fillText(text.toUpperCase(), x, y);
}

function drawValue(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
): void {
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = "600 26px ui-monospace, 'JetBrains Mono', monospace";
    ctx.fillText(text, x, y);
}

/**
 * Compose the snapshot and return it as a PNG blob.
 *
 * Rejects if the 2D context cannot be created (extremely rare; a browser with
 * WebGL but no 2D canvas is not a real configuration).
 */
export async function composeSnapshot({
    source,
    metrics,
    region,
    telemetry,
    units,
    regionMetrics,
}: SnapshotInput): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("snapshot: 2D context unavailable");

    // 1. Background: the live frame, scaled to fill. `cover` semantics — the
    //    source is viewport-shaped, the output is 16:9, so crop rather than
    //    letterbox. A letterboxed globe with black bars reads as a bug.
    const srcAspect = source.width / source.height;
    const outAspect = OUT_W / OUT_H;
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;
    if (srcAspect > outAspect) {
        // Source is wider: crop the sides.
        sw = source.height * outAspect;
        sx = (source.width - sw) / 2;
    } else if (srcAspect < outAspect) {
        // Source is taller: crop top/bottom.
        sh = source.width / outAspect;
        sy = (source.height - sh) / 2;
    }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);

    // 2. Header card: title, risk tier, active region.
    const accent = thermalColor(metrics.sst, 0.95);
    drawCard(ctx, 40, 40, 620, 132);
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = "600 22px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillText("Super El Niño Global Impact Simulator", 64, 78);
    ctx.fillStyle = TEXT_MUTED;
    ctx.font = "400 13px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillText(
        region
            ? `Focus: ${region.name}`
            : "Global view · no region selected",
        64,
        102,
    );
    // Risk pill.
    ctx.beginPath();
    ctx.roundRect(64, 118, 168, 30, 15);
    ctx.fillStyle = `${accent}22`;
    ctx.fill();
    ctx.strokeStyle = `${accent}88`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.font = "600 12px ui-monospace, 'JetBrains Mono', monospace";
    ctx.fillText(metrics.riskTier.toUpperCase(), 80, 138);

    // 3. Metrics card: the four headline numbers.
    drawCard(ctx, 40, 196, 620, 200);
    const unitLabel = units === "imperial" ? "°F" : "°C";
    const sstValue =
        units === "imperial"
            ? metrics.sst * 1.8
            : metrics.sst;
    const tempValue =
        units === "imperial"
            ? metrics.usTempDevF
            : (metrics.usTempDevF - 32) / 1.8;

    const cols = [
        {
            label: "Global SST anomaly",
            value: `${sstValue >= 0 ? "+" : ""}${fixed(sstValue, 2)} ${unitLabel}`,
        },
        {
            label: "Pacific convection",
            value: `${fixed(metrics.pacificConvection, 0)} / 100`,
        },
        {
            label: "US temp deviation",
            value: `${tempValue >= 0 ? "+" : ""}${fixed(tempValue, 2)} ${unitLabel}`,
        },
        {
            label: "Global impact index",
            value: `${fixed(metrics.globalImpactIndex, 1)} / 100`,
        },
    ];
    cols.forEach((col, i) => {
        const colX = 64 + (i % 2) * 300;
        const rowY = 232 + Math.floor(i / 2) * 78;
        drawLabel(ctx, col.label, colX, rowY);
        drawValue(ctx, col.value, colX, rowY + 30);
    });

    // 4. Telemetry card: live NOAA reading, or a "model only" note.
    drawCard(ctx, 40, 420, 620, 96);
    drawLabel(ctx, "Live telemetry", 64, 452);
    if (telemetry && telemetry.tao.status === "active") {
        ctx.fillStyle = "#34d399";
        ctx.font = "600 15px ui-monospace, 'JetBrains Mono', monospace";
        ctx.fillText(
            `Niño 3.4 ${fixed(telemetry.tao.nino34_sst, 2)} °C · ${telemetry.tao.status}`,
            64,
            480,
        );
        ctx.fillStyle = TEXT_MUTED;
        ctx.font = "400 11px ui-monospace, 'JetBrains Mono', monospace";
        ctx.fillText(telemetry.timestamp, 64, 500);
    } else {
        ctx.fillStyle = TEXT_MUTED;
        ctx.font = "400 13px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText(
            "No live reading — scenario values are model output.",
            64,
            480,
        );
    }

    // 4b. Region card: the active region's own numbers, right-hand column.
    if (region && regionMetrics) {
        drawCard(ctx, OUT_W - 660, 40, 620, 200);
        ctx.fillStyle = TEXT_PRIMARY;
        ctx.font =
            "600 22px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText(region.name, OUT_W - 636, 78);
        ctx.fillStyle = TEXT_MUTED;
        ctx.font =
            "400 13px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText(
            `${fixed(region.lat, 1)}, ${fixed(region.lon, 1)}`,
            OUT_W - 636,
            102,
        );

        const tempValue =
            units === "imperial"
                ? regionMetrics.tempDeviation
                : (regionMetrics.tempDeviation - 32) / 1.8;
        const tempUnit = units === "imperial" ? "°F" : "°C";

        const regionCols = [
            {
                label: "Precip change",
                value: `${regionMetrics.precipChange >= 0 ? "+" : ""}${fixed(regionMetrics.precipChange, 1)}%`,
            },
            {
                label: "Temp deviation",
                value: `${tempValue >= 0 ? "+" : ""}${fixed(tempValue, 1)} ${tempUnit}`,
            },
            {
                label: "Jet contribution",
                value: `${regionMetrics.jetContribution >= 0 ? "+" : ""}${fixed(regionMetrics.jetContribution, 1)}%`,
            },
            {
                label: "Signal tier",
                value: regionMetrics.signalTier,
            },
        ];
        regionCols.forEach((col, i) => {
            const colX = OUT_W - 636 + (i % 2) * 300;
            const rowY = 132 + Math.floor(i / 2) * 52;
            drawLabel(ctx, col.label, colX, rowY);
            ctx.fillStyle = TEXT_PRIMARY;
            ctx.font =
                "600 18px ui-monospace, 'JetBrains Mono', monospace";
            ctx.fillText(col.value, colX, rowY + 24);
        });
    }

    // 5. Footer: provenance, left and right.
    const now = new Date();
    const stamp = now
        .toISOString()
        .replace("T", " ")
        .replace(/\..+/, " UTC");
    ctx.fillStyle = TEXT_DIM;
    ctx.font = "400 12px ui-monospace, 'JetBrains Mono', monospace";
    ctx.fillText(
        `Dataset: NOAA CPC ERSSTv5 · Generated: ${stamp}`,
        40,
        OUT_H - 40,
    );
    ctx.textAlign = "right";
    ctx.fillText(
        "Tariq Khan · tariqkhan.dev · R3F + DuckDB-WASM",
        OUT_W - 40,
        OUT_H - 40,
    );
    ctx.textAlign = "left";

    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) =>
                blob
                    ? resolve(blob)
                    : reject(new Error("snapshot: toBlob returned null")),
            "image/png",
            1,
        );
    });
}
