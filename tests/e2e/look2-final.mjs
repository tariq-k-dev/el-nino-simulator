
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const OUT = '.cache/look2-final';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:4197/?debug');
await page.waitForFunction(() => !!window.__globe, null, { timeout: 90000 });
await page.waitForTimeout(1500);
// Full normal look: every layer on, DOM chrome visible (this is a review screenshot).
const D = 3.3534, el = Math.atan2(1.15, 3.15);
const r = D * Math.cos(el), y = D * Math.sin(el);
for (const az of [0, 90, 180]) {
  const a = az * Math.PI / 180;
  await page.evaluate((p) => window.__globe.setCamera(p), [r * Math.sin(a), y, r * Math.cos(a)]);
  await page.waitForTimeout(900);
  const name = az === 0 ? 'look2-default' : 'look2-az' + az;
  await page.screenshot({ path: path.join(OUT, name + '.png'), type: 'png' });
}
console.log('final shots done');
await browser.close();
