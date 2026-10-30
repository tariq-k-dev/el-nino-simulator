
/** 3.5 exploration: what do the pin cores actually render at day and night? */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const lum = (r,g,b)=>0.2126*r+0.7152*g+0.0722*b;
const dec=(buf)=>{const p=PNG.sync.read(buf);return {width:p.width,height:p.height,data:p.data};};
const browser = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport:{width:1280,height:800}});
await page.goto('http://localhost:4197/?debug');
await page.waitForFunction(()=>!!window.__look&&!!window.__globe,null,{timeout:90000});
await page.evaluate(()=>{const c=document.querySelector('#globe-canvas canvas');const chain=new Set();let n=c;while(n){chain.add(n);n=n.parentElement;}for(const el of document.querySelectorAll('body *')){if(!chain.has(el))el.style.visibility='hidden';}});
const shoot=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return dec(await page.locator('#globe-canvas canvas').screenshot({type:'png'}));};

for (const az of [0,180]) {
  await page.evaluate((d)=>window.__look.setAzimuth(d), az);
  await page.waitForTimeout(600);
  const img = await shoot();
  const pins = await page.evaluate(()=>window.__globe.pins());
  console.log(`--- az=${az}`);
  for (const p of pins) {
    if (!p.facing) { console.log(`  ${p.id} not facing`); continue; }
    // Core: find the brightest pixel in a 14 px box, then report its RGB.
    let best=null;
    for(let y=Math.round(p.y)-14;y<=Math.round(p.y)+14;y++)for(let x=Math.round(p.x)-14;x<=Math.round(p.x)+14;x++){
      const o=(y*img.width+x)*4; const L=lum(img.data[o],img.data[o+1],img.data[o+2]);
      if(!best||L>best.L)best={x,y,L,rgb:[img.data[o],img.data[o+1],img.data[o+2]]};
    }
    // Pure white count in the core box
    let white=0, black=0;
    for(let y=Math.round(p.y)-6;y<=Math.round(p.y)+6;y++)for(let x=Math.round(p.x)-6;x<=Math.round(p.x)+6;x++){
      const o=(y*img.width+x)*4; const [r,g,b]=[img.data[o],img.data[o+1],img.data[o+2]];
      if(r>=250&&g>=250&&b>=250)white++;
      if(r===0&&g===0&&b===0)black++;
    }
    console.log(`  ${p.id} (${p.x.toFixed(1)},${p.y.toFixed(1)}) core=${JSON.stringify(best.rgb)} at (${best.x},${best.y}) white=${white} black=${black}`);
  }
}
await browser.close();
