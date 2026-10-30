
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const OUT = '.cache/look2-pins';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:4197/?debug');
await page.waitForFunction(() => !!window.__globe, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__lookToggles.set({ stars: false, hotspotRings: false }));
const meta = { shots: {} };
for (const az of [0, 120, 180, 210, 240]) {
  const D = 3.3534, el = Math.atan2(1.15, 3.15);
  const r = D * Math.cos(el), y = D * Math.sin(el), a = az * Math.PI / 180;
  await page.evaluate((p) => window.__globe.setCamera(p), [r * Math.sin(a), y, r * Math.cos(a)]);
  await page.waitForTimeout(700);
  const name = 'az' + String(az).padStart(3,'0');
  await page.screenshot({ path: path.join(OUT, name + '.png'), type: 'png' });
  meta.shots[name] = { az, pins: await page.evaluate(() => window.__globe.pins()) };
}
await writeFile(path.join(OUT,'meta.json'), JSON.stringify(meta,null,2));
console.log('pins done');
await browser.close();
