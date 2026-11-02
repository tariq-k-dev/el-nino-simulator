/**
 * The mobile shell: the compact header, and then either the portrait sheet or the landscape dock.
 *
 * ## Why this is a separate component rather than a branch inside `App`
 *
 * `App` is the only place that holds `activeRegion`, `focusNonce`, `scenario` and `units`, so it has to own the
 * STATE. It should not also own two layouts' worth of markup: the desktop overlays and the mobile shell are
 * mutually exclusive trees, and keeping the mobile one in its own file means `git blame` on `App.tsx` for the
 * desktop layout stays readable, and means the whole mobile surface is one directory.
 *
 * ## What MOBILE2 changed here
 *
 *   - MOBILE1's `sr-only` h1, floating island and separate Reset cluster are GONE. `HeaderCompact` owns the
 *     heading, the ENSO chip and every control, so there is exactly one Reset View, one unit toggle and one
 *     Snapshot in the DOM per mode, and the two rotate-ccw icons in the top right (one resetting the scenario,
 *     one the view) are one control.
 *   - The shell now DISPATCHES on the mode: `portrait` gets `SnapSheet`, `phoneLandscape` gets `LandscapeDock`.
 *     Both read the same `SheetBody`, so the region switcher is one path.
 *   - Entering portrait RESETS the sheet to peek. The prompt's rule is "the sheet tier resets to peek on every
 *     portrait entry", and portrait is reachable from landscape by rotation, so the trigger is a transition in
 *     the mode rather than a mount: a component that unmounts already lands at peek, but a rotation that keeps
 *     the shell mounted would otherwise carry the old tier across.
 *
 * The drawer, the cards and the control deck stay desktop-only; that gate is in `App.tsx` and is not this file's
 * business.
 */

import { useEffect, useRef } from 'react';
import type { AnalyticsPayload, RegionDefinition, RegionId, ScenarioMetrics, ScenarioState, UnitSystem } from '@/types/enso';
import { HeaderCompact } from '@/mobile/HeaderCompact';
import { LandscapeDock } from '@/mobile/LandscapeDock';
import { SnapSheet, type SnapSheetHandle } from '@/mobile/SnapSheet';
import type { LayoutMode2 } from '@/mobile/layoutMath';

interface MobileShellProps {
  /** The three-way mode, from the store. `desktop` is never passed: `App` does not mount this shell there. */
  mode: LayoutMode2;
  /** Layout viewport, so the dock can be exactly `dockWidth(w)` wide. */
  viewportW: number;
  /** The compact header's published bottom edge. */
  headerBottom: number;
  scenario: ScenarioState;
  metrics: ScenarioMetrics;
  analytics: AnalyticsPayload;
  region: RegionDefinition | null;
  activeRegion: RegionId | null;
  units: UnitSystem;
  exporting: boolean;
  onToggleUnits: () => void;
  onExport: () => void;
  onSelect: (id: RegionId | null) => void;
  onClearSelection: () => void;
  onScenarioChange: (patch: Partial<ScenarioState>) => void;
}

export function MobileShell({
  mode,
  viewportW,
  headerBottom,
  scenario,
  metrics,
  analytics,
  region,
  activeRegion,
  units,
  exporting,
  onToggleUnits,
  onExport,
  onSelect,
  onClearSelection,
  onScenarioChange,
}: MobileShellProps) {
  const sheetRef = useRef<SnapSheetHandle>(null);

  /*
   * The tier reset on portrait entry.
   *
   * `wasPortrait` starts false, so the FIRST entry (which is the mount on a phone held upright) resets too — the
   * sheet mounts at peek anyway, so that costs nothing and keeps the rule unconditional. A rotation out and back
   * resets again, which is the case the prompt names.
   */
  const wasPortrait = useRef(false);
  useEffect(() => {
    const isPortrait = mode === 'portrait';
    if (isPortrait && !wasPortrait.current) sheetRef.current?.resetTier();
    wasPortrait.current = isPortrait;
  }, [mode]);

  return (
    <>
      <HeaderCompact
        mode={mode}
        viewportW={viewportW}
        anomalyC={scenario.sstAnomaly}
        units={units}
        onToggleUnits={onToggleUnits}
        onExport={onExport}
        exporting={exporting}
        onClearSelection={onClearSelection}
        onSstChange={(value) => onScenarioChange({ sstAnomaly: value })}
      />

      {mode === 'portrait' ? (
        <SnapSheet
          ref={sheetRef}
          metrics={metrics}
          analytics={analytics}
          scenarioSst={scenario.sstAnomaly}
          region={region}
          units={units}
          activeRegion={activeRegion}
          onSelect={(id) => onSelect(id)}
          onClearSelection={onClearSelection}
          onSstChange={(value) => onScenarioChange({ sstAnomaly: value })}
          onChangeScenario={(patch) => onScenarioChange(patch)}
        />
      ) : null}

      {mode === 'phoneLandscape' ? (
        <LandscapeDock
          viewportW={viewportW}
          headerBottom={headerBottom}
          metrics={metrics}
          analytics={analytics}
          scenarioSst={scenario.sstAnomaly}
          region={region}
          units={units}
          activeRegion={activeRegion}
          onSelect={(id) => onSelect(id)}
          onClearSelection={onClearSelection}
          onSstChange={(value) => onScenarioChange({ sstAnomaly: value })}
          onChangeScenario={(patch) => onScenarioChange(patch)}
        />
      ) : null}
    </>
  );
}
