TASK 3B-1a-SPECLOCK-2B-C1. Repo: cd D:\Dev\Handshake\Build-an-Interactive-Data-Visualization (ONLY repo). FIRST confirm you can see the last line
"END OF PROMPT 2B-C1"; if not, STOP. Rules: gate = pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p); one commit per step; STOP on real failures and
report numbers, never tune thresholds; <= 12 tool calls per step; if low on turns commit what is green, update docs/3B-1-STATUS.md, STOP. Raw tables.

C0 PREFLIGHT: git status, git log --oneline -12. List: every test.fixme/test.skip in tests/e2e; the exact numeric windows currently hardcoded in the 3.5 spec;
which negative tests N1..N8 exist and their status. (The previous 2B run was the OLD prompt: steps B0 and B1 below were never executed.)

B0 FACTS (read-only; write docs/globe-look/FACTS-2B.md; commit the doc only)
 a) PIN RENDER DRIFT. The originally specified 3.5 windows were day ~(255,255,158..172), night ~(240,238,123)..(255,255,150); the harness now measures
    (255,255,181..189). Decide whether the RENDER changed or only the SAMPLING: run the CURRENT 3.5 measurement code against builds of commit 2e27939 and
    of HEAD (git worktree or clean detached checkout + pnpm build:e2e; leave the main tree clean on main afterwards). Same viewport, frozen clock, same flags.
    Report core RGB per pin at both commits and the sampled region definition (px count, radius). Agree within 3/channel -> render unchanged, old windows were
    a different sampling. Differ -> bisect 2e27939..HEAD, name the commit and cause (bloom, emissive pulse phase under a frozen clock, tone mapping,
    specular change...). If the cause is an UNINTENDED look change, STOP and report.
    Also write docs/globe-look/pins-day-night.png (<= 300 KB): 4x crops of each valid pin, day and night, labelled. Tariq will look at it.
 b) PACIFIC PIN (Nino 3.4) projects to r/R = 1.100, outside the disc. Every surface point projects INSIDE the silhouette, so it is either a pin with world
    radius > the others (floating off the globe) or a wrong projection in the helper. For all 4 pins report: world position, |position|, normal.dot(camera dir),
    projected (x,y) and r/R at az 0 and az 180. State which case it is. Fix ONLY a harness error; a floating pin is reported, not fixed.
 c) TERMINATOR AUDIT. After the "locally monotonic" change, say in words how the day plateau, night plateau and the 90%/10% crossings are found (pixels, window).
    Print the 12-azimuth table of max adjacent 1 px step; the locked 16/255 = ceil(1.25 x max) implies a measured max in (12, 12.8]: give the exact max and note it
    exceeded the 12/255 STOP rule. Also state why only W1 remains in 3.3 and why clouds hit W5/W8 although 3.3 specifies clouds OFF (was the flag really applied?).
 d) GLINT STATUS: one paragraph + numbers: verdict V1 (overlay still draws a glint) or GLINT REMOVED, max/area6 of Do and Dt, does tests/e2e/look/glint.spec.ts exist.
 COMMIT.

B1 REWRITE 3.5 as a SEMANTIC gate. The hardcoded RGB windows (old ones AND the new measured ones) are RETIRED.
 Core region: pixels within 0.6 x r_core_px of the pin's projected centre (r_core_px = projected radius of the core sphere via project() of an offset point; min 3x3);
 assert >= 5 samples. Valid pins: front-facing (dot >= 0.1) and r/R <= 0.97; invalid pins are listed with the reason, never counted as pass. Evaluate at
 az in {0, 90, 180, 270}; assert at least one DAY pin (sun.dot(normal) > 0.2) and one NIGHT pin (sun.dot(normal) < -0.1) are valid somewhere in that set.
 Gates per valid pin:  P1 median core luma >= 180.  P2 core pixels with min(R,G,B) >= 250 == 0.  P3 median saturation (max-min)/max >= 0.15 (R=255 => B <= 217).
 P4 median R >= 240, median G >= 200, median B <= median G.
 The measured medians are printed as INFORMATIONAL. Spec header states the rationale (the intent: not black, not blown out, still amber-tinted).
 COMMIT (spec green on the real render).

FINAL REPORT (then STOP): commit hashes; B0 a-d facts; the 3.5 table; list of every redefinition; git status --short.
END OF PROMPT 2B-C1
