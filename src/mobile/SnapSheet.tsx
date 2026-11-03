/**
 * The portrait snap-sheet: one fixed element, three tiers, a body shared with the landscape dock.
 *
 * ## DOM placement is a correctness requirement, not a style choice
 *
 * R3F connects its DOM listeners to the `<Canvas>` WRAPPER DIV (`react-three-fiber.esm.js:86`), and
 * `onPointerMissed` fires on a click that hits nothing in the scene (`events-*.esm.js:1157-1162`) — which the
 * app wires to `onSelect(null)` (`GlobeScene.tsx:622`). A sheet placed INSIDE that wrapper would therefore
 * clear the region selection on every tap on the sheet, because a tap on the sheet raycasts through to empty
 * space. `App.tsx` renders this component as a SIBLING of `#globe-canvas` for that reason.
 *
 * ## Why the tier state lives here and not in the store
 *
 * It is UI-local, it changes at most a few times per gesture, and nothing outside the sheet reads it except the
 * probe. The store is for values a SECOND, non-React reader needs every frame; a tier is not one.
 *
 * ## Why the body scrolls natively
 *
 * `touch-action: pan-y` plus `overscroll-behavior: contain` on the body means the browser owns the scroll, with
 * momentum and its own bounce contained to the sheet. Dragging is bound to the HANDLE only, so the two gesture
 * surfaces cannot compete: a touch that starts on the body scrolls, and a touch that starts on the handle drags.
 *
 * ## Step MOBILE2: three changes to this file
 *
 *   1. **The header zone WRAPS.** MOBILE1 printed the region name with `truncate` inside a `min-w-0` flex item,
 *      so `GLOBAL ENSO STATE` was ellipsised at 412 px. The title is now a wrapping block with no
 *      `truncate`/`text-overflow`, the region pill and the anomaly badge can fall to a second line, and the
 *      sparkline beside it is a fixed 72 px that cannot be what squeezes the title.
 *   2. **The BODY is `SheetBody`.** The Half and Full content — including the FIX2 in-drawer region switcher and
 *      its `onSelect` path — moved to `mobile/SheetBody.tsx` so the landscape dock renders the same tree rather
 *      than a copy.
 *   3. **A tablet cap.** The sheet's own box is `max-width: 640px` and centred, so a 768x1024 tablet does not get
 *      768 px of line length. It is the sheet that is capped, NOT a wrapper: a wrapper wide enough to centre it
 *      would also swallow canvas touches either side of the sheet, and those must still reach OrbitControls.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { AnalyticsPayload, RegionDefinition, RegionId, ScenarioMetrics, ScenarioState, UnitSystem } from '@/types/enso';
import { Sparkline } from '@/components/ui/Sparkline';
import { thermalColor } from '@/lib/model';
import { ensoCategory, ensoLabel, formatAnomaly } from '@/mobile/ensoHud';
import { useSheetDrag, useSheetKeys } from '@/mobile/useSheetDrag';
import { SheetBody } from '@/mobile/SheetBody';
import { sheetHeight, tierIndex, type Tier } from '@/mobile/snapMath';
import { getLayoutSignal } from '@/scene/viewStore';

/**
 * The marker the e2e build proves is ABSENT from production.
 *
 * Same convention as `LOCKED_BRANCH_MARKER` (`layout/framing.ts:45`): a literal that exists only inside a
 * `VITE_E2E`-gated block, so `check-assets.mjs` can grep `dist/assets/*.js` and find zero, while
 * `dist-e2e/assets/*.js` contains one.
 */
export const MOBILE_SNAP_MARKER = 'mobile-snap-probe-3m1';

/**
 * Step MOBILE2's own marker.
 *
 * A SECOND literal rather than a rename, because the two certify different builds: `mobile-snap-probe-3m1` proves
 * the MOBILE1 sheet shipped, and this one proves THIS step's layout lane shipped — the three-way mode, the
 * published header bottom and the free rect. Both must be absent from `dist` and present in `dist-e2e`.
 */
