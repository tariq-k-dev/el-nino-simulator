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

const CARD_BG = "rgba(10, 16, 26, 0.92)";
const CARD_BORDER = "rgba(56, 189, 248, 0.35)";
const CARD_PADDING = 60;
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
    ctx.font = "500 16px ui-monospace, 'JetBrains Mono', monospace";
    ctx.fillText(text.toUpperCase(), x, y);
}

function drawValue(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
): void {
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = "600 30px ui-monospace, 'JetBrains Mono', monospace";
    ctx.fillText(text, x, y);
}

/**
 * Draw vector stand-ins for the DOM labels that live outside the WebGL canvas.
 *
 * The pin labels and the atmospheric-river pill are drei `<Html>` elements — real
 * DOM siblings of the canvas, not scene objects — so `drawImage(source, …)` never
 * captures them. Without this pass the snapshot shows bare pins and a river with
 * no caption, which reads as a rendering bug rather than a design choice.
 *
 * The elements are found by the `data-snapshot-*` attributes the components set,
 * and their viewport rects are mapped into the 1920×1080 output with the same
 * `cover` crop the background uses, so a label lands on the pin it belongs to.
 * Anything off-canvas, hidden, or faded to zero is skipped — the limb-fade rule
 * the components apply per frame is honoured here by reading the live opacity.
 */
