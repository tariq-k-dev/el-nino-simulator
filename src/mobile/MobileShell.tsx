/**
 * The mobile shell: the sheet, the island, and the two controls that survive the header collapse.
 *
 * ## Why this is a separate component rather than a branch inside `App`
 *
 * `App` is the only place that holds `activeRegion`, `focusNonce`, `scenario` and `units`, so it has to own the
 * STATE. It should not also own two layouts' worth of markup: the desktop overlays and the mobile shell are
 * mutually exclusive trees, and keeping the mobile one in its own file means `git blame` on `App.tsx` for the
 * desktop layout stays readable, and means the whole mobile surface is one directory.
 *
 * ## The header collapse
 *
 * On a phone the desktop header's identity row, alert badge and four buttons would cover the top of the globe,
 * which is the part the sheet does NOT hide. So the header is replaced by:
 *
 *   - an `sr-only` `h1`, because the document still needs exactly one top-level heading and a screen reader
 *     should still announce what the page is;
 *   - the `ResetViewButton`, unchanged and beside the island, because it is the one control whose absence would
 *     be a functional loss (a reader who zooms cannot otherwise get back);
 *   - the island, which carries the live ENSO state and the scrubber.
 *
 * The Snapshot/download and unit-toggle buttons are dropped rather than shrunk: the download path writes a
 * desktop-shaped PNG report and the unit toggle changes labels inside the sheet, which now reads them from the
 * same `units` state, so neither is *unavailable* — they are simply not in the top bar. This is a deliberate
 * scope decision recorded in `docs/MOBILE.md`.
 */

import { RotateCcw } from 'lucide-react';
import type { AnalyticsPayload, RegionDefinition, RegionId, ScenarioMetrics, ScenarioState, UnitSystem } from '@/types/enso';
import { ResetViewButton } from '@/components/ResetViewButton';
import { SnapSheet } from '@/mobile/SnapSheet';
import { TopIsland } from '@/mobile/TopIsland';

interface MobileShellProps {
  scenario: ScenarioState;
  metrics: ScenarioMetrics;
  analytics: AnalyticsPayload;
  region: RegionDefinition | null;
  activeRegion: RegionId | null;
  units: UnitSystem;
  onSelect: (id: RegionId | null) => void;
  onClearSelection: () => void;
  onScenarioChange: (patch: Partial<ScenarioState>) => void;
  onResetScenario: () => void;
}

export function MobileShell({
  scenario,
  metrics,
  analytics,
  region,
  activeRegion,
  units,
  onSelect,
  onClearSelection,
  onScenarioChange,
  onResetScenario,
}: MobileShellProps) {
  return (
    <>
      {/*
        The heading the collapsed header still owes the document. `sr-only` rather than `hidden`: a display:none
        h1 is not in the accessibility tree at all, so the page would have NO level-one heading on a phone.
      */}
      <h1 className="sr-only">Super El Niño Global Impact Simulator</h1>

      <TopIsland
        anomalyC={scenario.sstAnomaly}
        onSstChange={(value) => onScenarioChange({ sstAnomaly: value })}
      />

      {/*
        Reset beside the island, with the same aria and the same behaviour as the desktop instance: this is the
        same COMPONENT, so the two cannot drift. `top-3` clears the island's own row (44 px capsule plus the safe
        area inset), and the 44 px box is what the prompt's touch minimum asks for.
      */}
      <div
        className="pointer-events-none fixed right-3 z-40"
        style={{ top: 'calc(env(safe-area-inset-top) + 8px)' }}
      >
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onResetScenario}
            aria-label="Reset the scenario levers to the Super El Niño baseline"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-slate-950/80 text-slate-300 backdrop-blur-md focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50"
          >
            <RotateCcw size={14} />
          </button>
          <ResetViewButton onClearSelection={onClearSelection} />
        </div>
      </div>

      <SnapSheet
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
    </>
  );
}
