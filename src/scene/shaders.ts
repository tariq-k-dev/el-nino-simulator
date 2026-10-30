/**
 * GLSL for the globe's atmosphere, surface overlay, and hotspot pulses.
 *
 * The atmosphere is a single-shell analytic Rayleigh/Mie approximation rather
 * than a two-shell additive stack. The previous double shell put a bright,
 * near-opaque band at the silhouette: both shells peak at the limb, so their
 * falloffs summed into a hard yellow ring.
 *
 * ## Why the profile is driven by the impact parameter, not by a fresnel term
 *
 * The shell is a BackSide sphere of radius `uShellRadius`, so the only part of
 * it that survives the depth test is the annulus between the planet's limb and
 * the shell's own silhouette. Over that annulus a fresnel term
 *
 *     rim = 1 - |dot(normal, viewDir)|
 *
 * runs from ~0.77 at the planet limb UP to 1.0 at the shell silhouette, because
 * the far-hemisphere normal rotates away from the view axis as the ray moves
 * outward. Alpha therefore peaked exactly at the geometry edge, which is the
 * hard ring — and with the shell at 1.028 R the annulus was ~9 px wide, so the
 * ramp had nowhere to fade. Measured alpha across it: 0.20 at the limb rising to
 * the 0.5 cap, i.e. a flat saturated band with a step edge.
 *
 * The physically-correct quantity is the impact parameter `b`: the perpendicular
 * distance from the planet's centre to the view ray. Optical depth through the
 * atmosphere is maximal at `b = planet radius` (the chord grazes the surface)
 * and decays outward, reaching ~0 at the top of the shell. So:
 *
 *     x     = (b - R) / (S - R)      // 0 at the limb, 1 at the shell rim
 *     fade  = 1 - x                  // monotonic, exactly 0 at x = 1
 *     body  = fade^rayleighPower     // broad blue body
 *     horiz = fade^horizonPower      // tight bright band hugging the limb
 *
 * Both terms are zero at the shell silhouette, so there is no edge to see: the
 * alpha reaches zero before the geometry does. That is the whole fix, and no
 * exponent tuning alone could achieve it (see docs/3B-1-STATUS.md).
 *
 * `x` is clamped to 0 below the limb, i.e. over the planet's own disc — but
 * those fragments are depth-rejected by the opaque surface, so the shell puts
 * nothing over the disc interior and the "no haze" guard holds by construction.
 */
