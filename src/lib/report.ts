/**
 * Snapshot / report export.
 *
 * Two outputs from one button:
 *   1. A PNG of the live canvas (the "citation shot" for a portfolio or a doc).
 *   2. A self-contained, print-styled HTML report — browser "Print → Save as PDF"
 *      gives a clean one-pager with no server, no jsPDF, no 300 KB dependency.
 *
 * The report is built as a string template with the metrics inlined as text, so
 * it opens instantly and survives being emailed as a .html attachment.
 */

import type {
    AnalyticsPayload,
    RegionDefinition,
    RegionId,
    ScenarioMetrics,
    ScenarioState,
    UnitSystem,
} from "@/types/enso";
import { REGION_MAP } from "@/lib/regions";
import { thermalColor } from "@/lib/model";
import { fixed } from "@/lib/format";

export { captureCanvas } from "@/lib/canvasCapture";

export function downloadPng(dataUrl: string, filename: string): void {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function metricRows(m: ScenarioMetrics): Array<[string, string, string]> {
    return [
        [
            "Equatorial Pacific — SST deviation",
            `+${fixed(m.pacificSstDev, 2)}`,
            "°C",
        ],
        [
            "Equatorial Pacific — convection shift",
            fixed(m.pacificConvection, 1),
            "/100",
        ],
        [
            "Western US — precipitation change",
            `${m.usPrecip > 0 ? "+" : ""}${fixed(m.usPrecip, 1)}`,
            "%",
        ],
        ["Western US — temperature deviation", fixed(m.usTempDevF, 2), "°F"],
        ["SE Asia — precipitation change", `${fixed(m.asiaPrecip, 1)}`, "%"],
        ["SE Asia — drought index", fixed(m.asiaDrought, 2), "/10"],
        [
            "Horn of Africa — precipitation change",
            `+${fixed(m.africaPrecip, 1)}`,
            "%",
        ],
        ["Horn of Africa — flood index", fixed(m.africaFlood, 2), "/10"],
        ["Global impact index", fixed(m.globalImpactIndex, 1), "/100"],
        ["Agriculture exposure", fixed(m.agricultureExposure, 0), "%"],
    ];
}

export interface ReportInput {
    scenario: ScenarioState;
    metrics: ScenarioMetrics;
    analytics: AnalyticsPayload;
    activeRegion: RegionId | null;
    snapshot: string | null;
    units: UnitSystem;
}

export function buildReportHtml({
    scenario,
    metrics,
    analytics,
    activeRegion,
    snapshot,
    units,
}: ReportInput): string {
    const generated = new Date().toLocaleString(undefined, {
        dateStyle: "long",
        timeStyle: "short",
    });
    const accent = thermalColor(metrics.sst, 1);
    const region: RegionDefinition | null = activeRegion
        ? REGION_MAP[activeRegion]
        : null;
    const sstValue =
        units === "imperial" ? scenario.sstAnomaly * 1.8 : scenario.sstAnomaly;
    const sstUnit = units === "imperial" ? "°F" : "°C";

    const rows = metricRows(metrics)
        .map(
            ([label, value, unit]) => `
        <tr>
          <td>${label}</td>
          <td class="v">${value}<span class="u">${unit}</span></td>
        </tr>`,
        )
        .join("");

    const analogs = analytics.analogs
        .slice(0, 5)
        .map(
            (a) => `
        <tr>
          <td>${a.label}</td>
          <td class="v">${fixed(a.anomaly, 2)}<span class="u">°C</span></td>
          <td class="v dim">±${fixed(a.delta, 2)}</td>
          <td>${a.riskTier}</td>
        </tr>`,
        )
        .join("");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>super-el-nino-report-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 30px;
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Inter, sans-serif;
    color: #10151f; background: #fff; font-size: 11px; line-height: 1.5;
  }
  .eyebrow { font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 8.5px;
    letter-spacing: .18em; text-transform: uppercase; color: #6b7280; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #10151f; padding-bottom: 12px; }
  h1 { font-size: 19px; margin: 4px 0 2px; letter-spacing: -.02em; }
  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .14em;
    color: #6b7280; margin: 20px 0 7px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .pill { display: inline-block; padding: 3px 9px; border-radius: 999px;
    font-family: ui-monospace, monospace; font-size: 8.5px; letter-spacing: .1em;
    text-transform: uppercase; background: ${accent}1f; color: ${accent};
    border: 1px solid ${accent}55; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card {
    border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px;
    font-size: 14px; line-height: 1.6; color: #1e293b;
  }
  .k { font-family: ui-monospace, monospace; font-size: 8px; letter-spacing: .14em;
    text-transform: uppercase; color: #6b7280; }
  .big { font-family: ui-monospace, monospace; font-size: 21px; font-weight: 600;
    letter-spacing: -.03em; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 8px; letter-spacing: .1em; text-transform: uppercase;
    color: #9ca3af; font-weight: 500; padding: 4px 6px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 5px 6px; border-bottom: 1px solid #f3f4f6; font-size: 10px; }
  td.v { font-family: ui-monospace, monospace; text-align: right; font-weight: 600; }
  td.v .u { font-weight: 400; color: #9ca3af; font-size: 8px; margin-left: 1px; }
  .dim { color: #9ca3af; font-weight: 400; }
  .shot { width: 100%; border-radius: 8px; border: 1px solid #e5e7eb; display: block; }
  footer { margin-top: 22px; padding: 16px 0; border-top: 1px solid #e5e7eb;
    font-size: 14px; font-weight: 600; color: #334155;
    display: flex; justify-content: space-between; }
  .no-print { margin-bottom: 18px; }
  .btn { font: inherit; font-size: 11px; padding: 7px 16px; border-radius: 6px;
    border: 1px solid #10151f; background: #10151f; color: #fff; cursor: pointer; }
  @media print { .no-print { display: none; } body { padding: 0; } }
</style>
</head>
<body>
  <div class="no-print"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>

  <header>
    <div>
      <div class="eyebrow">Scenario Diagnostic Report</div>
      <h1>Super El Niño Global Impact Simulator</h1>
      <div class="eyebrow" style="letter-spacing:.06em">
        Generated ${generated}${region ? ` · focus: ${region.name}` : ""}
      </div>
    </div>
    <div style="text-align:right">
      <div class="pill">${metrics.riskTier}</div>
      <div class="eyebrow" style="margin-top:8px">Global SST +${fixed(sstValue, 2)} ${sstUnit}</div>
    </div>
  </header>

  <h2>Scenario Inputs</h2>
  <div class="grid">
    <div class="card">
      <div class="k">Global SST anomaly</div>
      <div class="big">+${fixed(sstValue, 2)} ${sstUnit}</div>
    </div>
    <div class="card">
      <div class="k">Jet displacement / ag weight</div>
      <div class="big">${scenario.jetStreamShift >= 0 ? "+" : ""}${fixed(scenario.jetStreamShift, 2)} · ${Math.round(
          scenario.agricultureWeight * 100,
      )}%</div>
    </div>
  </div>

  ${
      snapshot
          ? `<h2>Visual Snapshot</h2><img class="shot" src="${snapshot}" alt="3D globe snapshot at the simulated anomaly" />`
          : ""
  }

  <h2>Regional Impact Metrics</h2>
  <table>
    <thead><tr><th>Indicator</th><th style="text-align:right">Value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  ${
      analogs
          ? `<h2>Historical Analogs (Niño 3.4 nearest months)</h2>
         <table>
           <thead><tr><th>Month</th><th style="text-align:right">Anomaly</th><th style="text-align:right">Δ</th><th>Tier</th></tr></thead>
           <tbody>${analogs}</tbody>
         </table>`
          : ""
  }

  <h2>Model Basis</h2>
  <div class="card">
    Regional equations follow the published Super El Niño impact specification:
    Pacific SST deviation = anomaly × 1.15 and convection = min(100, anomaly × 35);
    Western US precip = +15% + 18%·anomaly with a −0.5 °F − 0.8 °F·anomaly thermal term;
    SE Asia precip = −10% − 22%·anomaly with drought index = 3.2·anomaly;
    Horn of Africa precip = +20% + 25%·anomaly with flood index = 2.8·anomaly.
    Secondary levers apply linear jet-stream and cropland-exposure modifiers.
    Analytics executed client-side in DuckDB-WASM over ${analytics.summary.rowCount} monthly observations
    (${analytics.summary.firstDate} → ${analytics.summary.lastDate}).
  </div>

  <footer>
    <span>Super El Niño Global Impact Simulator · tariqkhan.dev</span>
    <span>Query ${fixed(analytics.queryMs, 1)} ms · model output, not a weather forecast</span>
  </footer>
</body>
</html>`;
}

export function openReport(html: string): void {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const reportWin = window.open(url, "_blank");
    if (!reportWin) return;
}
