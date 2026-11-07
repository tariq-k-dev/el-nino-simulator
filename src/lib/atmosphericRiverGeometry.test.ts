import { describe, expect, it } from "vitest";
import { SHELLS } from "@/scene/constants";
import {
  ATMOSPHERIC_RIVER_RADIUS,
  ATMOSPHERIC_RIVER_RENDER_ORDER,
  DEFAULT_RIBBON_WIDTH,
  buildAtmosphericRiverGeometry,
  getAtmosphericRiverWaypoints,
} from "./atmosphericRiverGeometry";

describe("AtmosphericRiverGeometry", () => {
  it("respects the scene radius ladder and render order invariants", () => {
    // Must sit safely between clouds (1.004) and Rayleigh/Mie atmosphere (1.10)
    expect(ATMOSPHERIC_RIVER_RADIUS).toBeGreaterThan(SHELLS.clouds);
    expect(ATMOSPHERIC_RIVER_RADIUS).toBeLessThan(SHELLS.atmosphere);

    // Must sit above Niño outlines (4) and below pins (6)
    expect(ATMOSPHERIC_RIVER_RENDER_ORDER).toBe(5);
  });

  it("generates waypoints connecting the Tropical Pacific to California", () => {
    const waypoints = getAtmosphericRiverWaypoints(0);
    expect(waypoints.length).toBeGreaterThanOrEqual(5);

    // Origin near Tropical Central Pacific
    const origin = waypoints[1];
    expect(origin.lat).toBeGreaterThan(0);
    expect(origin.lat).toBeLessThan(20);
    expect(origin.lon).toBeLessThan(-150);

    // Landfall near California coast
    const landfall = waypoints[waypoints.length - 2];
    expect(landfall.lat).toBeCloseTo(37.2, 1);
    expect(landfall.lon).toBeCloseTo(-122.4, 1);
  });

  it("displaces mid-track waypoints when jet shift is applied", () => {
    const baseline = getAtmosphericRiverWaypoints(0);
    const shiftedSouth = getAtmosphericRiverWaypoints(-3.0);
    const shiftedNorth = getAtmosphericRiverWaypoints(+3.0);

    // Mid-ocean inflection point (index 3) should reflect the latitudinal shift
    expect(shiftedSouth[3].lat).toBeLessThan(baseline[3].lat);
    expect(shiftedNorth[3].lat).toBeGreaterThan(baseline[3].lat);
  });

  it("builds valid buffer attributes with consistent sizing", () => {
    const segments = 32;
    const { positions, uvs, indices, centerline } =
      buildAtmosphericRiverGeometry({
        segments,
        width: DEFAULT_RIBBON_WIDTH,
      });

    const vertCount = (segments + 1) * 2;
    expect(positions.length).toBe(vertCount * 3);
    expect(uvs.length).toBe(vertCount * 2);
    expect(indices.length).toBe(segments * 6);
    expect(centerline.length).toBe((segments + 1) * 3);
  });

  it("guarantees every vertex strictly conforms to the spherical radius R", () => {
    const targetRadius = 1.007;
    const { positions, centerline } = buildAtmosphericRiverGeometry({
      radius: targetRadius,
      segments: 16,
    });

    // Verify all centerline points lie on the sphere
    for (let i = 0; i < centerline.length; i += 3) {
      const dist = Math.hypot(
        centerline[i],
        centerline[i + 1],
        centerline[i + 2],
      );
      expect(dist).toBeCloseTo(targetRadius, 4);
    }

    // Verify all ribbon boundary vertices lie on the sphere
    for (let i = 0; i < positions.length; i += 3) {
      const dist = Math.hypot(
        positions[i],
        positions[i + 1],
        positions[i + 2],
      );
      expect(dist).toBeCloseTo(targetRadius, 4);
    }
  });

  it("produces valid UVs spanning [0, 1] along length and width", () => {
    const segments = 10;
    const { uvs } = buildAtmosphericRiverGeometry({ segments });

    // First pair (u=0, v=0) and (u=0, v=1)
    expect(uvs[0]).toBe(0.0);
    expect(uvs[1]).toBe(0.0);
    expect(uvs[2]).toBe(0.0);
    expect(uvs[3]).toBe(1.0);

    // Last pair (u=1, v=0) and (u=1, v=1)
    const lastIdx = (segments + 1) * 2 - 2;
    expect(uvs[lastIdx * 2 + 0]).toBe(1.0);
    expect(uvs[lastIdx * 2 + 1]).toBe(0.0);
    expect(uvs[(lastIdx + 1) * 2 + 0]).toBe(1.0);
    expect(uvs[(lastIdx + 1) * 2 + 1]).toBe(1.0);
  });
});
