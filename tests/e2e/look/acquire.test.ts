/**
 * Contract tests for the acquisition/analysis split.
 *
 * Two properties are asserted here, and both exist because the previous design failed
 * them silently:
 *
 *  1. PURITY — `tests/e2e/look/analysis.ts` may not import the capture or acquisition
 *     modules, and may not reference `page`, `window`, `fitLimb` or `setLayers`. If it
 *     could reach the scene, a "check" could mutate what it measures, and then a green
 *     negative test would prove nothing about the check.
 *
 *  2. ORDERING — `acquire()` must write flags, fit geometry, take the baseline, THEN
 *     install the defect, wait, probe survival, capture, uninstall, and re-capture.
 *     Installing before the fit is what the old code did by hand and got wrong: both
 *     `setLayers` and `fitLimb` rebuild materials, so a defect written before them is
 *     written into an object nothing draws.
 *
 * The mock page records calls in order, so a refactor that reorders the steps fails here
 * rather than costing a five-minute pixel run and a misleading "no change" result.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  __clearFitCache,
  acquire,
  discDriftPct,
  type AcquireOps,
  type LayerFlags,
  type RawProbe,
} from './acquire';
import type { Bitmap, DiscGeometry } from "../../../src/lib/look/helpers";

const REPO = path.resolve(__dirname, '..', '..', '..');
const ANALYSIS = path.join(REPO, 'tests/e2e/look/analysis.ts');

/** A flat bitmap of one luma value, or a gradient if `from`/`to` are given. */
function frame(width: number, height: number, value: number, to?: number): Bitmap {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const v = to === undefined ? value : Math.round(value + ((to - value) * x) / Math.max(1, width - 1));
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Records every scene-touching call, in order. */
function mockOps(overrides: Partial<AcquireOps> = {}) {
  const calls: string[] = [];
  let frameNo = 100;
  const ops: AcquireOps = {
    settleAt: async (az) => {
      calls.push(`settleAt:${az}`);
    },
    setLayers: async (flags: LayerFlags) => {
      calls.push(`setLayers:${Object.entries(flags).map(([k, v]) => `${k}=${v}`).join(',')}`);
    },
    fitLimb: async (): Promise<DiscGeometry> => {
      calls.push('fitLimb');
      return { cx: 640, cy: 400, r: 325 };
    },
    capture: async (): Promise<Bitmap> => {
      calls.push('capture');
      return frame(8, 8, 40);
    },
    install: async (spec, pin) => {
      calls.push(`install:${spec.name}${pin ? `:${pin}` : ''}`);
    },
    uninstall: async () => {
      calls.push('uninstall');
    },
    waitFrames: async (n) => {
      calls.push(`waitFrames:${n}`);
    },
    probe: async (spec): Promise<RawProbe> => {
      calls.push(`probe:${spec.name}`);
      frameNo += 5;
      return { evidence: {}, failures: [], frameBefore: 100, frameAtCapture: frameNo };
    },
    ...overrides,
  };
  return { ops, calls };
}

describe('analysis purity', () => {
  it('analysis.ts imports nothing that touches a page or a scene', async () => {
    const src = await readFile(ANALYSIS, 'utf8');
    const imports = [...src.matchAll(/^import[\s\S]*?from\s+'([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec, `analysis.ts must not import ${spec}`).not.toContain('./capture');
      expect(spec, `analysis.ts must not import ${spec}`).not.toContain('./acquire');
      expect(spec, `analysis.ts must not import ${spec}`).not.toContain('@playwright/test');
    }
  });

  it('analysis.ts never references window, page, fitLimb, setLayers, or acquire', async () => {
    // Strip comments: the doc-comment explains the rule and names the banned symbols.
    const src = (await readFile(ANALYSIS, 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const banned of ['window.', '__look', '__globe', 'fetch(', 'document.']) {
      expect(src, `analysis.ts references ${banned}`).not.toContain(banned);
    }
    // `page` and the acquisition verbs only appear as words, so match them as calls.
    for (const banned of [/\bfitLimb\s*\(/, /\bsetLayers\s*\(/, /\bacquire\s*\(/, /\bpage\b/]) {
      expect(src, `analysis.ts references ${banned}`).not.toMatch(banned);
    }
  });

  it('analysis.ts exports only pixel checks — every exported function takes a bitmap first', async () => {
    const src = await readFile(ANALYSIS, 'utf8');
    const exported = [...src.matchAll(/^export function (\w+)\([\s\S]{0,80}?(\w+):/gm)].map((m) => ({
      name: m[1],
      first: m[2],
    }));
    expect(exported.length).toBeGreaterThanOrEqual(4);
    // `saturationOf` takes scalars; `largestComponent` takes an index list. Everything
    // else must start from a capture, which is what keeps it from touching a scene.
    const SCALAR_HELPERS = new Set(['saturationOf', 'largestComponent']);
    for (const fn of exported) {
      if (SCALAR_HELPERS.has(fn.name)) continue;
      expect(
        fn.first,
        `${fn.name}'s first parameter is "${fn.first}", expected a bitmap/geometry`,
      ).toMatch(/^(img|on|a)$/);
    }
  });
});

describe('acquire ordering contract', () => {
  it('writes flags and fits geometry BEFORE installing the defect', async () => {
    const { ops, calls } = mockOps();
    await acquire({} as never, {
      flags: { pins: true, clouds: false },
      azimuth: 30,
      defect: { name: 'pointLight', params: { intensity: 2 } },
      pinName: 'us-west',
      ops,
    });

    const installAt = calls.indexOf('install:pointLight:us-west');
    const fitAt = calls.indexOf('fitLimb');
    const lastSetLayers = calls.reduce((acc, c, i) => (c.startsWith('setLayers') ? i : acc), -1);

    expect(installAt, 'the defect was never installed').toBeGreaterThanOrEqual(0);
    expect(fitAt, 'fitLimb never ran').toBeGreaterThanOrEqual(0);
    expect(installAt, 'install must come AFTER fitLimb').toBeGreaterThan(fitAt);
    expect(installAt, 'install must come AFTER the last setLayers').toBeGreaterThan(lastSetLayers);
  });

  it('takes the baseline BEFORE installing, and the defect capture after', async () => {
    const { ops, calls } = mockOps();
    await acquire({} as never, { defect: { name: 'fillLight' }, ops });

    const captures = calls.reduce<number[]>((acc, c, i) => (c === 'capture' ? [...acc, i] : acc), []);
    const installAt = calls.indexOf('install:fillLight');
    expect(captures.length, 'expected baseline + defect + restored = 3 captures').toBe(3);
    expect(captures[0], 'first capture must be the baseline, before install').toBeLessThan(installAt);
    expect(captures[1], 'second capture must be the defect frame, after install').toBeGreaterThan(installAt);
  });

  it('runs the survival probe between the frames and the capture', async () => {
    const { ops, calls } = mockOps();
    await acquire({} as never, { defect: { name: 'pointLight' }, ops });

    const installAt = calls.indexOf('install:pointLight');
    const probeAt = calls.indexOf('probe:pointLight');
    const waitAt = calls.findIndex((c) => c.startsWith('waitFrames'));
    const defectCaptureAt = calls.reduce<number[]>((acc, c, i) => (c === 'capture' ? [...acc, i] : acc), [])[1];

    expect(waitAt, 'no waitFrames after install').toBeGreaterThan(installAt);
    expect(probeAt, 'the survival probe must run after the wait').toBeGreaterThan(waitAt);
    expect(probeAt, 'the survival probe must run before the defect capture').toBeLessThan(defectCaptureAt);
  });

  it('waits at least 3 frames — one to recompile, one to draw, one to be sure', async () => {
    const { ops, calls } = mockOps();
    await acquire({} as never, { defect: { name: 'pointLight' }, ops });
    const wait = calls.find((c) => c.startsWith('waitFrames'));
    expect(wait).toBeDefined();
    expect(Number((wait as string).split(':')[1])).toBeGreaterThanOrEqual(3);
  });

  it('uninstalls and re-captures, so one test cannot poison the next', async () => {
    const { ops, calls } = mockOps();
    await acquire({} as never, { defect: { name: 'pointLight' }, ops });
    const uninstallAt = calls.indexOf('uninstall');
    const lastCapture = calls.reduce((acc, c, i) => (c === 'capture' ? i : acc), -1);
    expect(uninstallAt).toBeGreaterThanOrEqual(0);
    expect(lastCapture, 'a capture must follow the uninstall').toBeGreaterThan(uninstallAt);
  });

  it('throws "defect lost before capture" when the probe reports a failure', async () => {
    const { ops } = mockOps({
      probe: async () => ({
        evidence: {},
        failures: ['the injected pointLight is not in the scene'],
        frameBefore: 100,
        frameAtCapture: 105,
      }),
    });
    await expect(acquire({} as never, { defect: { name: 'pointLight' }, ops })).rejects.toThrow(
      /defect lost before capture/,
    );
  });

  it('throws "defect lost before capture" when the renderer never advanced a frame', async () => {
    // This is the failure the old design could not see: the defect is present in the
    // scene graph but nothing was ever drawn, so its pixels are absent by construction.
    const { ops } = mockOps({
      probe: async () => ({ evidence: {}, failures: [], frameBefore: 100, frameAtCapture: 100 }),
    });
    await expect(acquire({} as never, { defect: { name: 'pointLight' }, ops })).rejects.toThrow(
      /renderer\.info\.render\.frame did not advance/,
    );
  });

  it('does not install, probe or uninstall when no defect is requested', async () => {
    const { ops, calls } = mockOps();
    const result = await acquire({} as never, { ops });
    expect(calls.some((c) => c.startsWith('install'))).toBe(false);
    expect(calls.some((c) => c.startsWith('probe'))).toBe(false);
    expect(calls).not.toContain('uninstall');
    expect(result.probe).toBeNull();
    expect(result.steps).not.toContain('installDefect');
  });

  it('records the ordered step names for reporting', async () => {
    const { ops } = mockOps();
    const result = await acquire({} as never, { defect: { name: 'pointLight' }, ops });
    expect(result.steps).toEqual([
      'setLayers',
      'settleAt',
      'fitLimb',
      'setLayersAfterFit',
      'captureBaseline',
      'installDefect',
      'waitFrames',
      'survivalProbe',
      'captureDefect',
      'uninstallDefect',
      'captureRestored',
    ]);
  });

  it('caches geometry per viewport+camera+azimuth+flags and refits when any changes', async () => {
    __clearFitCache();
    const first = mockOps();
    await acquire({} as never, { azimuth: 0, flags: { pins: true }, ops: first.ops });
    expect(first.calls.filter((c) => c === 'fitLimb')).toHaveLength(1);

    // Same key: the fit is reused, because refitting per acquisition is a second
    // measurement of the same circle and a chance for the two to disagree.
    const second = mockOps();
    await acquire({} as never, { azimuth: 0, flags: { pins: true }, ops: second.ops });
    expect(second.calls.filter((c) => c === 'fitLimb')).toHaveLength(0);

    // Different flags: must refit.
    const third = mockOps();
    await acquire({} as never, { azimuth: 0, flags: { pins: false }, ops: third.ops });
    expect(third.calls.filter((c) => c === 'fitLimb')).toHaveLength(1);

    // Different azimuth: must refit.
    const fourth = mockOps();
    await acquire({} as never, { azimuth: 90, flags: { pins: true }, ops: fourth.ops });
    expect(fourth.calls.filter((c) => c === 'fitLimb')).toHaveLength(1);
    __clearFitCache();
  });

  it('rejects a fit that produced no circle instead of measuring against r = 0', async () => {
    const { ops } = mockOps({ fitLimb: async () => ({ cx: 0, cy: 0, r: 0 }) });
    await expect(acquire({} as never, { ops })).rejects.toThrow(/limb fit produced no circle/);
  });
});

describe('discDriftPct', () => {
  const geom: DiscGeometry = { cx: 4, cy: 4, r: 4 };

  it('is 0 for identical frames', () => {
    const a = frame(8, 8, 40);
    expect(discDriftPct(a, a, geom)).toBe(0);
  });

  it('measures a uniform brightness change as a percentage of the baseline', () => {
    const a = frame(8, 8, 100);
    const b = frame(8, 8, 110);
    expect(discDriftPct(a, b, geom)).toBeCloseTo(10, 5);
  });

  it('is Infinity for a size mismatch rather than silently comparing nothing', () => {
    expect(discDriftPct(frame(8, 8, 40), frame(9, 9, 40), geom)).toBe(Number.POSITIVE_INFINITY);
  });
});
