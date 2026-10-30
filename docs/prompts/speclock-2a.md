# 3B-1a-SPECLOCK 2A — sections A3 and A4

Recovered source of truth for the 3.2–3.8 specs. The original `docs/prompts/speclock-2a.md`
was absent from the repo when 2A3 began; the text below is the A3/A4 portion of the 2A
task, transcribed verbatim, with the 2A3 amendments recorded at the end. Amendments win
over this file where they conflict.

## A3 PROBE WINDOWS (fixes 3.3)

Define windows in disc-relative polar coords (fraction of R_fit, angle measured from +x,
clockwise on screen) and convert to px at run time. Validity rule: window center
r <= R_fit - 28 px, and >= 70% of the annulus pixels inside the disc; assert it. Windows
(r, angle): W1 (0.91, 180) = the (344,392) regression point (it must be here), W2 (0.80,
135), W3 (0.80, 225), W4 (0.50, 180), W5 (0.00, 0), W6 (0.80, 0) [lit side; exclude 0.15R
around the predicted glint point], W7 (0.80, 90), W8 (0.80, 270). The absolute (300,392)
window is DELETED. Print each window's pixel center and r/R.

## A4 SPECS in tests/e2e/look/look.spec.ts

Thresholds are FINAL.

- **3.1 RIM** (default view, stars OFF, mean of 16 rays): peak <= 110/255; strictly
  decreasing outward from the peak on every ray (tolerance 1/255, state it); step at the
  shell silhouette <= 2/255; outer edge within 2/255 of the background; max adjacent
  ABSOLUTE step on the mean profile beyond +2 px from the limb <= 16/255; limb->halo step
  reported only. Print the raw profile.
- **3.2 GLARE** (stars, pins, rings OFF; all 12 azimuths): clipped px (min(R,G,B) >= 250
  inside disc) == 0 AND largest 8-connected blob (luma >= 250) <= 12 px.
- **3.3 LOCAL PEAK** (default view; clouds, pins, rings, stars OFF): in W1..W8 the
  Gaussian(sigma 3)-blurred luma peak <= 1.15 x median of the annulus r 8..20 px around
  it, except within 0.15R of the predicted glint point. If you can sample the ocean mask
  from earth_specular.jpg cheaply, also scan the whole ocean at az 0,90,180,270; otherwise
  state that only W1..W8 are covered.
- **3.4 TERMINATOR**, measured FROM PIXELS. Default view: luma profile along the
  projected-sun axis through the terminator crossing (analytic crossing only to choose
  where to sample); median of 5 parallel lines at offsets -0.2R..+0.2R; width from 90% to
  10% of (day plateau - night plateau) >= 6% of R_fit; night fraction by luma within
  10-30%; night mean luma >= 4/255. Other 11 azimuths: gate ONLY night mean luma >= 4/255
  and "no hard step across the terminator" = max adjacent 1 px luma step across the
  terminator on that median profile. Set that threshold from the real 12-azimuth table as
  ceil(1.25 x max measured) and write table + threshold in the doc; if any measured step >
  12/255, STOP and report.
- **3.5 PINS DAY AND NIGHT**: for each pin visible at the default view and at az 180 (at
  least one night-side pin must be visible; else choose the azimuth where it is): core RGB
  not black; 0 pure-white px (R,G,B all >= 250) in the core; day core ~ (255,255,158..172);
  night core ~ (240,238,123)..(255,255,150); tolerance +-12 per channel (state it).
- **3.6 RING LUMINANCE / NO LIGHT CAST**: STATIC frame (rings, atmosphere, stars OFF;
  auto-rotate OFF); annulus r = 30..60 css px around each pin's projected center
  (outside-disc pixels excluded; start >= 24 px because of the ~22 px bloom skirt); mean
  luma pin-ON vs pin-OFF (pins hidden via __look) AND noise = pin-OFF vs pin-OFF (two
  captures). PASS iff |delta%| <= max(3%, 1.5 x noise%). Report delta and noise for all 4
  pins.
- **3.7 CONSOLE**: zero warnings/errors during all of the above.
- **3.8** The 5 zoom cases in globe.spec.ts pass untouched.

If a spec fails on the real render: STOP and report the numbers; do not change the
threshold.

## 2A3 amendments (these win over the text above)

1. Limb origin everywhere = `fitLimb` (R_fit, cx, cy). Probe windows (A3) are
   disc-relative polar, validity rule enforced by assertion, (300,392) deleted.
2. 3.3's glint exclusion = `specularMask(page)` from 2A2 (replaces "0.15 R around the
   predicted glint point"). Windows W1..W8 as in A3. W1 (0.91 R, 180 deg) is the
   (344,392) regression window and MUST be present.
3. 3.2 runs after the glint decision: same thresholds (0 clipped px; largest luma>=250
   blob <= 12 px; all 12 azimuths).
4. 3.4 "night fraction by luma 10-30%" uses the SAME definition that produced the 14.1%
   default-view figure in the earlier sweep; the 10-30% / 70-90% bands are only for
   relative before/after comparisons and are not gated. Terminator measured from pixels as
   written above. 12-azimuth step threshold = ceil(1.25 x max measured), written with its
   table in `docs/globe-look/`; STOP if any measured step > 12/255.
5. 3.6 ring luminance: frozen clock, rings/atmosphere/stars OFF, annulus r 30..60 css px,
   pass iff |delta%| <= max(3%, 1.5 x noise%); report delta and noise per pin (4 pins).
6. 3.7 console clean, 3.8 the 5 zoom cases untouched.
7. Pixel specs must assert input validity (disc found, R_fit RMS <= 0.4, sample counts >
   0, no NaN).