export const MOBILE_LAYOUT_MARKER = 'mobile-layout-probe-3m2';

/** The probe shape the e2e build installs on `window`. */
export interface MobileSheetProbe {
  marker: string;
  layoutMarker: string;
  tier: Tier;
  tierIndex: number;
  /** The sheet's own translate in px, read off the inline style, not off a rect. */
  translateY: number;
  /** Renders of this component since load. The M5 case asserts it does NOT move during a drag. */
  renders: number;
  /** Drags started so far — proof the gesture reached the engine at all, beside the render count. */
  drags: number;
  viewportH: number;
  sheetHeight: number;
  points: { peek: number; half: number; full: number };
  /** Step MOBILE2: the three-way mode, read from the store so it cannot drift from `data-layout-mode`. */
  layoutMode: string;
  /** Step MOBILE2: the published compact-header bottom, px. */
  headerBottom: number;
  read: () => MobileSheetProbeState;
}

export interface MobileSheetProbeState {
  marker: string;
  layoutMarker: string;
  tier: Tier;
  tierIndex: number;
  translateY: number;
  renders: number;
  drags: number;
  viewportH: number;
  sheetHeight: number;
  points: { peek: number; half: number; full: number };
  layoutMode: string;
  headerBottom: number;
}

/** What a caller can do imperatively. Only the tier reset, which `MobileShell` triggers on portrait entry. */
export interface SnapSheetHandle {
  /** Return to peek. Called on every entry into portrait — the prompt's tier-reset rule. */
  resetTier: () => void;
}

interface SnapSheetProps {
  metrics: ScenarioMetrics;
  analytics: AnalyticsPayload;
  scenarioSst: number;
  region: RegionDefinition | null;
  units: UnitSystem;
  activeRegion: RegionId | null;
  onSelect: (id: RegionId) => void;
  onClearSelection: () => void;
  /** The desktop scrubber's own action, so the sheet's copy writes the same state. */
  onSstChange: (value: number) => void;
  /** Jets and cropland weight — the teleconnection sliders, reused rather than duplicated. */
  onChangeScenario: (patch: Pick<Partial<ScenarioState>, 'jetStreamShift' | 'agricultureWeight'>) => void;
  /** The Niño box last flown to (C2.1), forwarded to the cards for `aria-pressed`. */
  activeNinoBox: string | null;
  /** The "Show on globe" trigger. The ONLY way a Niño box is flown to. */
  onShowOnGlobe: (boxId: string) => void;
}

/**
 * The viewport height the sheet is sized against.
 *
 * `visualViewport.height` when it exists, because on a phone the LAYOUT viewport (`innerHeight`) includes the
 * area under a collapsing browser toolbar: sizing against it makes the sheet taller than the screen and pushes
 * its handle under the address bar. `innerHeight` is the fallback for engines without `visualViewport`.
 */
