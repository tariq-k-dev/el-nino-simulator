/**
 * Niño box outlines and pins, mounted only when `?nino=1`.
 *
 * This file exists so that the flag-on scene content has ONE home. The only change to an existing
 * scene file is a conditional mount in `EarthSystem.tsx`; everything the flag adds lives here.
 *
 * ## Pins: reused, not reimplemented
 *
 * `Hotspot` is rendered exactly as the existing four regions render it — same component, same props'
 * shapes, same limb-hide rule inside it (`Hotspot.tsx:194-225`) — so a Niño pin fades and hides at
 * the limb by the same code path as every other pin. What `Hotspot` needs is a `RegionDefinition`,
 * and a `NinoBox` is not one: a box has no `zoom`, no `accent` and no card copy. So each box is
 * adapted here into a `RegionDefinition`, which is the smallest thing that satisfies the component's
 * contract without editing the component or widening its prop type.
 *
 * Pins do nothing on click in this step: `onSelect` is a no-op, and the pin's own `active` stays
 * false. C2 adds the cards' button and wires the two triggers together.
 *
 * ## Outlines
 *
 * One `LineLoop` per loop from `ninoOutlineLoops`, so a two-range box is two separate lines and can
 * never be stitched into one that jumps the globe. Geometry is memoised per box and disposed on
 * unmount, and the depth/render-order rules come from the recon: `renderOrder` 4 (above the cloud
 * deck at 2 and the glint overlay at 3, below the pins at 6-8), `depthTest` true so the far
 * hemisphere is hidden by the globe, `depthWrite` false so an outline never occludes a pin.
 */

import { useEffect, useMemo } from "react";
import * as THREE from "three";

import type { RegionDefinition, RegionId } from "@/types/enso";
import { NINO34_REFERENCE_BOX, NINO_BOXES, type NinoBox } from "@/lib/regions";
import {
    NINO_OUTLINE_RADIUS,
    NINO_OUTLINE_RENDER_ORDER,
    ninoOutlineLoops,
} from "@/lib/ninoOutline";
import { Hotspot } from "@/scene/Hotspot";

/**
 * `RegionDefinition.id` is a closed union (`RegionId`), and adding members to it would ripple into
 * the registry, the drawer, the snapshot and the locked specs. A Niño box therefore borrows the
 * existing `pacific` id: nothing reads it for a Niño pin (the pin is inert, `active` is always
 * false, and `onSelect` is a no-op), and keeping it inside the union avoids touching a type that
 * four locked specs assert against.
 */
const INERT_REGION_ID: RegionId = "pacific";

/** Colour of the outline stroke, and of the brighter selected stroke. */
const OUTLINE_COLOR = "#7dd3fc";
const OUTLINE_COLOR_SELECTED = "#f0f9ff";

/**
 * Adapt a `NinoBox` to the `RegionDefinition` shape `Hotspot` renders.
 *
 * `zoom` is 1 because nothing consumes it on this path: a Niño pin has no fly-to in C1, and the fly
 * distance in C2 comes from `ninoFraming`, not from the registry scalar.
 */
function boxAsRegion(box: NinoBox): RegionDefinition {
    return {
        id: INERT_REGION_ID,
        name: box.label,
        shortName: box.label,
        lat: box.anchorLat,
        lon: box.anchorLon,
        zoom: 1,
        accent: OUTLINE_COLOR,
        summary: "",
        mechanism: "",
    };
}

