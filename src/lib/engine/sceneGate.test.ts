// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetSceneGate,
  getSceneGateState,
  markFirstFrame,
  markSceneFailed,
  markSceneReady,
  markTexturesDone,
  SCENE_GATE_TIMEOUT_MS,
  signalSceneCondition,
  subscribeSceneGate,
  whenSceneSettled,
} from '@/lib/engine/sceneGate';

/**
 * The gate decides when the eager boot is allowed to start, so its four outcomes
 * (ready / failed / timeout / bypass) each change observable product behaviour.
 * Fake timers keep the 30 s safety timeout instant in tests.
 */

describe('sceneGate — ready', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSceneGate();
  });
  afterEach(() => {
    __resetSceneGate();
    vi.useRealTimers();
  });

  it('settles ready when both textures and a frame have arrived', async () => {
    const settled = whenSceneSettled();
    expect(getSceneGateState().outcome).toBeNull();

    signalSceneCondition('textures');
    expect(getSceneGateState().outcome).toBeNull(); // only half the condition

    signalSceneCondition('frame');
    await expect(settled).resolves.toBe('ready');
    expect(getSceneGateState().outcome).toBe('ready');
  });

  it('accepts the two signals in either order', async () => {
    const settled = whenSceneSettled();
    signalSceneCondition('frame');
    signalSceneCondition('textures');
    await expect(settled).resolves.toBe('ready');
  });

  it('markSceneReady() settles directly', async () => {
    const settled = whenSceneSettled();
    markSceneReady();
    await expect(settled).resolves.toBe('ready');
    expect(getSceneGateState().readySignalled).toBe(true);
  });

  it('records the elapsed time', async () => {
    const settled = whenSceneSettled();
    vi.advanceTimersByTime(1_200);
    markSceneReady();
    await settled;
    expect(getSceneGateState().settledInMs).toBeGreaterThanOrEqual(1_000);
  });
});

describe('sceneGate — failed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSceneGate();
  });
  afterEach(() => {
    __resetSceneGate();
    vi.useRealTimers();
  });

  it('settles failed and carries the reason', async () => {
    const settled = whenSceneSettled();
    markSceneFailed('WebGL unavailable in this browser');
    await expect(settled).resolves.toBe('failed');
    expect(getSceneGateState().reason).toMatch(/WebGL unavailable/);
  });

  it('a failed scene does NOT wait for the timeout', async () => {
    const settled = whenSceneSettled();
    markSceneFailed('WebGL context lost');
    // Resolves without advancing the fake clock at all.
    await expect(settled).resolves.toBe('failed');
  });

  it('failure wins even if textures had already finished', async () => {
    const settled = whenSceneSettled();
    markTexturesDone();
    markSceneFailed('context lost');
    await expect(settled).resolves.toBe('failed');
  });
});

describe('sceneGate — timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSceneGate();
  });
  afterEach(() => {
    __resetSceneGate();
    vi.useRealTimers();
  });

  it('settles timeout after the default 30 s', async () => {
    const settled = whenSceneSettled();
    vi.advanceTimersByTime(SCENE_GATE_TIMEOUT_MS - 1);
    expect(getSceneGateState().outcome).toBeNull();

    vi.advanceTimersByTime(1);
    await expect(settled).resolves.toBe('timeout');
    expect(getSceneGateState().reason).toMatch(/did not settle/);
  });

  it('honours a test override so a hanging-texture case is fast', async () => {
    __resetSceneGate(500);
    const settled = whenSceneSettled();
    vi.advanceTimersByTime(501);
    await expect(settled).resolves.toBe('timeout');
  });

  it('a late ready signal cannot override the timeout', async () => {
    __resetSceneGate(200);
    const settled = whenSceneSettled();
    vi.advanceTimersByTime(201);
    await expect(settled).resolves.toBe('timeout');

    markSceneReady();
    // One-shot: the first outcome is permanent.
    expect(getSceneGateState().outcome).toBe('timeout');
  });
});

