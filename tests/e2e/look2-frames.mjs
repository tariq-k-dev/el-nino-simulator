
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const OUT = '.cache/look2-frames';
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
await page.waitForTimeout(800);
const meta = {
  centre: await page.evaluate(() => window.__globe.project()),
  radius: await page.evaluate(() => window.__globe.discRadiusPx()),
  pins: await page.evaluate(() => window.__globe.pins()),
  look: await page.evaluate(() => window.__lookToggles.look().lights),
};
const snap = async (name) => {
  await page.screenshot({ path: path.join(OUT, name + '.png'), type: 'png' });
};
const set = async (p) => { await page.evaluate((x) => window.__lookToggles.set(x), p); await page.waitForTimeout(450); };
await snap('00-baseline');
for (const f of ['lightFill','lightRim','lightAmbient','lightSun']) {
  await set({ [f]: false }); await snap('01-' + f + '-off'); await set({ [f]: true });
}
await set({ lightFill: false, lightRim: false }); await snap('02-fill-rim-off'); await set({ lightFill: true, lightRim: true });
await set({ lightFill: false }); await snap('03-nofill'); await set({ lightFill: true });
await set({ lightRim: false }); await snap('04-norim'); await set({ lightRim: true });
await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
console.log('done', JSON.stringify(meta.centre), meta.radius.toFixed(2));
await browser.close();