function readViewportHeight(): number {
  if (typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  if (vv && Number.isFinite(vv.height) && vv.height > 0) return vv.height;
  return window.innerHeight;
}

/** The tablet cap, px. Below this the sheet spans the viewport; at or above it, it is bounded and centred. */
export const SHEET_TABLET_MAX_W = 640;

export const SnapSheet = forwardRef<SnapSheetHandle, SnapSheetProps>(function SnapSheet(
  {
    metrics,
    analytics,
    scenarioSst,
    region,
    units,
    activeRegion,
    onSelect,
    onClearSelection,
    onSstChange,
    onChangeScenario,
    activeNinoBox,
    onShowOnGlobe,
  },
  ref,
) {
  const [tier, setTier] = useState<Tier>('peek');
  const [viewportH, setViewportH] = useState<number>(() => readViewportHeight());

  /**
   * Has the FULL tier ever been reached?
   *
   * MOBILE1 lazily mounted the heavy sections on first arrival and kept them mounted afterwards, so a reader who
   * collapsed and reopened did not pay for a re-mount (and a re-parse of the analogs table) on every snap. That
   * behaviour is KEPT: the sections mount from the first `full` arrival onwards and are merely hidden at lower
   * tiers, which is also what keeps them out of the tab order there (`display:none` removes them from it).
   */
  const [fullMounted, setFullMounted] = useState(false);
  if (tier === 'full' && !fullMounted) setFullMounted(true);

  const onTierChange = useCallback((next: Tier) => setTier(next), []);
  const { sheetRef, handleRef, points, dragCount } = useSheetDrag({ tier, onTierChange, viewportH });
  const onKeyDown = useSheetKeys(tier, onTierChange);

  /* The tier reset the shell drives on every portrait entry. */
  useImperativeHandle(ref, () => ({ resetTier: () => setTier('peek') }), []);

  /* --------------------------------------------------------------- geometry plumbing */

  /**
   * Re-measure on resize, orientation change and visualViewport resize, coalesced to one per frame.
   *
   * Three sources because they are three different events on a phone: `resize` fires for a window drag,
   * `orientationchange` fires before the new metrics are settled (hence the rAF), and `visualViewport.resize`
   * is the ONLY one that fires when the address bar collapses. Throttling to a rAF is what keeps a rotation from
   * producing twenty measurements.
   */
  useEffect(() => {
    let frame: number | null = null;
    const measure = (): void => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setViewportH(readViewportHeight());
      });
    };
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);
    measure();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, []);

  /* --------------------------------------------------------------------- the probe */

  const renderCount = useRef(0);
  renderCount.current += 1;

  /**
   * `window.__mobileSheet`, installed only in an instrumented build.
   *
   * A ref-held object with a `read()` rather than a snapshot: the M5 case polls it, and a getter-per-field
   * object would let six reads straddle two renders — the same reasoning `lib/frameProbe.ts` documents.
   */
  useEffect(() => {
    if (import.meta.env.VITE_E2E !== '1') return undefined;
    const read = (): MobileSheetProbeState => {
      const signal = getLayoutSignal();
      return {
        marker: MOBILE_SNAP_MARKER,
        layoutMarker: MOBILE_LAYOUT_MARKER,
        tier,
        tierIndex: tierIndex(tier),
        translateY: points[tier],
        renders: renderCount.current,
        drags: dragCount(),
        viewportH,
        sheetHeight: sheetHeight(viewportH),
        points,
        layoutMode: signal.mode,
        headerBottom: signal.headerBottom,
      };
    };
    (window as unknown as { __mobileSheet?: MobileSheetProbe }).__mobileSheet = { ...read(), read };
    return () => {
      delete (window as unknown as { __mobileSheet?: MobileSheetProbe }).__mobileSheet;
    };
  }, [tier, points, viewportH, dragCount]);

  /* ------------------------------------------------------------------------- render */

  const accent = thermalColor(metrics.sst, 0.95);
  const h = sheetHeight(viewportH);
  const isFull = tier === 'full';
  const isPeek = tier === 'peek';
  const category = ensoCategory(scenarioSst);
  const analogSpark = useMemo(() => analytics.timeline.map((p) => p.anomaly), [analytics.timeline]);

  return (
    <div
      ref={sheetRef as React.RefObject<HTMLDivElement>}
      data-tier={tier}
      data-mobile-sheet=""
      role="region"
      aria-label="Impact analysis sheet"
      className={[
        'pointer-events-auto fixed inset-x-0 bottom-0 z-30 mx-auto flex flex-col rounded-t-2xl border-t',
        /*
         * Backdrop rules per the prompt: blur at FULL only, flat at peek/half to protect WebGL frame time.
         * `backdrop-blur-xl` runs a second compositor pass over the whole sheet, which on a phone costs more
         * than the tier's extra content is worth while the globe is being dragged.
         */
        isFull ? 'border-white/12 bg-slate-950/80 backdrop-blur-xl' : 'border-white/[0.08] bg-slate-950/85',
        'shadow-[0_-8px_40px_-12px_rgba(0,0,0,0.9)]',
        /* `env(safe-area-inset-bottom)` keeps the last row clear of the home indicator. */
        'pb-[env(safe-area-inset-bottom)]',
        /* The tablet cap: centred, bounded, and only the sheet — see the file header. */
        'max-w-[min(100%,640px)]',
      ].join(' ')}
      style={{
        height: `${h}px`,
        transform: `translate3d(0, ${points[tier]}px, 0)`,
        /*
         * Set once on mount so the FIRST paint is already at peek; the hook writes the style directly during
         * drags and on snap. Without this the element would paint at translateY(0) (full) for one frame.
         */
        transition: 'none',
      }}
    >
      {/* ------------------------------------------------------------- the handle zone */}
      {/*
        The handle plus the header row. `touch-action: none` here is what lets the browser hand the gesture to
        this element instead of claiming it for a page scroll, and it is scoped to this zone only so the body
        below keeps its native pan.
      */}
      <div
        ref={handleRef as React.RefObject<HTMLDivElement>}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={tierIndex(tier)}
        aria-valuetext={tier === 'peek' ? 'Peek' : tier === 'half' ? 'Half' : 'Full'}
        aria-label="Sheet position"
        onKeyDown={onKeyDown}
        className="shrink-0 select-none px-4 pb-2 pt-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
        style={{ touchAction: 'none', minHeight: '44px' }}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-white/25" aria-hidden />
        {/*
          The header zone, which WRAPS rather than truncates. The title block takes the first line and may take a
          second if it must; the anomaly and the region pill wrap under it. The sparkline is a fixed 72 px in a
          `shrink-0` box, so it can never be the element that squeezes the title into an ellipsis.
        */}
        <div className="mt-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div
              data-testid="sheet-title"
              className="break-words font-mono text-[10px] uppercase leading-snug tracking-[0.16em] text-slate-400"
            >
              {region ? region.name : 'Global ENSO state'}
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="num text-[20px] font-semibold leading-none" style={{ color: accent }}>
                {formatAnomaly(scenarioSst)}
              </span>
              <span
                className="rounded-full px-1.5 py-[1px] font-mono text-[8.5px] uppercase tracking-[0.12em]"
                style={{ background: `${accent}22`, color: accent }}
              >
                {ensoLabel(category)}
              </span>
            </div>
          </div>
          <div className="shrink-0" style={{ width: 72 }}>
            <Sparkline data={analogSpark} height={72} accent={accent} ariaLabel="Dataset anomaly timeline" />
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------- the body */}
      <div
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4"
        style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}
      >
        <SheetBody
          surface={isPeek ? 'peek' : isFull ? 'full' : 'half'}
          metrics={metrics}
          analytics={analytics}
          scenarioSst={scenarioSst}
          region={region}
          units={units}
          activeRegion={activeRegion}
          onSelect={onSelect}
          onClearSelection={onClearSelection}
          onSstChange={onSstChange}
          onChangeScenario={onChangeScenario}
          activeNinoBox={activeNinoBox}
          onShowOnGlobe={onShowOnGlobe}
        />
        {/*
          The full tier's sections live in `SheetBody` behind `surface`. This latch is what keeps MOBILE1's
          "mount on first arrival, then keep" promise in the sense the probe can see: once the reader has reached
          full, a snap back and forth no longer changes the MOUNTED SET.
        */}
        <span hidden data-full-latched={fullMounted ? 'true' : 'false'} />
      </div>
    </div>
  );
});

/**
 * The render counter the M5 case reads, exposed through the probe as `renders`.
 *
 * Re-exported so a reader of this file can see the contract in one place; the value is `renderCount` inside the
 * component and the probe publishes it.
 */
export const RENDER_COUNTER_SOURCE = 'SnapSheet renderCount ref, published as __mobileSheet.renders';