describe('sceneGate — memoisation and subscription', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSceneGate();
  });
  afterEach(() => {
    __resetSceneGate();
    vi.useRealTimers();
  });

  it('returns the same promise every call', () => {
    const a = whenSceneSettled();
    const b = whenSceneSettled();
    expect(a).toBe(b);
  });

  it('every later caller sees the settled outcome', async () => {
    const first = whenSceneSettled();
    markSceneReady();
    await first;

    const second = whenSceneSettled();
    await expect(second).resolves.toBe('ready');
    expect(second).toBe(first);
  });

  it('resolves immediately if the scene settled before anyone asked', async () => {
    markSceneReady();
    await expect(whenSceneSettled()).resolves.toBe('ready');
  });

  it('notifies subscribers on each transition', () => {
    const seen: string[] = [];
    const unsub = subscribeSceneGate(() => seen.push(getSceneGateState().outcome ?? 'pending'));

    whenSceneSettled();
    // markTexturesDone fires a 'pending' notification (outcome still null), then
    // markFirstFrame completes the condition and fires 'ready'.
    markTexturesDone();
    markFirstFrame();

    expect(seen).toContain('pending');
    expect(seen).toContain('ready');
    unsub();
  });

  it('never rejects', async () => {
    const settled = whenSceneSettled();
    markSceneFailed('boom');
    await expect(settled).resolves.toBe('failed');
  });
});

describe('initEngine — scene gate interaction', () => {
  /**
   * The three policies must treat the gate differently, and that difference is the
   * whole point of Step 2:
   *
   *   eager      waits for the scene, then boots
   *   idle       waits for idle + visibility, then the scene, then boots
   *   on-demand  never waits
   *   user       never waits (explicit click)
   */
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSceneGate();
    vi.resetModules();
  });
  afterEach(() => {
    __resetSceneGate();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('eager boot does not start until the scene settles', async () => {
    const runScenario = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/duckdb', () => ({ runScenario }));
    vi.doMock('@/lib/data/dataset', () => ({
      loadDataset: () => Promise.resolve({ rows: [], text: '' }),
    }));

    const { initEngine, __resetInitEngine } = await import('@/lib/engine/init');
    // MUST use the gate instance the freshly-imported init module sees.
    // vi.resetModules() gives init.ts its own copy of sceneGate; driving the
    // statically-imported helpers would signal a different instance and the boot
    // would never proceed.
    const gate = await import('@/lib/engine/sceneGate');
    __resetInitEngine();
    gate.__resetSceneGate();

    initEngine();
    await vi.advanceTimersByTimeAsync(100);
    // Scene has not settled: nothing must have booted.
    expect(runScenario).not.toHaveBeenCalled();

    gate.markSceneReady();
    await vi.advanceTimersByTimeAsync(100);
    expect(runScenario).toHaveBeenCalledTimes(1);
  });

  it('eager boot starts immediately when the scene already failed', async () => {
    const runScenario = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/duckdb', () => ({ runScenario }));
    vi.doMock('@/lib/data/dataset', () => ({
      loadDataset: () => Promise.resolve({ rows: [], text: '' }),
    }));

    const { initEngine, __resetInitEngine } = await import('@/lib/engine/init');
    const gate = await import('@/lib/engine/sceneGate');
    __resetInitEngine();
    gate.__resetSceneGate();

    gate.markSceneFailed('WebGL unavailable');
    initEngine();
    await vi.advanceTimersByTimeAsync(100);
    expect(runScenario).toHaveBeenCalledTimes(1);
  });

  it('user-initiated enableEngine bypasses the gate entirely', async () => {
    const runScenario = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/duckdb', () => ({ runScenario }));
    vi.doMock('@/lib/data/dataset', () => ({
      loadDataset: () => Promise.resolve({ rows: [], text: '' }),
    }));

    const { enableEngine, __resetInitEngine } = await import('@/lib/engine/init');
    __resetInitEngine();

    // Scene deliberately never settled.
    enableEngine();
    await vi.advanceTimersByTimeAsync(100);
    expect(runScenario).toHaveBeenCalledTimes(1);
  });

  it('on-demand never boots and never waits on the gate', async () => {
    const runScenario = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/duckdb', () => ({ runScenario }));
    vi.doMock('@/lib/data/dataset', () => ({
      loadDataset: () => Promise.resolve({ rows: [], text: '' }),
    }));
    // saveData => on-demand.
    vi.stubGlobal('navigator', {
      connection: { saveData: true, effectiveType: '4g', downlink: 10 },
      deviceMemory: 8,
    });

    const { initEngine, __resetInitEngine } = await import('@/lib/engine/init');
    __resetInitEngine();

    initEngine();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runScenario).not.toHaveBeenCalled();
  });
});
