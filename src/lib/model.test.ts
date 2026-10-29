import { describe, expect, it } from 'vitest';
import {
  AGRI_DEFAULT,
  JET_DEFAULT,
  SST_DEFAULT,
  clamp,
  computeMetrics,
  regionHeadline,
  riskTier,
  thermalColor,
  thermalVector,
} from '@/lib/model';
import {
  REGIONS,
  celsiusToFahrenheit,
  celsiusDeltaToFahrenheit,
  deltaDisplay,
  fahrenheitDeltaToCelsius,
  latLonToVector3,
} from '@/lib/regions';
import type { ScenarioState } from '@/types/enso';

const baseline: ScenarioState = {
  sstAnomaly: SST_DEFAULT,
  jetStreamShift: 0,
  agricultureWeight: AGRI_DEFAULT,
};

describe('computeMetrics — brief specification', () => {
  it('applies the Pacific equations exactly', () => {
    const m = computeMetrics({ ...baseline, sstAnomaly: 2 });
    expect(m.pacificSstDev).toBeCloseTo(2 * 1.15, 2);
    expect(m.pacificConvection).toBeCloseTo(70, 1);
  });

  it('caps convection at 100', () => {
    expect(computeMetrics({ ...baseline, sstAnomaly: 3 }).pacificConvection).toBe(100);
  });

  it('applies the Western US precip and temp equations', () => {
    const m = computeMetrics({ ...baseline, sstAnomaly: 1.5 });
    expect(m.usPrecipBase).toBeCloseTo(15 + 1.5 * 18, 1);
    expect(m.usPrecip).toBeCloseTo(m.usPrecipBase, 1); // jet = 0
    expect(m.usTempDevF).toBeCloseTo(-0.5 - 1.5 * 0.8, 2);
  });

  it('applies the SE Asia precip and drought equations', () => {
    const m = computeMetrics({ ...baseline, sstAnomaly: 1.5 });
    expect(m.asiaPrecip).toBeCloseTo(-10 - 1.5 * 22, 1);
    expect(m.asiaDrought).toBeCloseTo(1.5 * 3.2, 2);
  });

  it('applies the Horn of Africa precip and flood equations', () => {
    const m = computeMetrics({ ...baseline, sstAnomaly: 1.5 });
    expect(m.africaPrecip).toBeCloseTo(20 + 1.5 * 25, 1);
    expect(m.africaFlood).toBeCloseTo(1.5 * 2.8, 2);
  });
});

describe('secondary levers', () => {
  it('a poleward jet shift dries the US and deepens the SE Asia drought', () => {
    const neutral = computeMetrics({ ...baseline, jetStreamShift: 0 });
    const poleward = computeMetrics({ ...baseline, jetStreamShift: 1 });
    expect(poleward.usPrecip).toBeGreaterThan(neutral.usPrecip);
    expect(poleward.asiaDrought).toBeGreaterThan(neutral.asiaDrought);
    expect(poleward.africaPrecip).toBeLessThan(neutral.africaPrecip);
  });

  it('an equatorward jet shift is the mirror image', () => {
    const neutral = computeMetrics({ ...baseline, jetStreamShift: 0 });
    const equatorward = computeMetrics({ ...baseline, jetStreamShift: -1 });
    expect(equatorward.usPrecip).toBeLessThan(neutral.usPrecip);
    expect(equatorward.asiaPrecip).toBeGreaterThan(neutral.asiaPrecip);
  });

  it('agriculture weight never changes the climate signal, only exposure', () => {
    const low = computeMetrics({ ...baseline, agricultureWeight: 0 });
    const high = computeMetrics({ ...baseline, agricultureWeight: 1 });
    expect(high.usPrecip).toBe(low.usPrecip);
    expect(high.asiaDrought).toBe(low.asiaDrought);
    expect(high.agricultureExposure).toBeGreaterThan(low.agricultureExposure);
  });

  it('clamps out-of-range inputs instead of producing nonsense', () => {
    const m = computeMetrics({ sstAnomaly: 99, jetStreamShift: 9, agricultureWeight: 9 });
    expect(m.sst).toBe(3);
    expect(m.jet).toBe(1);
    expect(m.agri).toBe(1);
  });
});

describe('derived indices', () => {
  it('keeps the impact index inside 0..100', () => {
    for (let sst = 0; sst <= 3; sst += 0.1) {
      const m = computeMetrics({ ...baseline, sstAnomaly: sst });
      expect(m.globalImpactIndex).toBeGreaterThanOrEqual(0);
      expect(m.globalImpactIndex).toBeLessThanOrEqual(100);
    }
  });

  it('rises monotonically with the anomaly', () => {
    const values = [0, 0.5, 1, 1.5, 2, 2.5, 3].map(
      (sst) => computeMetrics({ ...baseline, sstAnomaly: sst }).globalImpactIndex,
    );
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });
});

