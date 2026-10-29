import { describe, expect, it } from 'vitest';
import { buildReportHtml } from '@/lib/report';
import { computeMetrics, SST_DEFAULT, JET_DEFAULT, AGRI_DEFAULT } from '@/lib/model';
import type { AnalyticsPayload, ScenarioState } from '@/types/enso';

const scenario: ScenarioState = {
  sstAnomaly: SST_DEFAULT,
  jetStreamShift: JET_DEFAULT,
  agricultureWeight: AGRI_DEFAULT,
};

const analytics: AnalyticsPayload = {
  metrics: computeMetrics(scenario),
  analogs: [
    {
      date: '2017-07',
      label: '2017 07',
      anomaly: 1.5,
      absoluteSst: 27.35,
      delta: 0.0,
      sstDeviation: 1.725,
      precipPacific: 22.5,
      precipUs: 42,
      precipSeAsia: -43,
      precipAfrica: 57.5,
      droughtIndex: 4.8,
      riskTier: 'Strong Warm Phase',
    },
  ],
  summary: {
    rowCount: 120,
    firstDate: '2015-01',
    lastDate: '2024-12',
    meanAnomaly: 1.15,
    maxAnomaly: 2.79,
    maxAnomalyDate: '2016-11',
    analogCount: 9,
    extremeMonths: 31,
    laninaMonths: 338,
    source: 'NOAA CPC ERSSTv5 (1991-2020 base)',
  },
  timeline: [{ date: '2015-01', label: '2015 01', anomaly: 0.7 }],
  queryMs: 12.3,
};

describe('buildReportHtml', () => {
  const html = buildReportHtml({
    scenario,
    metrics: analytics.metrics,
    analytics,
    activeRegion: 'us-west',
    snapshot: null,
  });

  it('is a complete HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('inlines the scenario inputs, not a placeholder', () => {
    expect(html).toContain(`+${SST_DEFAULT.toFixed(2)}`);
    expect(html).toContain(analytics.metrics.riskTier);
  });

  it('includes every regional metric row', () => {
    expect(html).toContain('Equatorial Pacific — SST deviation');
    expect(html).toContain('Western US — precipitation change');
    expect(html).toContain('SE Asia — drought index');
    expect(html).toContain('Horn of Africa — flood index');
    expect(html).toContain('Global impact index');
  });

  it('renders the analog table when analogs exist', () => {
    expect(html).toContain('Historical Analogs');
    expect(html).toContain('2017 07');
    expect(html).toContain('Strong Warm Phase');
  });

  it('names the focused region when one is selected', () => {
    expect(html).toContain('Western US & California');
  });

  it('embeds the snapshot only when one was captured', () => {
    expect(html).not.toContain('<img class="shot"');

    const withShot = buildReportHtml({
      scenario,
      metrics: analytics.metrics,
      analytics,
      activeRegion: null,
      snapshot: 'data:image/png;base64,AAAA',
    });
    expect(withShot).toContain('<img class="shot" src="data:image/png;base64,AAAA"');
  });

  it('carries a print stylesheet and a print button', () => {
    expect(html).toContain('@media print');
    expect(html).toContain('window.print()');
  });

  it('states the dataset window from the analytics payload', () => {
    expect(html).toContain('2015-01');
    expect(html).toContain('2024-12');
    expect(html).toContain('120 monthly observations');
  });
});
