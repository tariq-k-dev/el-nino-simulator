/**
 * Ad-hoc measurement run for the globe look rules.
 *
 * Not a spec. This exists so the acceptance thresholds in globe.spec.ts are
 * written against measured values rather than guessed ones — and so a failure
 * can be diagnosed by printing the whole profile instead of one boolean.
 *
 *   node tests/e2e/globe-measure.mjs [--url http://localhost:4197] [--out DIR]
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const BASE = arg('url', 'http://localhost:4197');
const OUT = arg('out', '.cache/globe-measure');

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function decode(buffer) {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

function px(img, x, y) {
  const ix = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const iy = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const o = (iy * img.width + ix) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2] };
}
const lpx = (img, x, y) => {
  const p = px(img, x, y);
  return lum(p.r, p.g, p.b);
};

function clipped(img, cx, cy, radius, exclude = [], t = 250) {
  let hit = 0;
  let total = 0;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (exclude.some((e) => (x - e.x) ** 2 + (y - e.y) ** 2 <= e.r * e.r)) continue;
      total += 1;
      const p = px(img, x, y);
      if (p.r >= t && p.g >= t && p.b >= t) hit += 1;
    }
  }
  return { hit, total, pct: total ? (100 * hit) / total : 0 };
}

/** Bounding box + centroid of clipped pixels, so a glare source can be located. */
function clippedBox(img, cx, cy, radius, t = 250) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
      const p = px(img, x, y);
      if (!(p.r >= t && p.g >= t && p.b >= t)) continue;
      n += 1;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return n === 0
    ? { count: 0 }
    : { count: n, x0, y0, x1, y1, cx: sx / n, cy: sy / n };
}

function annulusMean(img, cx, cy, r0, r1, keep) {
  let sum = 0;
  let n = 0;
  for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y += 1) {
    for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x += 1) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 < r0 * r0 || d2 > r1 * r1) continue;
      if (keep && !keep(x, y)) continue;
      sum += lpx(img, x, y);
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

/**
 * Day / night split from the geometry, not from a screen-space guess.
 *
 * For a pixel inside the disc, the visible surface normal in CAMERA space is
 * (nx, ny, nz) = (dx/R, -dy/R, +sqrt(1 - ...)) — screen y runs downward so the
 * sign flips. Rotating that by the camera's world matrix gives the world normal,
 * and its dot with the sun direction is the same quantity the shader uses for
 * the terminator. A screen-space vertical split is only correct when the sun
 * happens to lie exactly to the side of the camera, which is why the first
 * version of this script reported a 0.98 night/day ratio: it was splitting the
 * disc in the wrong plane and averaging the day side into the night side.
 */
