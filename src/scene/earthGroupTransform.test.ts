/**
 * The earth group's transform is Y-rotation ONLY — proved, not assumed.
 *
 * ## Why this test exists
 *
 * `CameraDirector.focusNinoBox` converts a Niño box's lat/lon into a WORLD-space aim direction with
 * `new THREE.Vector3(x, y, z).applyAxisAngle(SPIN_AXIS_Y, spin.current.y)`. That is only equal to the
 * group's real `matrixWorld` transform while the group's transform is a pure Y rotation.
 *
 * `EarthSystem.tsx` writes `groupRef.current.rotation.y = spin.current.y` every frame and
 * `<EarthSystem>` is mounted with no transform prop, so today the two agree exactly. But nothing
 * ENFORCED that: a `rotation.x` for axial tilt, a `scale`, or a `position` added to that group later
 * would silently invalidate the aim, and the symptom would be a box outline drifting off-centre with
 * no test failing. `ninoFraming`'s tests cannot catch it — they are pure arithmetic on fractions and
 * never see a THREE object.
 *
 * This test reads the SOURCE rather than a live scene, so it needs no WebGL and runs in the normal
 * vitest pass. It is deliberately a source assertion: the property is "the transform written in this
 * file is Y-only", and a rendered-instance assertion could not distinguish "no tilt was applied" from
 * "no tilt was applied yet".
 *
 * ## What to do if this fails
 *
 * Do not relax the test. Either switch `focusNinoBox` to a real `matrixWorld` apply (apply the group's
 * matrix to the local vector once at press time), or add the missing component to the aim arithmetic.
 * The assertion exists to force that decision at the moment the tilt is introduced.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const EARTH_SYSTEM = resolve(__dirname, "EarthSystem.tsx");
const GLOBE_SCENE = resolve(__dirname, "GlobeScene.tsx");

const earthSystemSource = readFileSync(EARTH_SYSTEM, "utf8");
const globeSceneSource = readFileSync(GLOBE_SCENE, "utf8");

describe("the earth group transform is Y-rotation only", () => {
    it("writes rotation.y from the spin ref, and no other rotation axis", () => {
        /*
         * The exact assignment the aim arithmetic depends on. If this line changes shape, the box aim in
         * `CameraDirector` must be re-derived — see this file's header.
         */
        expect(earthSystemSource).toMatch(
            /groupRef\.current\.rotation\.y\s*=\s*spin\.current\.y/,
        );

        /*
         * No `rotation.x` / `rotation.z`, and no `rotateX`/`rotateZ`/`rotateOnAxis`/`quaternion`
         * assignment on the group. `rotation.x = 23.4°` is the obvious future change (axial tilt) and it
         * must trip this assertion rather than silently break the aim.
         */
        expect(earthSystemSource).not.toMatch(
            /groupRef\.current\.rotation\.[xz]\b/,
        );
        expect(earthSystemSource).not.toMatch(
            /groupRef\.current\.(rotateX|rotateZ|rotateOnAxis|quaternion)\b/,
        );
        /* And no scale/position written on the group either — a scaled radius changes the fit distance. */
        expect(earthSystemSource).not.toMatch(
            /groupRef\.current\.(scale|position)\b/,
        );
    });

    it("mounts <EarthSystem> with no transform prop", () => {
        /*
         * The parent side. A `position={...}`, `rotation={...}`, `scale={...}` or `quaternion={...}` added
         * to this element would compose with the group's own rotation and break the assumption just as
         * surely as a tilt written inside the component.
         *
         * The match starts at `<EarthSystem` and runs to the self-closing `/>`, so it covers every prop
         * spread across the JSX's multiple lines.
         */
        const mount = globeSceneSource.match(/<EarthSystem[\s\S]*?\/>/);
        expect(mount).not.toBeNull();
        const jsx = mount![0];
        expect(jsx).not.toMatch(
            /\b(position|rotation|scale|quaternion|matrix|matrixAutoUpdate)\s*=/,
        );
    });

    it("keeps the aim and the region fly-to rotating about the same axis constant", () => {
        /*
         * Both the box aim and `regionDirection` must use `SPIN_AXIS_Y`. If one of them were changed to a
         * different axis — or to a fresh `Vector3(0,1,0)` with, say, z=1 — the two would disagree about
         * where the same lat/lon is, and A1 would return.
         */
        const director = readFileSync(
            resolve(__dirname, "CameraDirector.tsx"),
            "utf8",
        );
        const axisUses =
            director.match(/applyAxisAngle\(\s*SPIN_AXIS_Y/g) ?? [];
        // regionDirection + the box aim = at least two call sites sharing the constant.
        expect(axisUses.length).toBeGreaterThanOrEqual(2);
        // And the literal axis must not be re-invented anywhere.
        expect(director).not.toMatch(/applyAxisAngle\(\s*new THREE\.Vector3\(/);
    });
});