describe('risk tiers', () => {
  it('maps the anomaly range onto the tier ladder', () => {
    expect(riskTier(0.2)).toMatch(/Neutral/);
    expect(riskTier(0.8)).toMatch(/Weak/);
    expect(riskTier(1.2)).toMatch(/Moderate/);
    expect(riskTier(1.8)).toMatch(/Strong/);
    expect(riskTier(2.2)).toMatch(/Super/);
    expect(riskTier(2.9)).toMatch(/Mega/);
  });

  it('is monotonic across the whole domain', () => {
    const order = ['Neutral', 'Weak', 'Moderate', 'Strong', 'Super', 'Mega'];
    let lastIndex = -1;
    for (let sst = 0; sst <= 3; sst += 0.05) {
      const idx = order.findIndex((o) => riskTier(sst).includes(o));
      expect(idx).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = idx;
    }
  });
});

describe('thermal ramp', () => {
  it('returns valid rgba strings at both ends and the middle', () => {
    for (const sst of [0, 1.5, 3]) {
      expect(thermalColor(sst)).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
    }
  });

  it('shifts from cool to hot (red channel rises, blue falls)', () => {
    const [r0, , b0] = thermalVector(0);
    const [r3, , b3] = thermalVector(3);
    expect(r3).toBeGreaterThan(r0);
    expect(b3).toBeLessThan(b0);
  });

  it('produces channels in the 0..1 range', () => {
    for (let sst = 0; sst <= 3; sst += 0.15) {
      for (const c of thermalVector(sst)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('helpers', () => {
  it('clamp works', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(1.5, 0, 3)).toBe(1.5);
  });

  it('regionHeadline is defined for every region', () => {
    const m = computeMetrics({ ...baseline, sstAnomaly: 1.5 });
    for (const region of REGIONS) {
      expect(regionHeadline(m, region.id)).toMatch(/\d/);
    }
  });

  it('latLonToVector3 lands on the unit sphere', () => {
    for (const region of REGIONS) {
      const [x, y, z] = latLonToVector3(region.lat, region.lon, 1);
      expect(Math.sqrt(x * x + y * y + z * z)).toBeCloseTo(1, 6);
    }
  });

  it('latLonToVector3 places the equator and poles correctly', () => {
    const [nx, ny, nz] = latLonToVector3(0, 0, 1);
    expect(ny).toBeCloseTo(0, 6);
    expect(Math.sqrt(nx * nx + nz * nz)).toBeCloseTo(1, 6);

    const [, poleY] = latLonToVector3(90, 0, 1);
    expect(poleY).toBeCloseTo(1, 6);
  });

  it('converts Celsius to Fahrenheit', () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
    expect(celsiusToFahrenheit(-40)).toBe(-40);
  });

  // Regression: the drawer once ran a deviation through the absolute formula,
  // turning a -1.91 degF anomaly into -18.8 degC on screen.
  it('converts temperature deltas by 5/9, with no +32 offset', () => {
    expect(fahrenheitDeltaToCelsius(1.8)).toBeCloseTo(1, 10);
    expect(fahrenheitDeltaToCelsius(-1.91)).toBeCloseTo(-1.0611, 4);
    expect(celsiusDeltaToFahrenheit(1)).toBeCloseTo(1.8, 10);
    // A zero anomaly must stay zero — the tell that the offset crept back in.
    expect(fahrenheitDeltaToCelsius(0)).toBe(0);
  });

  it('deltaDisplay round-trips between unit systems', () => {
    const c = deltaDisplay(-1.06, 'metric');
    expect(c.unit).toBe('°C');
    expect(c.value).toBeCloseTo(-1.06, 6);

    const f = deltaDisplay(-1.06, 'imperial');
    expect(f.unit).toBe('°F');
    expect(f.value).toBeCloseTo(-1.908, 3);
    expect(fahrenheitDeltaToCelsius(f.value)).toBeCloseTo(-1.06, 6);
  });

  it('defaults are inside their declared ranges', () => {
    expect(SST_DEFAULT).toBeGreaterThanOrEqual(0);
    expect(SST_DEFAULT).toBeLessThanOrEqual(3);
    expect(JET_DEFAULT).toBeGreaterThanOrEqual(-1);
    expect(JET_DEFAULT).toBeLessThanOrEqual(1);
    expect(AGRI_DEFAULT).toBeGreaterThanOrEqual(0);
    expect(AGRI_DEFAULT).toBeLessThanOrEqual(1);
  });
});

describe('region definitions', () => {
  it('every region has unique coordinates and copy', () => {
    const coords = new Set(REGIONS.map((r) => `${r.lat},${r.lon}`));
    expect(coords.size).toBe(REGIONS.length);
    for (const region of REGIONS) {
      expect(region.summary.length).toBeGreaterThan(20);
      expect(region.mechanism.length).toBeGreaterThan(40);
      expect(region.zoom).toBeGreaterThan(1.6);
    }
  });
});