export const atmosphereVertex = /* glsl */ `
  uniform vec3 uSunDirection;

  varying vec3 vWorldPos;
  varying float vSunDot;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;

    // The shell is centred on the origin, so world space equals object space for
    // the sun vector. The parent group spins; a sphere is invariant under a Y
    // rotation, so this stays correct without undoing the rotation.
    vSunDot = dot(normalize(worldPos.xyz), normalize(uSunDirection));

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const atmosphereFragment = /* glsl */ `
  uniform vec3 uRayleighColor;   // deep blue body of the atmosphere
  uniform vec3 uMieColor;        // forward-scattered warm rim
  uniform vec3 uHorizonColor;    // thin bright fringe at the limb
  uniform float uIntensity;      // optical thickness (0..~1.5)
  uniform float uRayleighPower;  // falloff exponent for the broad body
  uniform float uHorizonPower;   // steeper exponent for the razor-thin fringe
  uniform float uSunGlow;        // forward-scatter strength toward the sun
  uniform float uTime;
  uniform float uShellRadius;    // shell radius in Earth radii
  uniform float uPlanetRadius;   // planet radius in Earth radii
  uniform float uBodyWeight;     // body alpha at the limb
  uniform float uHorizonWeight;  // fringe alpha at the limb
  uniform float uAlphaCap;       // hard ceiling on the shell's alpha
  uniform float uBreatheAmp;

  varying vec3 vWorldPos;
  varying float vSunDot;

  void main() {
    // Impact parameter: perpendicular distance from the planet centre to this
    // pixel's view ray, in Earth radii. 1.0 exactly at the limb.
    vec3 rayDir = normalize(vWorldPos - cameraPosition);
    float tca = dot(-cameraPosition, rayDir);        // ray origin is the camera
    float b = length(cameraPosition + rayDir * tca) / uPlanetRadius;

    // Normalised height through the annulus: 0 at the limb, 1 at the shell rim.
    float span = max(uShellRadius - uPlanetRadius, 1e-4);
    float x = clamp((b - uPlanetRadius) / span, 0.0, 1.0);

    // Decays OUTWARD and is exactly zero at x = 1 — the shell silhouette. This
    // is what removes the hard edge: alpha reaches 0 before the geometry ends.
    float fade = 1.0 - x;
    float body = pow(fade, uRayleighPower);
    float horizon = pow(fade, uHorizonPower);

    // Mie forward scattering is strongest on the day side and dramatically so
    // toward the sun. Wrapped in smoothstep so the terminator has no hard edge.
    float sunWarmth = smoothstep(-0.35, 0.85, vSunDot);
    float forward = pow(max(vSunDot, 0.0), 2.2);

    // Rayleigh body: blue, strongest by day but present all the way around.
    // Body haze is deliberately weak: most of the atmosphere's blue should come
    // from the rim, not from a wash over the disc, or the continents dull out.
    vec3 rayleigh = uRayleighColor * body * (0.18 + 0.42 * sunWarmth);

    // Horizon fringe: cyan on the night limb, warming toward Mie gold at the
    // sub-solar point. This is the term that reads as photographed from orbit.
    vec3 fringeTint = mix(uHorizonColor, uMieColor, forward * uSunGlow);
    vec3 fringe = fringeTint * horizon * (0.55 + 0.75 * sunWarmth);

    // Slow breathing so the halo is not a dead decal. Uniform in x, so it scales
    // the whole profile without ever inverting its sign.
    float breathe = 1.0 - uBreatheAmp + uBreatheAmp * sin(uTime * 0.6);

    vec3 color = (rayleigh + fringe) * uIntensity * breathe;

    // Alpha stays well below 1 - an opaque shell reads as a plastic bubble, not
    // air. The fade factor is what makes the profile land on zero at the shell
    // rim; the cap only bounds the peak.
    float alpha = clamp(
      (body * uBodyWeight + horizon * uHorizonWeight) * uIntensity * breathe,
      0.0,
      uAlphaCap
    );

    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * Surface overlay: ocean specular glint, broadband sheen, and anomaly heat.
 *
 * Rendered as a thin additive shell just above the surface rather than patched
 * into MeshStandardMaterial, so three's lighting model stays intact and this
 * only contributes the glint and the data-driven warmth.
 */
export const surfaceOverlayVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const surfaceOverlayFragment = /* glsl */ `
  uniform sampler2D uOceanMask;   // white on water, black on land
  uniform vec3 uSunDirection;
  uniform vec3 uHeatColor;
  uniform float uHeat;            // 0..1 anomaly strength
  uniform float uSpecularPower;
  uniform float uSpecularStrength;
  uniform float uSheen;
  uniform float uAlphaCap;
  uniform float uEmitCap;
  uniform float uSunGlow;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uSunDirection);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 H = normalize(L + V);

    float ocean = texture2D(uOceanMask, vUv).r;

    // Sun glint. Deliberately restrained: at strength 0.9 / power 64 this lobe
    // measured 0.72% of the frame fully blown to white and flattened mean
    // saturation from 0.27 to 0.22. A real orbital photograph shows a compact
    // specular highlight, not a floodlight. Lower strength + tighter lobe keeps
    // the highlight legible as a highlight.
    float cosAngle = max(dot(N, H), 0.0);
    float glint = pow(cosAngle, uSpecularPower) * ocean * uSpecularStrength;

    // Broad sheen, very low, so the surface reads as wet without glowing.
    float sheen = pow(cosAngle, 8.0) * ocean * uSheen;

    // Anomaly warmth. Restricted to the equatorial band and to water, and
    // weighted far below the glint: this is a data cue, not a colour grade.
    // The previous version tinted broad land areas amber, which is where the
    // render's 63% "brown" pixel share came from.
    float equatorial = exp(-pow(N.y * 3.4, 2.0));
    float daySide = smoothstep(0.1, 0.9, dot(N, L));
    float heat = uHeat * equatorial * daySide * 0.16 * uSunGlow;

    vec3 glintColor = vec3(1.0, 0.985, 0.96);
    vec3 color = glintColor * (glint + sheen) + uHeatColor * heat;

    // Emitted light is bounded below 1 so that no combination of terms can add a
    // colour the tone mapper then has to clip; uEmitCap is the tuning seam.
    color = min(color, vec3(uEmitCap));

    // Alpha is clamped well below 1 so no pixel can saturate to pure white.
    float alpha = clamp(glint * 0.8 + sheen + heat * 0.7, 0.0, uAlphaCap);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

export const hotspotVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const hotspotFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uPhase;

  varying vec2 vUv;

  void main() {
    // Expanding ring: radius sweeps outward each cycle, energy decays with it.
    float t = fract(uTime * 0.45 + uPhase);
    float radius = length(vUv - 0.5) * 2.0;

    float ring = smoothstep(0.0, 0.12, radius - t * 0.85)
               * (1.0 - smoothstep(0.12, 0.3, radius - t * 0.85));
    float core = 1.0 - smoothstep(0.0, 0.32, radius);

    float energy = (ring * (1.0 - t) * 1.4) + core * 0.55;
    float alpha = clamp(energy, 0.0, 1.0);

    gl_FragColor = vec4(uColor * (0.7 + energy), alpha);
    #include <colorspace_fragment>
  }
`;
