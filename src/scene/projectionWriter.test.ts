/**
 * Step 3-MOBILE1 B — the projection-write guard, with its own negative fixture.
 *
 * ## Why this is a separate file rather than four more cases in `singleWriter.test.ts`
 *
 * `singleWriter.test.ts` asserts a property of the whole of `src/`: no camera write outside the allowlist.
 * This file asserts a NARROWER, sharper rule that needs a different mechanism to be trustworthy — the
 * vetted scanner must be proven able to FAIL, which means feeding it source it was never meant to see. Keeping
 * that machinery out of the whole-tree guard means the whole-tree guard still reads as one assertion about
 * one rule, and this one reads as what it is: a scanner with a self-test.
 *
 * ## The rule
 *
 * After mount, `CameraDirector` is the only module that touches the PROJECTION MATRIX. A window offset is
 * camera state like any other, and a second writer would be able to un-centre the globe between two frames
 * with nothing in the source saying so — the same failure the 3B single-writer rule exists to prevent, one
 * matrix down.
 *
 *   1. `setViewOffset(`     — installs one
 *   2. `clearViewOffset(`   — removes one
 *   3. `updateProjectionMatrix(` — the commit; a write in everything but name
 *
 * The scanner is vetted on TWO axes before it is trusted: a file that MUST fail, and a file that must pass.
 * Both are inline fixtures, so the proof travels with the rule rather than with a file someone may delete.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..", "..");
const SRC = path.join(REPO, "src");

/** The one module allowed to write the projection matrix, and why. */
const DIRECTOR = "src/scene/CameraDirector.tsx";

/** The three patterns, each with the reason it is a projection write. */
export const PROJECTION_WRITE_PATTERNS: ReadonlyArray<{
    name: string;
    re: RegExp;
}> = [
    { name: "setViewOffset", re: /\.setViewOffset\s*\(/ },
    { name: "clearViewOffset", re: /\.clearViewOffset\s*\(/ },
    { name: "updateProjectionMatrix", re: /\.updateProjectionMatrix\s*\(/ },
];

/**
 * Replace comments with spaces, so a rule described in prose never trips it and line numbers stay true.
 *
 * Same implementation as `singleWriter.test.ts:90-94`, deliberately duplicated rather than imported: that
 * file's copy is private, and exporting it to share would make two guards' behaviour depend on one file's
 * refactor. Seven lines of duplication is the cheaper coupling here.
 */
export function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(/\/\/[^\n]*/g, "");
}

/**
 * The scanned rule: every projection write in `code`, as `line — name` strings.
 *
 * ## Why this scans the whole text and then maps back to a line, rather than going line by line
 *
 * A line-by-line scan misses a call whose parenthesis is on the NEXT line:
 *
 *     camera.setViewOffset
 *     (W, H, 0, dy, W, H);
 *
 * which is exactly how a formatter breaks a call with seven arguments — so the line-by-line version, which
 * the first draft of this file used, would have gone green on a real violation that Prettier introduced.
 * The negative fixture below includes that shape for precisely this reason and it failed before the fix.
 *
 * Exported so the negative fixture drives THIS function rather than a re-implementation. A self-test that
 * calls a copy proves the copy works.
 */
export function projectionWritesIn(code: string): string[] {
    const stripped = stripComments(code);
    /* Line starts, so an offset can be turned back into a 1-based line number. */
    const lineStarts = [0];
    for (let i = 0; i < stripped.length; i += 1) {
        if (stripped[i] === "\n") lineStarts.push(i + 1);
    }
    const lineOf = (offset: number): number => {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (lineStarts[mid] <= offset) lo = mid;
            else hi = mid - 1;
        }
        return lo + 1;
    };

    const out: string[] = [];
    for (const { name, re } of PROJECTION_WRITE_PATTERNS) {
        const global = new RegExp(re.source, "g");
        let match: RegExpExecArray | null;
        while ((match = global.exec(stripped)) !== null) {
            out.push(`${lineOf(match.index)} — ${name}`);
        }
    }
    /* Sorted by line so a message reads top to bottom, then by pattern for a stable order on one line. */
    out.sort((a, b) => Number(a.split(" ")[0]) - Number(b.split(" ")[0]));
    return out;
}

/** Every `.ts`/`.tsx` under `src/`, as repo-relative POSIX paths. */
async function sources(): Promise<Array<{ abs: string; rel: string }>> {
    const out: Array<{ abs: string; rel: string }> = [];
    const walk = async (dir: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (/\.(ts|tsx)$/.test(entry.name)) {
                out.push({
                    abs: full,
                    rel: path.relative(REPO, full).split(path.sep).join("/"),
                });
            }
        }
    };
    await walk(SRC);
    return out;
}

