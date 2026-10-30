
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const OUT = '.cache/look2-fix';
await mkdir(OUT, { recursive: true });
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
await page.evaluate(() => window.__globe.setCamera([0, 1.15, 3.15]));
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(OUT, 'fixed-default.png'), type: 'png' });
const meta = {
  centre: await page.evaluate(() => window.__globe.project()),
  radius: await page.evaluate(() => window.__globe.discRadiusPx()),
  pins: await page.evaluate(() => window.__globe.pins()),
  flags: await page.evaluate(() => window.__lookToggles.get()),
  lightsInScene: await page.evaluate(() => {
    const out = [];
    window.__scene.traverse((o) => { if (o.isLight) out.push({ type: o.type, color: '#' + o.color.getHexString(), intensity: o.intensity, pos: [o.position.x, o.position.y, o.position.z] }); });
    return out;
  }),
};
await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta.lightsInScene, null, 1));
await browser.close();