function drawDomLabels(
    ctx: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
): void {
    if (typeof document === "undefined") return;

    const canvasRect = source.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return;

    /* Same `cover` crop as the background, so label and pin stay aligned. */
    const srcAspect = source.width / source.height;
    const outAspect = OUT_W / OUT_H;
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;
    if (srcAspect > outAspect) {
        sw = source.height * outAspect;
        sx = (source.width - sw) / 2;
    } else if (srcAspect < outAspect) {
        sh = source.width / outAspect;
        sy = (source.height - sh) / 2;
    }
    const scaleX = OUT_W / source.width;
    const scaleY = OUT_H / source.height;

    const toOut = (rect: DOMRect) => {
        const u =
            (rect.left + rect.width / 2 - canvasRect.left) / canvasRect.width;
        const v =
            (rect.top + rect.height / 2 - canvasRect.top) / canvasRect.height;
        return {
            x: u * OUT_W,
            y: v * OUT_H,
        };
    };

    const onCanvas = (rect: DOMRect) =>
        rect.right >= canvasRect.left &&
        rect.left <= canvasRect.right &&
        rect.bottom >= canvasRect.top &&
        rect.top <= canvasRect.bottom;

    const isVisible = (el: HTMLElement) => {
        if (!el.offsetParent) return false;
        const opacity = parseFloat(el.style.opacity || "1");
        return Number.isFinite(opacity) && opacity > 0.05;
    };

    document
        .querySelectorAll<HTMLElement>("[data-snapshot-pin]")
        .forEach((el) => {
            if (!isVisible(el)) return;
            const rect = el.getBoundingClientRect();
            if (!onCanvas(rect)) return;

            const { x, y } = toOut(rect);
            const active = el.getAttribute("data-snapshot-active") === "true";
            const label = (
                el.getAttribute("data-snapshot-pin") ||
                el.textContent ||
                ""
            ).toUpperCase();

            ctx.font = "600 16px ui-monospace, 'JetBrains Mono', monospace";
            const textW = ctx.measureText(label).width;
            const pillW = textW + 44;
            const pillH = 26;

            ctx.beginPath();
            ctx.roundRect(x - pillW / 2, y - pillH / 2, pillW, pillH, pillH / 2);
            ctx.fillStyle = "rgba(10, 15, 25, 0.88)";
            ctx.fill();
            ctx.strokeStyle = active
                ? "rgba(255, 255, 255, 0.45)"
                : "rgba(255, 255, 255, 0.2)";
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(x - pillW / 2 + 14, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = active ? "#f59e0b" : "#0284c7";
            ctx.fill();

            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(label, x - pillW / 2 + 24, y);
        });

    const riverEl = document.querySelector<HTMLElement>(
        "[data-snapshot-river]",
    );
    if (riverEl && isVisible(riverEl)) {
        const rect = riverEl.getBoundingClientRect();
        if (onCanvas(rect)) {
            const { x, y } = toOut(rect);
            const label = (riverEl.textContent || "ATMOSPHERIC RIVER")
                .replace(/\s+/g, " ")
                .trim();

            ctx.font = "600 16px ui-monospace, 'JetBrains Mono', monospace";
            const textW = ctx.measureText(label).width;
            const pillW = textW + 32;
            const pillH = 26;

            ctx.beginPath();
            ctx.roundRect(x - pillW / 2, y - pillH / 2, pillW, pillH, pillH / 2);
            ctx.fillStyle = "rgba(10, 15, 25, 0.88)";
            ctx.fill();
            ctx.strokeStyle = "rgba(2, 132, 199, 0.3)";
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = "#93c5fd";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, x, y);
        }
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
}

/**
 * Draw the composed snapshot onto a caller-supplied 2D context.
 *
 * Shared by `composeSnapshot` (Blob) and `composeSnapshotToDataUrl` (string) so
 * the two outputs cannot drift: the PNG download and the HTML report's inline
 * image are the same pixels by construction, not by convention.
 */
function composeSnapshotToCanvas(
    ctx: CanvasRenderingContext2D,
    { source, metrics, region, telemetry, units, regionMetrics }: SnapshotInput,
): void {
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
    drawCard(ctx, CARD_PADDING, CARD_PADDING, 720, 180);
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = "600 32px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillText(
        "SUPER EL NIÑO GLOBAL IMPACT SIMULATOR",
        CARD_PADDING + 24,
        CARD_PADDING + 60,
    );
    ctx.fillStyle = TEXT_MUTED;
    ctx.font = "400 18px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillText(
        region
            ? `Focus: ${region.name}`
            : "Global view · no region selected",
        CARD_PADDING + 24,
        CARD_PADDING + 96,
    );
    // Risk pill.
    ctx.beginPath();
    ctx.roundRect(CARD_PADDING + 24, CARD_PADDING + 120, 220, 40, 20);
    ctx.fillStyle = `${accent}22`;
    ctx.fill();
    ctx.strokeStyle = `${accent}88`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.font = "600 16px ui-monospace, 'JetBrains Mono', monospace";
    ctx.fillText(
        metrics.riskTier.toUpperCase(),
        CARD_PADDING + 44,
        CARD_PADDING + 147,
    );

    // 3. Metrics card: the four headline numbers.
    drawCard(ctx, CARD_PADDING, CARD_PADDING + 200, 720, 260);
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
        const colX = CARD_PADDING + 24 + (i % 2) * 360;
        const rowY = CARD_PADDING + 240 + Math.floor(i / 2) * 100;
        drawLabel(ctx, col.label, colX, rowY);
        drawValue(ctx, col.value, colX, rowY + 40);
    });

    // 4. Telemetry card: live NOAA reading, or a "model only" note.
    drawCard(ctx, CARD_PADDING, OUT_H - 200 - CARD_PADDING, 720, 200);
    drawLabel(
        ctx,
        "Live telemetry",
        CARD_PADDING + 24,
        OUT_H - 200 - CARD_PADDING + 50,
    );
    if (telemetry && telemetry.tao.status === "active") {
        ctx.fillStyle = "#34d399";
        ctx.font = "600 20px ui-monospace, 'JetBrains Mono', monospace";
        ctx.fillText(
            `NIÑO 3.4 SST: ${fixed(telemetry.tao.nino34_sst, 2)} °C · ${telemetry.tao.status.toUpperCase()}`,
            CARD_PADDING + 24,
            OUT_H - 200 - CARD_PADDING + 100,
        );
        ctx.fillStyle = TEXT_MUTED;
        ctx.font = "400 14px ui-monospace, 'JetBrains Mono', monospace";
        ctx.fillText(
            telemetry.timestamp,
            CARD_PADDING + 24,
            OUT_H - 200 - CARD_PADDING + 130,
        );
    } else {
        ctx.fillStyle = TEXT_MUTED;
        ctx.font =
            "400 18px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText(
            "No live reading — scenario values are model output.",
            CARD_PADDING + 24,
            OUT_H - 200 - CARD_PADDING + 100,
        );
    }

    // 4b. Region card: the active region's own numbers, right-hand column.
    //     When no region is selected, a "Global baseline" card takes its place
    //     so the right column is never empty.
    const rightX = OUT_W - 720 - CARD_PADDING;
    if (region && regionMetrics) {
        const isUsWest = region.id === "us-west";
        drawCard(ctx, rightX, CARD_PADDING, 720, isUsWest ? 320 : 260);
        ctx.fillStyle = TEXT_PRIMARY;
        ctx.font =
            "600 28px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText(region.name.toUpperCase(), rightX + 24, CARD_PADDING + 60);
        ctx.fillStyle = TEXT_MUTED;
        ctx.font =
            "400 16px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText(
            `${fixed(region.lat, 1)}, ${fixed(region.lon, 1)}`,
            rightX + 24,
            CARD_PADDING + 92,
        );

        // Atmospheric river badge — US West only. The precip change is the
        // moisture-flux proxy the model already computes for this region, so
        // the badge is a labelled view of an existing number, not a new term.
        if (isUsWest) {
            ctx.beginPath();
            ctx.roundRect(rightX + 24, CARD_PADDING + 112, 360, 40, 20);
            ctx.fillStyle = "rgba(10, 16, 26, 0.85)";
            ctx.fill();
            ctx.strokeStyle = "rgba(96, 165, 250, 0.4)";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = "#93c5fd";
            ctx.font = "600 16px ui-monospace, 'JetBrains Mono', monospace";
            ctx.fillText(
                `ATMOSPHERIC RIVER: ${regionMetrics.precipChange >= 0 ? "+" : ""}${fixed(regionMetrics.precipChange, 0)}% FLUX`,
                rightX + 44,
                CARD_PADDING + 139,
            );
        }

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
        const rowsTop = CARD_PADDING + (isUsWest ? 200 : 140);
        regionCols.forEach((col, i) => {
            const colX = rightX + 24 + (i % 2) * 360;
            const rowY = rowsTop + Math.floor(i / 2) * 60;
            drawLabel(ctx, col.label, colX, rowY);
            ctx.fillStyle = TEXT_PRIMARY;
            ctx.font =
                "600 22px ui-monospace, 'JetBrains Mono', monospace";
            ctx.fillText(col.value, colX, rowY + 30);
        });
    } else {
        drawCard(ctx, rightX, CARD_PADDING, 720, 180);
        ctx.fillStyle = TEXT_PRIMARY;
        ctx.font =
            "600 28px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText("GLOBAL BASELINE", rightX + 24, CARD_PADDING + 60);
        ctx.fillStyle = TEXT_MUTED;
        ctx.font =
            "400 16px ui-sans-serif, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText(
            "No region selected — showing global aggregates.",
            rightX + 24,
            CARD_PADDING + 96,
        );
        ctx.fillStyle = TEXT_PRIMARY;
        ctx.font = "600 22px ui-monospace, 'JetBrains Mono', monospace";
        ctx.fillText(
            `Impact index: ${fixed(metrics.globalImpactIndex, 1)} / 100`,
            rightX + 24,
            CARD_PADDING + 140,
        );
    }

    // 5. DOM labels: pins and the atmospheric-river pill, drawn as vectors.
    drawDomLabels(ctx, source);

    // 6. Footer: provenance, left and right.
    const now = new Date();
    const stamp = now
        .toISOString()
        .replace("T", " ")
        .replace(/\..+/, " UTC");
    ctx.fillStyle = "rgba(226, 232, 240, 0.85)";
    ctx.font = "600 18px ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
    ctx.fillText(
        `Dataset: NOAA CPC ERSSTv5 · Generated: ${stamp}`,
        CARD_PADDING,
        OUT_H - 28,
    );
    ctx.textAlign = "right";
    ctx.fillText(
        "Tariq Khan · tariqkhan.dev · R3F + DuckDB-WASM",
        OUT_W - CARD_PADDING,
        OUT_H - 28,
    );
    ctx.textAlign = "left";
}

/**
 * Compose the snapshot and return it as a PNG blob.
 *
 * Rejects if the 2D context cannot be created (extremely rare; a browser with
 * WebGL but no 2D canvas is not a real configuration).
 */
export async function composeSnapshot(
    input: SnapshotInput,
): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("snapshot: 2D context unavailable");

    composeSnapshotToCanvas(ctx, input);

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

/**
 * Compose the snapshot and return it as a `data:image/png;base64,…` URL.
 *
 * Used by the HTML report, which embeds the image inline. A blob URL would
 * break the moment the report is saved to disk or emailed as an attachment —
 * the URL is scoped to the originating document — so the report needs a
 * self-contained string, not a handle.
 */
export async function composeSnapshotToDataUrl(
    input: SnapshotInput,
): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("snapshot: 2D context unavailable");

    composeSnapshotToCanvas(ctx, input);
    return canvas.toDataURL("image/png");
}