describe("the projection-write scanner", () => {
    it("NEGATIVE FIXTURE: fails on a violation, naming the line and the pattern", () => {
        /*
         * A miniature of exactly the mistake the rule exists to catch: a component that re-centres the globe
         * itself. This must be reported, with the line number, or the guard below is decorative.
         */
        const offender = [
            "import * as THREE from 'three';",
            "",
            "export function RogueOffset({ camera }: { camera: THREE.Camera }) {",
            "  camera.setViewOffset(390, 844, 0, 190, 390, 844);",
            "  camera.updateProjectionMatrix();",
            "  return null;",
            "}",
        ].join("\n");

        const found = projectionWritesIn(offender);
        expect(found.length).toBe(2);
        expect(found[0]).toContain("setViewOffset");
        expect(found[0].startsWith("4")).toBe(true);
        expect(found[1]).toContain("updateProjectionMatrix");
        expect(found[1].startsWith("5")).toBe(true);
    });

    it("NEGATIVE FIXTURE: sees clearViewOffset, and a call with a newline before the paren", () => {
        expect(projectionWritesIn("cam.clearViewOffset();")).toHaveLength(1);
        expect(
            projectionWritesIn("cam.setViewOffset\n(1, 2, 3, 4, 5, 6);"),
        ).toHaveLength(1);
    });

    it("POSITIVE CONTROL: passes on a file that only MENTIONS the calls in prose", () => {
        /*
         * The guard's own failure mode would be firing on documentation — several files in `src/` describe
         * `setViewOffset` at length in comments (this one included). If the comment stripper regressed, every one
         * of them would go red, so the positive control is as load-bearing as the negative.
         */
        const prose = [
            "/**",
            " * This component never calls camera.setViewOffset() and never calls",
            " * camera.updateProjectionMatrix(): CameraDirector owns the projection.",
            " */",
            "// camera.clearViewOffset() is also the director.s job.",
            "export const nothing = 1;",
        ].join("\n");
        expect(projectionWritesIn(prose)).toEqual([]);
    });

    it("POSITIVE CONTROL: an unrelated .update() is not a projection write", () => {
        expect(projectionWritesIn("controls.update();")).toEqual([]);
        expect(projectionWritesIn("camera.updateMatrixWorld(true);")).toEqual(
            [],
        );
    });
});

describe("no projection write outside the director", () => {
    it("every .ts/.tsx under src/ is clean, except the director and test files", async () => {
        const offenders: string[] = [];
        for (const { abs, rel } of await sources()) {
            if (rel === DIRECTOR) continue;
            /* Tests build cameras and assert on them; none of them runs in the app. Same exemption as 3B's guard. */
            if (/\.test\.(ts|tsx)$/.test(rel)) continue;
            const code = await readFile(abs, "utf8");
            for (const hit of projectionWritesIn(code)) {
                offenders.push(`${rel}:${hit}`);
            }
        }
        expect(
            offenders,
            "the projection matrix has a second writer; only CameraDirector may touch it " +
                "(docs/MOBILE-AUDIT.md §4, docs/MOBILE.md):\n  " +
                offenders.join("\n  "),
        ).toEqual([]);
    });

    it("the director really does write all three, so the rule is describing the system", async () => {
        /*
         * The other direction. A guard that passes because nobody writes the projection any more is a guard whose
         * subject has moved, and it would stay green through exactly the refactor it should have blocked.
         */
        const code = await readFile(path.join(REPO, DIRECTOR), "utf8");
        const names = projectionWritesIn(code).map((hit) =>
            hit.split("—")[1].trim(),
        );
        expect(names).toContain("setViewOffset");
        expect(names).toContain("clearViewOffset");
        expect(names).toContain("updateProjectionMatrix");
    });

    it("the mobile surface publishes layout state and never touches the camera", async () => {
        /*
         * The prompt's own sentence, as an assertion. Every module under `src/mobile/` is a candidate: the sheet,
         * the HUD, the drag hook and the arithmetic all publish layout state, and none of them may touch a camera.
         * Enumerated from the DIRECTORY rather than a hand-written list, so a file added later is covered without
         * anyone remembering to add it here — which is the failure mode a hand-written list has.
         */
        const dir = path.join(SRC, "mobile");
        const files = (await readdir(dir)).filter(
            (f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f),
        );
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const code = stripComments(
                await readFile(path.join(dir, file), "utf8"),
            );
            expect(
                projectionWritesIn(code),
                `src/mobile/${file} must not touch the projection`,
            ).toEqual([]);
            /* And no camera state at all: an import would make a write possible two refactors from now. */
            expect(
                /\bcamera\b/.test(code),
                `src/mobile/${file} must not mention a camera`,
            ).toBe(false);
        }
    });
});
