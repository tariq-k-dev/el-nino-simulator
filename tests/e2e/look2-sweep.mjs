
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const OUT = '.cache/look2-sweep';
await mkdir(OUT, { recursive: true });
const D = Number(process.argv[2] || 3.3534);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:4197/?debug');
await page.waitForFunction(() => !!window.__globe, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const c = document.querySelector('#globe-canvas canvas');
  const chain = new Set(); let n = c;
  while (n) { chain.add(n); n = n.parentElement; }
  for (const el of document.querySelectorAll('body *')) if (!chain.has(el)) el.style.visibility = 'hidden';
});
await page.evaluate(() => window.__lookToggles.set({ stars: false, hotspotRings: false }));
const meta = { cameraDistance: D, sunDirRaw: [0.72,0.36,0.59], shots: {} };
for (let az = 0; az < 360; az += 30) {
  // camera on a circle at elevation matching the default (0,1.15,3.15) -> polar
  const el = Math.atan2(1.15, 3.15);          // elevation above equator plane
  const r = D * Math.cos(el), y = D * Math.sin(el);
  const a = az * Math.PI / 180;
  const pos = [r * Math.sin(a), y, r * Math.cos(a)];
  await page.evaluate((p) => window.__globe.setCamera(p), pos);
  await page.waitForTimeout(420);
  const name = 'az' + String(az).padStart(3,'0');
  await page.screenshot({ path: path.join(OUT, name + '.png'), type: 'png' });
  meta.shots[name] = {
    az, camera: pos,
    centre: await page.evaluate(() => window.__globe.project()),
    radius: await page.evaluate(() => window.__globe.discRadiusPx()),
    camMat: await page.evaluate(() => Array.from(window.__camera.matrixWorld.elements)),
  };
}
await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
console.log('sweep done', Object.keys(meta.shots).length, 'angles');
await browser.close();
