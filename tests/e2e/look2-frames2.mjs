
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const OUT = '.cache/look2-frames2';
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
const snap = async (n) => page.screenshot({ path: path.join(OUT, n + '.png'), type: 'png' });
const set = async (p) => { await page.evaluate((x) => window.__lookToggles.set(x), p); await page.waitForTimeout(450); };
await set({ atmosphere:false }); await snap('atmos-off'); await set({ atmosphere:true });
await set({ specular:false });  await snap('spec-off');   await set({ specular:true });
await set({ clouds:false });    await snap('clouds-off'); await set({ clouds:true });
await set({ bloom:false });     await snap('bloom-off');  await set({ bloom:true });
await set({ lightSun:false });  await snap('sun-off');    await set({ lightSun:true });
await set({ lightAmbient:false, lightFill:false, lightRim:false }); await snap('nonsun-off');
await set({ lightAmbient:true, lightFill:true, lightRim:true });
await set({ lightFill:false }); await snap('fill-off');  await set({ lightFill:true });
await set({ lightRim:false });  await snap('rim-off');   await set({ lightRim:true });
await set({ lightAmbient:false }); await snap('amb-off'); await set({ lightAmbient:true });
console.log('frames2 done');
await browser.close();
