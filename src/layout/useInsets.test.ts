/**
 * The runtime layer's testable half.
 *
 * The environment here is jsdom, which has no `ResizeObserver` and no layout engine — every rect is
 * 0x0 and no observation would ever fire. Rather than mock two browser APIs to test plumbing whose
 * only job is to call `computeInsets`, these tests cover the pieces that can actually be wrong
 * independently of a browser: rect extraction from the DOM, viewport reading, and the PUBLISH
 * contract (notify on change, stay silent otherwise), which is the part `useSyncExternalStore`
 * depends on for correctness.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getInsets,
  measureNow,
  readOccluderRects,
  readViewport,
  subscribeInsets,
  OCCLUDER_ATTR,
} from './useInsets';

/** A document stub whose marked elements report fixed rects. */
function stubDoc(rects: Array<{ id: string; left: number; top: number; right: number; bottom: number }>) {
  return {
    querySelectorAll: (sel: string) => {
      expect(sel).toBe(`[${OCCLUDER_ATTR}]`);
      return rects.map((r) => ({
        getAttribute: (a: string) => (a === OCCLUDER_ATTR ? r.id : null),
        getBoundingClientRect: () => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }),
      }));
    },
  } as unknown as Document;
}

const win = { innerWidth: 1280, innerHeight: 800 } as unknown as Window;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readOccluderRects', () => {
  it('returns one rect per marked element, with the attribute value as its id', () => {
    const doc = stubDoc([
      { id: 'left-panel', left: 0, top: 311.5, right: 360.844, bottom: 800 },
      { id: 'top-panel', left: 0, top: 0, right: 1280, bottom: 118.25 },
    ]);
    expect(readOccluderRects(doc)).toEqual([
      { id: 'left-panel', left: 0, top: 311.5, right: 360.844, bottom: 800 },
      { id: 'top-panel', left: 0, top: 0, right: 1280, bottom: 118.25 },
    ]);
  });

  it('an element with no id attribute still yields a rect (id empty, not dropped)', () => {
    const doc = {
      querySelectorAll: () => [
        {
          getAttribute: () => null,
          getBoundingClientRect: () => ({ left: 0, top: 0, right: 10, bottom: 10 }),
        },
      ],
    } as unknown as Document;
    expect(readOccluderRects(doc)).toEqual([{ id: '', left: 0, top: 0, right: 10, bottom: 10 }]);
  });
});

describe('readViewport', () => {
  it('reads innerWidth / innerHeight', () => {
    expect(readViewport(win)).toEqual({ w: 1280, h: 800 });
  });
});

describe('measureNow / publish contract', () => {
  it('publishes a computed result and notifies a subscriber once', () => {
    const doc = stubDoc([{ id: 'left-panel', left: 0, top: 311.5, right: 360.844, bottom: 800 }]);
    const spy = vi.fn();
    const off = subscribeInsets(spy);
    const out = measureNow(doc, win);
    expect(out.left).toBe(360.844);
    expect(out.free.w).toBe(919.156);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getInsets()).toBe(out);
    off();
  });

  it('does NOT notify when the same numbers are measured again', () => {
    const doc = stubDoc([{ id: 'left-panel', left: 0, top: 311.5, right: 360.844, bottom: 800 }]);
    measureNow(doc, win);
    const spy = vi.fn();
    const off = subscribeInsets(spy);
    measureNow(doc, win);
    expect(spy).not.toHaveBeenCalled();
    off();
  });

  it('notifies again when a value actually moves', () => {
    const docA = stubDoc([{ id: 'left-panel', left: 0, top: 311.5, right: 360.844, bottom: 800 }]);
    measureNow(docA, win);
    const spy = vi.fn();
    const off = subscribeInsets(spy);
    const docB = stubDoc([{ id: 'left-panel', left: 0, top: 311.5, right: 400, bottom: 800 }]);
    measureNow(docB, win);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getInsets().left).toBe(400);
    off();
  });
});
