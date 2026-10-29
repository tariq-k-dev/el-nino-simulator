/**
 * GLSL for the globe's atmosphere, surface overlay, and hotspot pulses.
 *
 * The atmosphere is a single-shell analytic Rayleigh/Mie approximation rather
 * than a two-shell additive stack. The previous double shell put a bright,
 * near-opaque band at the silhouette: both shells peak at the limb, so their
 * falloffs summed into a hard yellow ring. One shell with two different
 * exponents gives the thin cyan-to-deep-blue fringe real orbital photographs
 * show, and stays genuinely translucent.
 */

export const atmosphereVertex = /* glsl */ `
  uniform vec3 uSunDirection;

  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vSunDot;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);

    // The shell is centred on the origin and never rotated, so world space
    // equals object space for the sun vector.
    vSunDot = dot(normalize(worldPos.xyz), normalize(uSunDirection));

    // View-space normal is stable under orbit and gives a clean rim.
    vNormalView = normalize(normalMatrix * normal);
    vec4 viewPos = viewMatrix * worldPos;
    vViewDir = normalize(-viewPos.xyz);

    gl_Position = projectionMatrix * viewPos;
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

  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vSunDot;

  void main() {
    // Optical-depth proxy: grazing angles travel through more atmosphere.
    float rim = clamp(1.0 - abs(dot(normalize(vNormalView), normalize(vViewDir))), 0.0, 1.0);

    // Two terms with very different exponents. The high-exponent term is only
    // non-zero in the last few degrees of the limb - that is the razor-thin
    // fringe. The low-exponent term is the soft body haze.
    float body = pow(rim, uRayleighPower);
    float horizon = pow(rim, uHorizonPower);

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

    // Slow breathing so the halo is not a dead decal.
    float breathe = 0.985 + 0.015 * sin(uTime * 0.6);

    vec3 color = (rayleigh + fringe) * uIntensity * breathe;

    // Alpha stays well below 1 - an opaque shell reads as a plastic bubble,
    // not air. The fringe is allowed to be the densest part.
    // Capped at 0.5: a thicker shell desaturates everything behind it, which is
    // what made the planet read muddy rather than blue.
    float alpha = clamp((body * 0.22 + horizon * 0.9) * uIntensity, 0.0, 0.5);

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
    float sheen = pow(cosAngle, 8.0) * ocean * 0.045;

    // Anomaly warmth. Restricted to the equatorial band and to water, and
    // weighted far below the glint: this is a data cue, not a colour grade.
    // The previous version tinted broad land areas amber, which is where the
    // render's 63% "brown" pixel share came from.
    float equatorial = exp(-pow(N.y * 3.4, 2.0));
    float daySide = smoothstep(0.1, 0.9, dot(N, L));
    float heat = uHeat * equatorial * daySide * 0.16 * uSunGlow;

    vec3 glintColor = vec3(1.0, 0.985, 0.96);
    vec3 color = glintColor * (glint + sheen) + uHeatColor * heat;

    // Alpha is clamped well below 1 so no pixel can saturate to pure white.
    float alpha = clamp(glint * 0.8 + sheen + heat * 0.7, 0.0, 0.72);
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
