/**
 * 3B-1a-CLOSE-A fact gathering. READ-ONLY: measures, never tunes.
 *
 * Answers (a) light inventory, (b) the blue dot at the left limb, (c) the raw
 * atmosphere radial profile, (d) pin housing on day and night sides, (e) bloom
 * configuration and halo width, (f) the default-view screenshot.
 *
 *   node tests/e2e/globe-facts.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const BASE = 'http://localhost:4197';
const OUT = '.cache/globe-facts';

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function decode(buf) {
  const png = PNG.sync.read(buf);
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

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/?debug`);
  await page.waitForFunction(() => !!window.__globe, null, { timeout: 90_000 });
  await page.waitForTimeout(1500);

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

  const shoot = async (name) => {
    const buf = await page.screenshot({ type: 'png' });
    await writeFile(path.join(OUT, `${name}.png`), buf);
    return decode(buf);
  };

  const report = {};

  // ================================================================ (a) LIGHTS ===
  /*
   * Walk the scene graph for every Light, and record where it lives. "World
   * fixed" means nothing between it and the scene root is re-parented by the
   * camera rig or OrbitControls; "rig-attached" would mean the camera or controls
   * own it. The distinction matters because a light parented to a spinning group
   * moves with the planet, which is a different look from a fixed sun.
   */
  report.lights = await page.evaluate(() => {
    const out = [];
    const parentNames = [];
    window.__scene.traverse((o) => {
      if (!o.isLight) return;
      // Ancestor chain, to see whether anything dynamic owns it.
      const chain = [];
      let p = o.parent;
      while (p) {
        chain.push(p.type + (p.name ? `:"${p.name}"` : ''));
        p = p.parent;
      }
      out.push({
        type: o.type,
        color: `#${o.color?.getHexString?.() ?? '?'}`,
        intensity: o.intensity,
        position: [o.position.x, o.position.y, o.position.z],
        // world position, after any parent transform
        worldPosition: (() => {
          const v = { x: 0, y: 0, z: 0 };
          const e = o.matrixWorld.elements;
          v.x = e[12];
          v.y = e[13];
          v.z = e[14];
          return [v.x, v.y, v.z];
        })(),
        castShadow: o.castShadow,
        distance: o.distance ?? null,
        decay: o.decay ?? null,
        parentChain: chain,
        // Is this light inside the EarthSystem group (which carries the spin)?
        spinningParent: chain.slice(0, -1).some((c) => c.startsWith('Group')),
      });
    });
    return out;
  });

  // Camera-rig attachment: compare the light's parent chain with the camera's.
  report.rig = await page.evaluate(() => {
    const camChain = [];
    let p = window.__camera.parent;
    while (p) {
      camChain.push(p.type + (p.name ? `:"${p.name}"` : ''));
      p = p.parent;
    }
    return { cameraParentChain: camChain, cameraPosition: [
      window.__camera.position.x,
      window.__camera.position.y,
      window.__camera.position.z,
    ] };
  });

  // ========================================================= (c) ATMOSPHERE ===
  await page.evaluate(() => window.__globe.setCamera([0, 1.15, 3.15]));
  await page.evaluate(() => window.__globe.setLookFlags({ stars: false }));
  await page.waitForTimeout(600);

  const atmosOn = await shoot('atmos-on');
  const centre = await page.evaluate(() => window.__globe.project());
  const radius = await page.evaluate(() => window.__globe.discRadiusPx());

  // 16 rays, every whole pixel from 10 px INSIDE the limb to 40 px outside.
  const rays = [];
  for (let i = 0; i < 16; i += 1) {
    const deg = (i * 360) / 16;
    const a = (deg * Math.PI) / 180;
    const rows = [];
    for (let r = Math.floor(radius - 10); r <= Math.ceil(radius + 40); r += 1) {
      const x = centre.x + Math.cos(a) * r;
      const y = centre.y + Math.sin(a) * r;
      const p = px(atmosOn, x, y);
      rows.push({ r, l: Math.round(lum(p.r, p.g, p.b) * 10) / 10, rgb: [p.r, p.g, p.b] });
    }
    rays.push({ deg, rows });
  }

  // Aggregate: mean per radius, plus the per-ray worst upward step.
  const offsets = [];
  for (let r = Math.floor(radius - 10); r <= Math.ceil(radius + 40); r += 1) offsets.push(r - radius);

  const meanByOffset = offsets.map((off) => {
    const r = radius + off;
    let s = 0;
    for (const ray of rays) {
      const row = ray.rows.find((q) => Math.abs(q.r - Math.round(r)) <= 0);
      if (row) s += row.l;
    }
    return Math.round((s / rays.length) * 10) / 10;
  });

  // Peak halo value and where it sits, from the MEAN profile.
  let peak = -1;
  let peakOff = 0;
  meanByOffset.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      peakOff = offsets[i];
    }
  });

  // The step exactly at the limb: mean value at floor(R)-1 vs ceil(R).
  const atLimbIn = meanByOffset[offsets.indexOf(Math.floor(radius) - 1 - Math.floor(radius))] ?? null;

  // Per-ray adjacent steps, over the OUTSIDE portion only (the acceptance range).
  let worstUp = 0;
  let worstUpDetail = null;
  let worstDown = 0;
  let worstDownDetail = null;
  for (const ray of rays) {
    const outside = ray.rows.filter((q) => q.r >= Math.ceil(radius) + 1);
    for (let k = 1; k < outside.length; k += 1) {
      const step = outside[k].l - outside[k - 1].l;
      if (step > worstUp) {
        worstUp = step;
        worstUpDetail = { deg: ray.deg, from: outside[k - 1], to: outside[k] };
      }
      const drop = outside[k - 1].l - outside[k].l;
      if (drop > worstDown) {
        worstDown = drop;
        worstDownDetail = { deg: ray.deg, from: outside[k - 1], to: outside[k] };
      }
    }
  }

  // Value at the shell silhouette (1.10 R) vs the far background.
  const shellOff = radius * 0.1;
  const atShell = meanByOffset[offsets.reduce((best, o, i) => (Math.abs(o - shellOff) < Math.abs(offsets[best] - shellOff) ? i : best), 0)];
  const bgIdx = offsets.length - 1;
  const bg = meanByOffset[bgIdx];

  report.atmosphere = {
    centre,
    radius,
    shellRadiusPx: radius * 1.1,
    offsets,
    meanByOffset,
    peak: { value: peak, offsetPx: peakOff, radiusPx: radius + peakOff },
    valueAtShellSilhouette: atShell,
    background: bg,
    shellMinusBackground: Math.abs(atShell - bg),
    stepAtLimb: atLimbIn,
    worstUpwardStepOutside: worstUp,
    worstUpwardDetail: worstUpDetail,
    worstDropOutside: worstDown,
    worstDropDetail: worstDownDetail,
    rays,
  };

  // Atmosphere OFF, for the same profile — proves the profile is the shell's.
  await page.evaluate(() => window.__globe.setLookFlags({ atmosphere: false }));
  await page.waitForTimeout(600);
  const atmosOff = await shoot('atmos-off');
  report.atmosphereOffProfile = offsets.map((off) => {
    let s = 0;
    for (let i = 0; i < 16; i += 1) {
      const a = ((i * 360) / 16) * (Math.PI / 180);
      s += lpx(atmosOff, centre.x + Math.cos(a) * (radius + off), centre.y + Math.sin(a) * (radius + off));
    }
    return Math.round((s / 16) * 10) / 10;
  });
  await page.evaluate(() => window.__globe.setLookFlags({ atmosphere: true }));
  await page.waitForTimeout(400);

  // ============================================================== (b) BLUE DOT ===
  /*
   * The blue speck reported at the left limb near (345,390) in the OLD
   * shot-a-default.png. Look for any isolated bright-blue cluster inside/near the
   * disc at that location in the CURRENT build, and if found, resolve what owns it
   * by hiding candidate scene subtrees one at a time.
   */
  report.blueDot = await page.evaluate(
    ({ cx, cy }) => {
      const scene = window.__scene;
      const out = { probed: [], candidates: [] };
      // Inventory of scene children, so an owner can be named.
      for (const child of scene.children) {
        const kinds = [];
        child.traverse((o) => {
          if (o.isPoints) kinds.push('Points');
          if (o.isMesh) kinds.push('Mesh');
          if (o.isLight) kinds.push('Light');
          if (o.isGroup) kinds.push('Group');
        });
        out.candidates.push({
          type: child.type,
          name: child.name || null,
          childCount: child.children.length,
          kinds: [...new Set(kinds)],
          pointsCount: child.isPoints ? child.geometry?.attributes?.position?.count ?? null : null,
        });
      }
      return out;
    },
    { cx: centre.x, cy: centre.y },
  );

  // Pixel probe in a 30 px box around the old reported coordinate.
  const blueProbe = [];
  for (let y = 360; y <= 420; y += 2) {
    for (let x = 320; x <= 380; x += 2) {
      const p = px(atmosOn, x, y);
      if (p.b > 120 && p.b - p.r > 60) blueProbe.push({ x, y, rgb: [p.r, p.g, p.b] });
    }
  }
  report.blueDot.pixelProbeBox = { x: [320, 380], y: [360, 420], matches: blueProbe.length, samples: blueProbe.slice(0, 12) };

  // Same probe with stars off vs on, to separate a star from scene geometry.
  await page.evaluate(() => window.__globe.setLookFlags({ stars: true }));
  await page.waitForTimeout(500);
  const withStars = await shoot('bluedot-stars-on');
  const blueWithStars = [];
  for (let y = 360; y <= 420; y += 2) {
    for (let x = 320; x <= 380; x += 2) {
      const p = px(withStars, x, y);
      if (p.b > 120 && p.b - p.r > 60) blueWithStars.push({ x, y, rgb: [p.r, p.g, p.b] });
    }
  }
  report.blueDot.withStarsOn = blueWithStars.length;
  report.blueDot.withStarsOff = blueProbe.length;
  await page.evaluate(() => window.__globe.setLookFlags({ stars: false }));
  await page.waitForTimeout(400);

  // ========================================================= (d) PIN HOUSING ===
  /*
   * California on the day side: the pin is chosen by whether its normal faces the
   * sun. Then the planet is rotated so the same pin sits on the night side, and
   * the same measurement is repeated — same pin, same camera, only the sun
   * relationship changing.
   */
  const measurePin = async (img, pin, coreR = 4) => {
    let cs = 0;
    let cn = 0;
    let cmax = 0;
    for (let y = Math.floor(pin.y - coreR); y <= Math.ceil(pin.y + coreR); y += 1) {
      for (let x = Math.floor(pin.x - coreR); x <= Math.ceil(pin.x + coreR); x += 1) {
        if ((x - pin.x) ** 2 + (y - pin.y) ** 2 > coreR * coreR) continue;
        const l = lpx(img, x, y);
        cs += l;
        cmax = Math.max(cmax, l);
        cn += 1;
      }
    }
    return { mean: cn ? cs / cn : 0, max: cmax, n: cn };
  };

  const pinState = async () => {
    const pins = await page.evaluate(() => window.__globe.pins());
    const camMat = await page.evaluate(() => Array.from(window.__camera.matrixWorld.elements));
    return pins.map((p) => ({ ...p, camMat }));
  };

  // Zoom to min distance so the core is as large as it gets.
  await page.evaluate(() => window.__globe.setCamera([0, 1.15, 1.25]));
  await page.waitForTimeout(600);
  const zoomShot = await shoot('pin-day-zoom');
  const zoomPins = await pinState();
  const calDay = zoomPins.find((p) => p.id === 'us-west');
  report.pinDay = {
    camera: [0, 1.15, 1.25],
    pin: calDay,
    ...(calDay && !calDay.behind ? await measurePin(zoomShot, calDay, 5) : {}),
    discRadius: await page.evaluate(() => window.__globe.discRadiusPx()),
  };

  /*
   * Night side: fly the camera to the anti-sun point at the same distance. The
   * sun direction is fixed in world space, so the anti-sun camera puts the
   * planet's night side toward the eye and every pin on that hemisphere is on the
   * night side.
   */
  const sun = [0.72, 0.36, 0.59];
  const len = Math.hypot(...sun);
  const d = 2.55;
  const nightCam = [(-sun[0] / len) * d, (-sun[1] / len) * d + 0.35, (-sun[2] / len) * d];
  await page.evaluate((c) => window.__globe.setCamera(c), nightCam);
  await page.waitForTimeout(700);
  const nightShot = await shoot('pin-night-zoom');
  const nightPins = await pinState();
  const facingNight = nightPins.filter((p) => p.facing && !p.behind);
  report.pinNight = {
    camera: nightCam,
    facing: facingNight.length,
    perPin: [],
  };
  for (const p of facingNight) {
    report.pinNight.perPin.push({ id: p.id, ...(await measurePin(nightShot, p, 5)) });
  }

  // ================================================================ (e) BLOOM ===
  report.bloom = await page.evaluate(() => {
    // Find the Bloom effect instance in the composer chain.
    const cats = [];
    window.__scene.traverse(() => {});
    return { look: window.__globe.look().bloom };
  });

  /*
   * Halo width around a pin: with the pin on, walk outward from a pin's core and
   * find how far its luminance stays elevated above the same ray with pins off.
   * That is the actual "does bloom smear this pin" measurement in CSS px.
   */
  await page.evaluate(() => window.__globe.setCamera([0, 1.15, 2.0]));
  await page.waitForTimeout(600);
  const pinsOnShotPins = await pinState();
  const target = pinsOnShotPins.find((p) => p.id === 'us-west' && p.facing && !p.behind)
    ?? pinsOnShotPins.find((p) => p.facing && !p.behind);

  if (target) {
    const onImg = await shoot('bloom-pin-on');
    await page.evaluate(() => window.__globe.setLookFlags({ pins: false, hotspotRings: false }));
    await page.waitForTimeout(500);
    const offImg = await shoot('bloom-pin-off');

    const radial = [];
    for (let r = 0; r <= 80; r += 1) {
      // Average a small angular fan so a single stray pixel cannot decide it.
      let on = 0;
      let off = 0;
      for (let a = 0; a < 12; a += 1) {
        const th = (a / 12) * Math.PI * 2;
        const x = target.x + Math.cos(th) * r;
        const y = target.y + Math.sin(th) * r;
        on += lpx(onImg, x, y);
        off += lpx(offImg, x, y);
      }
      radial.push({ r, on: Math.round((on / 12) * 10) / 10, off: Math.round((off / 12) * 10) / 10, delta: Math.round(((on - off) / 12) * 10) / 10 });
    }
    // Halo width = furthest radius where the delta is still >= 1/255.
    let haloWidth = 0;
    for (const row of radial) if (Math.abs(row.delta) >= 1) haloWidth = row.r;

    report.bloomHalo = { pin: target.id, x: Math.round(target.x), y: Math.round(target.y), radial, haloWidthPx: haloWidth };
    await page.evaluate(() => window.__globe.setLookFlags({ pins: true, hotspotRings: true }));
    await page.waitForTimeout(400);
  }

  // ================================================================== (f) SHOT ===
  await page.evaluate(() => window.__globe.setLookFlags({ stars: true }));
  await page.evaluate(() => window.__globe.setCamera([0, 1.15, 3.15]));
  await page.waitForTimeout(700);
  await shoot('step2-default');

  await writeFile(path.join(OUT, 'facts.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ lights: report.lights, rig: report.rig, blueDot: report.blueDot }, null, 2));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