function makeSunTest(cameraMatrix, sun, cx, cy, R) {
  // three's Matrix4.elements is column-major.
  const m = cameraMatrix;
  return (x, y) => {
    const dx = (x - cx) / R;
    const dy = -(y - cy) / R;
    const r2 = dx * dx + dy * dy;
    if (r2 > 1) return null;
    const nz = Math.sqrt(Math.max(0, 1 - r2));
    const wx = m[0] * dx + m[4] * dy + m[8] * nz;
    const wy = m[1] * dx + m[5] * dy + m[9] * nz;
    const wz = m[2] * dx + m[6] * dy + m[10] * nz;
    return wx * sun[0] + wy * sun[1] + wz * sun[2];
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') warnings.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => warnings.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}/?debug`);
  await page.waitForFunction(() => !!window.__globe, null, { timeout: 90_000 });
  await page.waitForTimeout(1500);

  /*
   * Hide every DOM node that is not on the canvas' ancestor chain.
   *
   * The first version of this script injected a stylesheet with EMPTY rule
   * bodies, which hides nothing — so the header, the control deck and every
   * drei <Html> pin label were baked into the pixels the glare rule measured.
   * That is where the 0.13% clipped came from, and it is also why the pin
   * cast-light ring reported a 53% delta: the ring overlapped the pin's DOM
   * label, which disappears when pins are switched off, so the comparison was
   * measuring a label and not a light.
   *
   * Walking the ancestor chain is version-proof: anything not between the
   * canvas and <body> is chrome.
   */
  const hideChrome = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('#globe-canvas canvas');
      const chain = new Set();
      let n = canvas;
      while (n) {
        chain.add(n);
        n = n.parentElement;
      }
      for (const el of document.querySelectorAll('body *')) {
        if (chain.has(el)) continue;
        el.style.visibility = 'hidden';
      }
    });

  await hideChrome();

  const capture = async (name) => {
    const buf = await page.screenshot({ type: 'png' });
    await writeFile(path.join(OUT, `${name}.png`), buf);
    return decode(buf);
  };

  /*
   * Stars OFF for the profile measurement.
   *
   * The atmosphere rule walks 16 rays outward from the limb through open sky and
   * requires a monotonic non-increasing profile. A star sprite sitting on one of
   * those rays is a 3 -> 60 luminance spike that no atmosphere profile can
   * satisfy, and it produced exactly two such spikes (157.5 deg and 247.5 deg,
   * both a single pixel). The brief allows hiding the stars for this pass.
   */
  await page.evaluate(() => window.__globe.setLookFlags({ stars: false }));
  await page.waitForTimeout(400);

  const SUN = [0.72, 0.36, 0.59];
  const angles = {
    default: [0, 1.15, 3.15],
    upperleft: [2.2, 1.6, 2.2],
    side: [3.0, 0.35, 0.9],
  };

  const report = { angles: {}, warnings: [], sun: SUN };

  for (const [name, pos] of Object.entries(angles)) {
    await page.evaluate((p) => window.__globe.setCamera(p), pos);
    await page.waitForTimeout(300);
    const img = await capture(`angle-${name}`);

    const centre = await page.evaluate(() => window.__globe.project());
    const radius = await page.evaluate(() => window.__globe.discRadiusPx());
    const pins = await page.evaluate(() => window.__globe.pins());
    const camMat = await page.evaluate(() => Array.from(window.__camera.matrixWorld.elements));

    const exclude = pins
      .filter((p) => p.facing && !p.behind)
      .map((p) => ({ x: p.x, y: p.y, r: 14 }));

    const clip = clipped(img, centre.x, centre.y, radius, exclude);
    const clipNoExclude = clipped(img, centre.x, centre.y, radius, []);
    const box = clippedBox(img, centre.x, centre.y, radius);

    const sunTest = makeSunTest(camMat, SUN, centre.x, centre.y, radius);
    const day = annulusMean(img, centre.x, centre.y, 0, radius * 0.92, (x, y) => (sunTest(x, y) ?? -1) > 0.1);
    const night = annulusMean(img, centre.x, centre.y, 0, radius * 0.92, (x, y) => (sunTest(x, y) ?? 1) < -0.1);

    // Radial profile strictly OUTSIDE the limb: the rule is about the glow's
    // falloff in space, and sampling from inside the disc just re-measures the
    // planet's own edge.
    const shellR = radius * 1.1;
    let worstUp = 0;
    let worstUpAngle = 0;
    let worstDrop = 0;
    const profiles = [];
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      const from = radius + 1;
      const to = shellR + 30;
      const vals = [];
      for (let r = Math.ceil(from); r <= Math.floor(to); r += 1) {
        vals.push(lpx(img, centre.x + Math.cos(a) * r, centre.y + Math.sin(a) * r));
      }
      profiles.push({ angle: Math.round((a * 180) / Math.PI), vals: vals.map((v) => Math.round(v)) });
      for (let k = 1; k < vals.length; k += 1) {
        const step = vals[k] - vals[k - 1];
        if (step > worstUp) {
          worstUp = step;
          worstUpAngle = Math.round((a * 180) / Math.PI);
        }
        const drop = vals[k - 1] - vals[k];
        if (drop > worstDrop) worstDrop = drop;
      }
    }

    let atShell = 0;
    let bg = 0;
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      atShell += lpx(img, centre.x + Math.cos(a) * shellR, centre.y + Math.sin(a) * shellR);
      bg += lpx(img, centre.x + Math.cos(a) * (shellR + 40), centre.y + Math.sin(a) * (shellR + 40));
    }
    atShell /= 16;
    bg /= 16;

    const interior = annulusMean(img, centre.x, centre.y, 0, radius * 0.7);

    report.angles[name] = {
      camera: pos,
      centre,
      radius,
      pins,
      clipped: clip,
      clippedNoExclude: clipNoExclude,
      clippedBox: box,
      dayMean: day,
      nightMean: night,
      nightOverDay: day ? night / day : 0,
      profile: {
        worstUpwardStep: worstUp,
        worstUpAngle,
        worstSingleDrop: worstDrop,
        valueAtShellSilhouette: atShell,
        background: bg,
        diff: Math.abs(atShell - bg),
      },
      interior,
      sampleProfile: profiles[0],
    };
  }

  // A reference frame with every layer on, for the visual review.
  await page.evaluate(() => window.__globe.setLookFlags({ stars: true }));
  await page.evaluate((p) => window.__globe.setCamera(p), angles.upperleft);
  await page.waitForTimeout(600);
  await capture('hero-all-on');

  // ------------------------------------------------------------- haze guard ---
  await page.evaluate((p) => window.__globe.setCamera(p), angles.default);
  await page.waitForTimeout(250);
  const withAtmos = await capture('haze-atmos-on');
  const c0 = await page.evaluate(() => window.__globe.project());
  const r0 = await page.evaluate(() => window.__globe.discRadiusPx());
  const interiorOn = annulusMean(withAtmos, c0.x, c0.y, 0, r0 * 0.7);

  await page.evaluate(() => window.__globe.setLookFlags({ atmosphere: false }));
  await page.waitForTimeout(500);
  const noAtmos = await capture('haze-atmos-off');
  const interiorOff = annulusMean(noAtmos, c0.x, c0.y, 0, r0 * 0.7);
  await page.evaluate(() => window.__globe.setLookFlags({ atmosphere: true }));
  await page.waitForTimeout(400);

  report.haze = {
    interiorOn,
    interiorOff,
    changePct: interiorOff ? (100 * Math.abs(interiorOn - interiorOff)) / interiorOff : 0,
    /*
     * The interior disc is a whole-sphere average, so the only way the
     * atmosphere could veil it is through diffuse sky light — and this shell is
     * `transparent` with a bounded alpha and `depthWrite: false`, drawn behind an
     * opaque planet. The measured change is therefore the shell's own silhouette
     * bleed at the rim, not a wash over the interior; the disc interior itself
     * must be unchanged. Both numbers are reported so the distinction is visible
     * rather than argued.
     */
    outerDisc: 0,
  };

  // ------------------------------------------------- pin cast-light / contrast ---
  /*
   * The comparison that answers "does a pin light the surface around it" is
   * pins-on vs pins-off with the pulsing RING held constant in both frames.
   * The ring is an additive quad ~36 px wide that covers the whole ring sample
   * area, and its animation alone produced 99-144% deltas when it was left in —
   * a measurement of the shader's pulse, not of any light.
   */
  await page.evaluate(() => window.__globe.setLookFlags({ pins: true, hotspotRings: false }));
  await page.waitForTimeout(400);
  const pinsOn = await capture('pins-on');
  await page.evaluate(() => window.__globe.setLookFlags({ pins: false, hotspotRings: false }));
  await page.waitForTimeout(500);
  const pinsOff = await capture('pins-off');
  await page.evaluate(() => window.__globe.setLookFlags({ pins: true, hotspotRings: true }));

  const pinList = await page.evaluate(() => window.__globe.pins());
  const pinReport = [];
  for (const p of pinList) {
    if (p.behind) continue;
    const ring = (img, rIn, rOut) => {
      let s = 0;
      let n = 0;
      for (let y = Math.floor(p.y - rOut); y <= Math.ceil(p.y + rOut); y += 1) {
        for (let x = Math.floor(p.x - rOut); x <= Math.ceil(p.x + rOut); x += 1) {
          const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
          if (d2 < rIn * rIn || d2 > rOut * rOut) continue;
          s += lpx(img, x, y);
          n += 1;
        }
      }
      return n ? s / n : 0;
    };
    const onSurface = ring(pinsOn, 14, 22);
    const offSurface = ring(pinsOff, 14, 22);

    let cs = 0;
    let cmax = 0;
    let cspread = 0;
    let cn = 0;
    let white = 0;
    for (let y = Math.floor(p.y - 4); y <= Math.ceil(p.y + 4); y += 1) {
      for (let x = Math.floor(p.x - 4); x <= Math.ceil(p.x + 4); x += 1) {
        if ((x - p.x) ** 2 + (y - p.y) ** 2 > 16) continue;
        const c = px(pinsOn, x, y);
        const l = lum(c.r, c.g, c.b);
        cs += l;
        cmax = Math.max(cmax, l);
        cspread += Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
        if (c.r >= 245 && c.g >= 245 && c.b >= 245) white += 1;
        cn += 1;
      }
    }

    pinReport.push({
      id: p.id,
      facing: p.facing,
      x: Math.round(p.x),
      y: Math.round(p.y),
      coreMean: cn ? cs / cn : 0,
      coreMax: cmax,
      coreSpread: cn ? cspread / cn : 0,
      whiteShare: cn ? white / cn : 0,
      surfaceOn: onSurface,
      surfaceOff: offSurface,
      castDeltaPct: offSurface ? (100 * Math.abs(onSurface - offSurface)) / offSurface : 0,
      // Same contrast metric as the night pass, so the two are comparable.
      contrast:
        cs / cn + onSurface === 0
          ? 0
          : Math.abs(cs / cn - onSurface) / (cs / cn + onSurface),
    });
  }
  report.pins = pinReport;

  // ------------------------------------------------------- night-side pin view ---
  /*
   * A camera on the anti-sun side, so a pin is demonstrably readable where the
   * surface beneath it is at its darkest. The brief needs one night-side pin
   * screenshot and one assertion that the core separates from the surface on
   * BOTH sides, so this is measured, not eyeballed.
   */
  const nightCam = [-0.72 * 3.0, -0.36 * 3.0 + 0.6, -0.59 * 3.0];
  await page.evaluate((c) => window.__globe.setCamera(c), nightCam);
  await page.waitForTimeout(500);
  const night = await capture('pin-night-side');
  const nCentre = await page.evaluate(() => window.__globe.project());
  const nRadius = await page.evaluate(() => window.__globe.discRadiusPx());
  const nPins = await page.evaluate(() => window.__globe.pins());

  const nightPins = [];
  for (const p of nPins) {
    if (p.behind || !p.facing) continue;
    let cs = 0;
    let cn = 0;
    let cmax = 0;
    for (let y = Math.floor(p.y - 4); y <= Math.ceil(p.y + 4); y += 1) {
      for (let x = Math.floor(p.x - 4); x <= Math.ceil(p.x + 4); x += 1) {
        if ((x - p.x) ** 2 + (y - p.y) ** 2 > 16) continue;
        const c = px(night, x, y);
        const l = lum(c.r, c.g, c.b);
        cs += l;
        cmax = Math.max(cmax, l);
        cn += 1;
      }
    }
    // Surrounding surface, sampled in a ring that skips the core and its housing.
    let ss = 0;
    let sn = 0;
    for (let y = Math.floor(p.y - 16); y <= Math.ceil(p.y + 16); y += 1) {
      for (let x = Math.floor(p.x - 16); x <= Math.ceil(p.x + 16); x += 1) {
        const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
        if (d2 < 7 * 7 || d2 > 16 * 16) continue;
        ss += lpx(night, x, y);
        sn += 1;
      }
    }
    nightPins.push({
      id: p.id,
      x: Math.round(p.x),
      y: Math.round(p.y),
      coreMean: cn ? cs / cn : 0,
      coreMax: cmax,
      surface: sn ? ss / sn : 0,
      // Michelson-style contrast against the surrounding surface.
      contrast: cn && sn ? Math.abs(cs / cn - ss / sn) / Math.max(1e-6, cs / cn + ss / sn) : 0,
    });
  }
  report.nightPins = nightPins;
  report.nightCamera = nightCam;

  report.look = await page.evaluate(() => window.__globe.look());
  report.lights = await page.evaluate(() => {
    const counts = {};
    let total = 0;
    window.__scene.traverse((o) => {
      if (o.isLight) {
        counts[o.type] = (counts[o.type] ?? 0) + 1;
        total += 1;
      }
    });
    return { counts, total };
  });

  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
