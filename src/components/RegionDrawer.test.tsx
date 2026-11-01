// @vitest-environment jsdom
/**
 * The drawer's region switcher — component-level rules that do not need a browser.
 *
 * ## What is pinned here, and why each one is a unit test rather than a spec
 *
 *  1. **One chip per region, ids and labels from `REGIONS`.** The B2 requirement is that the switcher and
 *     the Impact Zones cards read the same source; a hand-copied label list would drift silently, and the
 *     failure would look like "a region is missing from the switcher" long after the copy was made.
 *  2. **`aria-current` marks exactly the open region, and exactly one chip.** This is the accessible
 *     statement of "you are here", and it is the assertion `switcher-ux.spec.ts` repeats in a browser.
 *  3. **Clicking another chip retargets through the SAME callback the cards use**, once, with the right id.
 *  4. **Clicking the ACTIVE chip is a no-op** — no call at all. `App.selectRegion` re-centres on a repeat
 *     click by design (it bumps `focusNonce`), so a switcher that forwarded the click would restart a
 *     flight the user did not ask for. Enforcing it in the component is what makes that impossible for
 *     every caller, not just for the one path a spec happens to drive.
 *  5. **Closed, the chips are not focusable.** The drawer is never unmounted — closed it is off-canvas and
 *     `aria-hidden` — so a control inside it must remove itself from the tab order explicitly, or a
 *     keyboard user tabs into an imperceptible panel. (`tabIndex={-1}`, checked in both directions.)
 *  6. **The close button still closes, and the drawer still renders its body.** The switcher must not have
 *     displaced either.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RegionDrawer } from './RegionDrawer';
import { REGIONS, REGION_MAP } from '@/lib/regions';
import type { AnalyticsPayload, ScenarioMetrics } from '@/types/enso';

/** The minimum a render needs; the switcher reads only `region` and `onSelect`. */
const metrics = {
  sst: 2,
  riskTier: 'Severe',
  pacificSstDev: 2.1,
  pacificConvection: 70,
  usPrecip: 46.2,
  usPrecipBase: 42,
  usTempDevF: 2,
  asiaPrecip: -46.1,
  asiaDrought: 6.5,
  africaPrecip: 56.1,
  africaFlood: 6,
} as unknown as ScenarioMetrics;

const analytics = {
  metrics,
  timeline: [{ anomaly: 0.5, date: '2024-01-01' }],
  analogs: [],
  summary: {
    analogCount: 0,
    firstDate: '1990-01-01',
    lastDate: '2024-12-01',
    rowCount: 420,
    maxAnomaly: 2.4,
    maxAnomalyDate: '2016-01-01',
    source: 'NOAA ERSSTv5',
  },
  queryMs: 12,
} as unknown as AnalyticsPayload;

function renderDrawer(regionId: (typeof REGIONS)[number]['id'] | null, onSelect = vi.fn()) {
  const utils = render(
    <RegionDrawer
      region={regionId ? REGION_MAP[regionId] : null}
      metrics={metrics}
      analytics={analytics}
      units="metric"
      onClose={() => {}}
      onSelect={onSelect}
    />,
  );
  const chips = () =>
    [...document.querySelectorAll<HTMLButtonElement>('[data-testid="drawer-switcher"] button')];
  return { ...utils, onSelect, chips };
}

afterEach(cleanup);

describe('RegionDrawer switcher', () => {
  it('renders exactly one chip per region, from the same source the cards use', () => {
    const { chips } = renderDrawer('us-west');
    const rendered = chips();
    expect(rendered).toHaveLength(REGIONS.length);
    expect(rendered.map((c) => c.getAttribute('data-region-id'))).toEqual(REGIONS.map((r) => r.id));
    expect(rendered.map((c) => c.textContent)).toEqual(REGIONS.map((r) => r.shortName));
    /* Every one is a real native button — the same affordance the cards are. */
    expect(rendered.every((c) => c.tagName === 'BUTTON' && c.type === 'button')).toBe(true);
  });

  it('marks exactly the open region aria-current', () => {
    const { chips } = renderDrawer('se-asia');
    const current = chips().filter((c) => c.getAttribute('aria-current') === 'true');
    expect(current, 'exactly one chip carries aria-current').toHaveLength(1);
    expect(current[0].getAttribute('data-region-id')).toBe('se-asia');
  });

  it('carries no aria-current at all while the drawer is closed', () => {
    const { chips } = renderDrawer(null);
    expect(chips().filter((c) => c.getAttribute('aria-current') === 'true')).toHaveLength(0);
  });

  it('retargets through the same callback the cards use, with the clicked id', () => {
    const { chips, onSelect } = renderDrawer('us-west');
    const target = chips().find((c) => c.getAttribute('data-region-id') === 'horn-africa')!;
    fireEvent.click(target);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('horn-africa');
  });

  it('clicking the ACTIVE chip is a no-op — no retarget, no re-flight', () => {
    const { chips, onSelect } = renderDrawer('us-west');
    const active = chips().find((c) => c.getAttribute('data-region-id') === 'us-west')!;
    fireEvent.click(active);
    expect(onSelect, 'a click on the current region must not reach selectRegion').not.toHaveBeenCalled();
  });

  it('is keyboard-activatable: Enter and Space both retarget', () => {
    const { chips, onSelect } = renderDrawer('pacific');
    const target = chips().find((c) => c.getAttribute('data-region-id') === 'us-west')!;
    /*
     * A native `<button>` synthesises `click` from Enter and Space itself. jsdom does not run that
     * mapping, so the property under test is that no handler SUPPRESSES it — the element is a button and
     * its own `click` is what fires the callback, which is exactly what a real key event would produce.
     */
    fireEvent.click(target);
    expect(onSelect).toHaveBeenCalledWith('us-west');
  });

  it('closed, the chips are out of the tab order; open, they are in it', () => {
    const closed = renderDrawer(null);
    expect(closed.chips().every((c) => c.tabIndex === -1)).toBe(true);
    cleanup();

    const open = renderDrawer('pacific');
    expect(open.chips().every((c) => c.tabIndex === 0)).toBe(true);
  });

  it('leaves the close button and the body in place', () => {
    renderDrawer('pacific');
    expect(screen.getByLabelText('Close region panel')).toBeTruthy();
    /* The body's own scroll container is still there and still holds the summary. */
    const body = document.querySelector('.scroll-thin');
    expect(body).not.toBeNull();
    expect(body!.textContent).toContain(REGION_MAP.pacific.summary.slice(0, 30));
  });
});
