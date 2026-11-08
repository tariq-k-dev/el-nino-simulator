import { useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { getLookFlags, subscribeLookFlags } from "@/scene/globeLook";
import { lookTime } from "@/scene/lookTime";
import {
    ATMOSPHERIC_RIVER_RENDER_ORDER,
    buildAtmosphericRiverGeometry,
} from "@/lib/atmosphericRiverGeometry";

export interface AtmosphericRiverProps {
    /** Live or simulated sea surface temperature anomaly (°C). */
    sst: number;
    /** Jet stream latitudinal displacement in degrees (-5 to +5). */
    jetShiftDegrees?: number;
    /** Overall visibility toggle. Defaults to true. */
    visible?: boolean;
}

const atmosphericRiverVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const atmosphericRiverFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uIntensity;
  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;

  varying vec2 vUv;
  varying vec3 vWorldPosition;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec2 flowUv = vec2(vUv.x * 5.0 - uTime * uSpeed, vUv.y * 2.0);
    float n1 = noise(flowUv * 2.0);
    float n2 = noise(flowUv * 4.0 + vec2(uTime * 0.2, 0.0));
    float vaporNoise = mix(n1, n2, 0.4);

    float distFromCenter = abs(vUv.y - 0.5) * 2.0;
    float crossFalloff = smoothstep(1.0, 0.15, distFromCenter);

    float headFade = smoothstep(0.0, 0.12, vUv.x);
    float tailFade = smoothstep(1.0, 0.88, vUv.x);
    float lengthFade = headFade * tailFade;

    float density = crossFalloff * lengthFade * (0.6 + 0.4 * vaporNoise) * uIntensity;
    if (density < 0.01) discard;

    float coreFactor = smoothstep(0.4, 0.85, density);
    vec3 finalColor = mix(uColorEdge, uColorCore, coreFactor);

    gl_FragColor = vec4(finalColor, density * 0.75);
  }
`;

const _worldPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _surfaceNormal = new THREE.Vector3();

export function AtmosphericRiver({
    sst,
    jetShiftDegrees = 0,
    visible = true,
}: AtmosphericRiverProps) {
    const materialRef = useRef<THREE.ShaderMaterial>(null);
    const anchorRef = useRef<THREE.Group>(null);
    const pillDomRef = useRef<HTMLDivElement>(null);

    const look = useSyncExternalStore(
        subscribeLookFlags,
        getLookFlags,
        getLookFlags,
    );

    const intensity = Math.min(Math.max(0.3 + (sst / 2.5) * 0.7, 0.15), 1.0);
    const flowSpeed = 0.35 + intensity * 0.25;

    const { geometry, midpoint } = useMemo(() => {
        const data = buildAtmosphericRiverGeometry({
            jetShiftDegrees,
            width: 0.038 + intensity * 0.02,
        });

        const geom = new THREE.BufferGeometry();
        geom.setAttribute(
            "position",
            new THREE.BufferAttribute(data.positions, 3),
        );
        geom.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
        geom.setIndex(new THREE.BufferAttribute(data.indices, 1));

        const midIdx = Math.floor(data.centerline.length / 6) * 3;
        const midVec: [number, number, number] = [
            data.centerline[midIdx + 0],
            data.centerline[midIdx + 1],
            data.centerline[midIdx + 2],
        ];

        return { geometry: geom, midpoint: midVec };
    }, [jetShiftDegrees, intensity]);

    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uSpeed: { value: 0.35 },
            uIntensity: { value: 0.3 },
            uColorCore: { value: new THREE.Color("#f0f9ff") },
            uColorEdge: { value: new THREE.Color("#0284c7") },
        }),
        [],
    );

    useFrame((state) => {
        // 1. Advance shader uniforms deterministically (freezes to 0 when look.animate is false)
        if (materialRef.current) {
            materialRef.current.uniforms.uTime.value = lookTime(
                look.animate,
                state.clock.elapsedTime,
            );
            materialRef.current.uniforms.uSpeed.value = flowSpeed;
            materialRef.current.uniforms.uIntensity.value = intensity;
        }

        // 2. Direct DOM limb-fade calculation
        if (anchorRef.current && pillDomRef.current) {
            anchorRef.current.getWorldPosition(_worldPos);
            _camDir.subVectors(state.camera.position, _worldPos).normalize();
            _surfaceNormal.copy(_worldPos).normalize();
            const dot = _surfaceNormal.dot(_camDir);

            const opacity = Math.min(Math.max((dot - 0.08) / 0.14, 0), 1);
            pillDomRef.current.style.opacity = opacity.toFixed(2);
            pillDomRef.current.style.display =
                opacity <= 0.01 ? "none" : "flex";
        }
    });

    if (!visible) return null;

    const moistureFluxPct = Math.round(intensity * 100);

    return (
        <group>
            <mesh
                geometry={geometry}
                renderOrder={ATMOSPHERIC_RIVER_RENDER_ORDER}
            >
                <shaderMaterial
                    ref={materialRef}
                    vertexShader={atmosphericRiverVertexShader}
                    fragmentShader={atmosphericRiverFragmentShader}
                    uniforms={uniforms}
                    transparent
                    depthWrite={false}
                    depthTest
                    side={THREE.DoubleSide}
                />
            </mesh>

            {/* Floating telemetry label anchored at mid-ocean */}
            <group ref={anchorRef} position={midpoint}>
                <Html
                    center
                    distanceFactor={2.6}
                    style={{
                        pointerEvents: "none",
                        willChange: "transform",
                    }}
                >
                    <div
                        ref={pillDomRef}
                        className="flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-slate-950/75 px-2 py-0.5 text-[8.5px] font-mono tracking-wider text-slate-100 backdrop-blur-sm whitespace-nowrap select-none shadow-sm shadow-black/40"
                        style={{
                            transition: "opacity 120ms linear",
                            transform: "translateZ(0)",
                        }}
                        data-snapshot-river="true"
                    >
                        <span className="text-sky-400 font-sans text-[9px]">
                            ≈
                        </span>
                        <span className="font-medium">ATMOSPHERIC RIVER</span>
                        <span className="text-slate-500">·</span>
                        <span className="text-sky-300 font-semibold">
                            +{moistureFluxPct}% FLUX
                        </span>
                    </div>
                </Html>
            </group>
        </group>
    );
}