/** One outline loop, with its geometry owned by this component and disposed on unmount. */
function OutlineLoop({
    box,
    vertices,
    selected,
}: {
    box: NinoBox;
    vertices: readonly (readonly [number, number, number])[];
    selected: boolean;
}) {
    const geometry = useMemo(() => {
        const g = new THREE.BufferGeometry();
        const positions = new Float32Array(vertices.length * 3);
        for (let i = 0; i < vertices.length; i += 1) {
            positions[i * 3] = vertices[i][0];
            positions[i * 3 + 1] = vertices[i][1];
            positions[i * 3 + 2] = vertices[i][2];
        }
        g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        g.computeBoundingSphere();
        return g;
    }, [vertices]);

    // Dispose the GPU buffer when the geometry is replaced or the component unmounts.
    useEffect(() => () => geometry.dispose(), [geometry]);

    const material = useMemo(
        () =>
            new THREE.LineBasicMaterial({
                color: new THREE.Color(
                    selected ? OUTLINE_COLOR_SELECTED : OUTLINE_COLOR,
                ),
                transparent: true,
                opacity: selected ? 0.95 : 0.55,
                // Above the cloud deck, below the pins. See the header comment.
                depthTest: true,
                depthWrite: false,
            }),
        [selected],
    );

    useEffect(() => () => material.dispose(), [material]);

    return (
        <lineLoop
            geometry={geometry}
            material={material}
            renderOrder={NINO_OUTLINE_RENDER_ORDER}
            name={`nino-outline-${box.id}`}
        />
    );
}

export interface NinoOverlayProps {
    /** The planet's spin group, handed straight to `Hotspot` so its limb gate uses world space. */
    earthRef: React.MutableRefObject<THREE.Group | null>;
    /** Current Niño 3.4 anomaly, so the pins pick up the same thermal colouring. */
    sst: number;
    /** Render the pins. Outlines are independent, so a step can carry one without the other. */
    showPins?: boolean;
    showOutlines?: boolean;
    /** Which box is highlighted, if any. Grows into the C2 selection. */
    selectedBoxId?: string | null;
    /** Called when a pin is chosen. Inert in C1; C2 passes the card's fly-to. */
    onSelectBox?: (id: string) => void;
}

export function NinoOverlay({
    earthRef,
    sst,
    showPins = true,
    showOutlines = true,
    selectedBoxId = null,
    onSelectBox,
}: NinoOverlayProps) {
    /**
     * The flagged list, derived from the schema. `NINO34_REFERENCE_BOX` is included because C1's
     * brief asks for its outline, and it is the one box that is not in `NINO_BOXES` by design
     * (`regions.ts:113-125`: the shipped Niño 3.4 entry is a point, not a box).
     */
    const boxes = useMemo<readonly NinoBox[]>(
        () => [...NINO_BOXES, NINO34_REFERENCE_BOX],
        [],
    );

    /** Loops per box, memoised: the vertex arrays are rebuilt only if the box list changes. */
    const outlines = useMemo(
        () =>
            boxes.map((box) => ({
                box,
                loops: ninoOutlineLoops(box, NINO_OUTLINE_RADIUS),
            })),
        [boxes],
    );

    return (
        <group name="nino-overlay">
            {showPins
                ? NINO_BOXES.map((box) => (
                      <Hotspot
                          key={`nino-pin-${box.id}`}
                          region={boxAsRegion(box)}
                          sst={sst}
                          active={false}
                          headline=""
                          /*
                           * Inert in C1. Kept as a real callback so `Hotspot`'s memoised handlers have a stable
                           * identity and do not re-subscribe every render.
                           */
                          onSelect={() => {
                              onSelectBox?.(box.id);
                          }}
                          earthRef={earthRef}
                          /*
                           * Dot only: no DOM label and no hit proxy. The interaction rule for this step is that a
                           * Niño pin is a visual marker and the CARD BUTTON is the only trigger, so the pin must
                           * not be a pointer target anywhere on the globe.
                           */
                          dotOnly
                      />
                  ))
                : null}

            {showOutlines
                ? outlines.map(({ box, loops }) =>
                      loops.map((loop, index) => (
                          <OutlineLoop
                              key={`nino-outline-${box.id}-${index}`}
                              box={box}
                              vertices={loop}
                              selected={selectedBoxId === box.id}
                          />
                      )),
                  )
                : null}
        </group>
    );
}
