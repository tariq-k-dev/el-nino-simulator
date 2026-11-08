/**
 * Niño 1+2 and Niño 4 empirical cards — STATIC and NON-INTERACTIVE.
 *
 * ## What this is not
 *
 * No fly-to, no drawer, no pins, no overlay, no state. Nothing here is clickable: there is
 * no `<button>`, no `<a>`, no `<input>`, no `tabIndex` and no `role="button"`. The two cards
 * report what the empirical fit says at the current slider position and that is all, which
 * is why they can be added without touching the focus machine, the camera, the drawer or
 * `RegionCards`.
 *
 * ## Where it sits, and why
 *
 * Desktop: INSIDE the `[data-occluder="right-panel"]` element, after `<RegionCards>`. That
 * placement is the point — the insets registry reads `[data-occluder]` rects and
 * `computeInsets` charges each assigned edge the MAX thickness it sees
 * (`src/layout/insets.ts:187-196`), so a taller right panel widens the reserved right inset
 * and the globe's free rect and fit distance account for the cards automatically. Had the
 * cards been rendered as a sibling outside that element, they would have covered the globe
 * without the framing knowing.
 *
 * This reconciles the step 2.3a memo, which warned the new stack must sit outside the
 * occluder. That warning was about the flag being ON-but-EMPTY — an empty wrapper would
 * have widened the inset for nothing. Here nothing is rendered at all when the flag is off
 * (the mount is `{flag ? <NinoCards …/> : null}`, not a wrapper with a class), so the OFF
 * case is structurally identical to `4a2c185`, and the ON case SHOULD move the inset.
 *
 * ## Numbers
 *
 * Every string comes from `ninoCardModel` (`src/lib/ninoCard.ts`), which delegates to
 * `pickRelation`/`projectAnomaly` in `src/lib/ninoRelation.ts`. Nothing is formatted here,
 * so the one-decimal rule, the ASCII-minus glyph and the °F delta law all live in one place.
 *
 * ## Accessibility
 *
 * The section is labelled by its heading via `aria-labelledby`, so a screen reader
 * announces "Niño indices, empirical, region" rather than an unlabelled group. Weak-fit
 * status is carried by the badge TEXT ("EMPIRICAL · R2 … · N …") and by the caption, never
 * by colour alone — the badge is the same slate the rest of the panel uses. The band is
 * printed as numbers ("-0.7 to +1.3"), so the uncertainty survives with no colour at all.
 */
import {
    ninoCardModel,
    type NinoCardUnit,
    type NinoCardModel,
} from "@/lib/ninoCard";
import type { NinoRelationRegion } from "@/lib/ninoRelation";

/** The two regions this component renders, in display order. */
const REGION_ORDER: NinoRelationRegion[] = ["nino12", "nino4"];

interface NinoCardsProps {
    /** The slider's Niño 3.4 anomaly, in °C — the same number `ScenarioState.sstAnomaly` holds. */
    nino34Anomaly: number;
    /** The app's unit system, so a °F reader sees °F. A DELTA conversion: ×1.8, no offset. */
    unit: NinoCardUnit;
    /**
     * Which surface is rendering. Carried for spacing only — the markup and the numbers are
     * identical on both, which is what keeps the sheet and the desktop panel from drifting.
     */
    layout: "desktop" | "mobile";
    /**
     * The only trigger that flies the globe to a Niño box (step 2.3c-1, C2.1).
     *
     * The pins are deliberately NON-interactive (`dotOnly` on `Hotspot`), so this callback is the
     * whole of the flight surface. Optional so the 2.3b unit tests that render the cards without a
     * flight handler keep working unchanged.
     */
    onShowOnGlobe?: (boxId: string) => void;
    /** The box currently flown to, for `aria-pressed`. `null` when nothing is selected. */
    activeBoxId?: string | null;
}

/** One card. Deliberately an `<article>`, not a button: it is a reading surface. */
function NinoCard({
    model,
    onShowOnGlobe,
    activeBoxId = null,
}: {
    model: NinoCardModel;
    onShowOnGlobe?: (boxId: string) => void;
    activeBoxId?: string | null;
}) {
    return (
        <article
            data-testid={`nino-card-${model.regionId}`}
            className={[
                "relative overflow-hidden rounded-xl border px-3 py-2.5 text-left",
                "border-[rgba(255,255,255,0.12)] bg-[rgba(10,15,25,0.82)] backdrop-blur-md",
            ].join(" ")}
            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}
        >
            {/* The accent rule the region cards use, kept neutral here — these are not selectable. */}
            <span
                className="absolute inset-y-0 left-0 w-[2px]"
                style={{
                    background:
                        "linear-gradient(180deg, transparent, rgba(148,163,184,0.7), transparent)",
                }}
            />

            <h3 className="text-[11.5px] font-medium leading-tight text-slate-100">
                {model.regionLabel}
            </h3>

            <p className="num mt-0.5 text-[15px] font-semibold leading-tight text-slate-100">
                {model.valueText}
                <span className="ml-0.5 text-[10px] font-normal text-slate-500">
                    {model.unitText}
                </span>
            </p>

            <p className="num mt-1 text-[9.5px] leading-snug text-slate-400">
                Typical range {model.rangeText} {model.unitText}
            </p>

            <p className="mt-1 text-[8.5px] uppercase tracking-[0.14em] text-slate-500">
                {model.badgeText}
            </p>

            {model.noteText ? (
                <p className="mt-1.5 rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-2 py-1 text-[9.5px] leading-snug text-amber-200/90">
                    {model.noteText}
                </p>
            ) : null}

            <p className="mt-1.5 text-[9px] leading-snug text-slate-500">
                {model.captionText}
            </p>

            {/*
        C2.1 — the ONLY trigger that flies the globe to this box.

        `min-h-11` is the 44 px touch target the step requires; `min-w-11` keeps a short label from
        producing a narrow target. `aria-pressed` carries the selected state (the outline highlight
        mirrors it), and the aria-label spells out which box, because "Show on globe" alone would be
        ambiguous read out of context. Keyboard-accessible by being a real <button>.
      */}
            {onShowOnGlobe ? (
                <button
                    type="button"
                    data-testid={`nino-show-${model.regionId}`}
                    onClick={() => onShowOnGlobe(model.regionId)}
                    aria-pressed={activeBoxId === model.regionId}
                    aria-label={`Show ${model.regionLabel} on the globe`}
                    className={[
                        "mt-2 flex min-h-11 min-w-11 w-full items-center justify-center gap-1.5 rounded-lg border px-2",
                        "font-mono text-[9px] font-medium uppercase tracking-[0.14em] transition-colors",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300/70",
                        activeBoxId === model.regionId
                            ? "border-sky-300/50 bg-sky-300/15 text-sky-100"
                            : "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.04)] text-slate-300 hover:border-[rgba(255,255,255,0.34)] hover:text-white",
                    ].join(" ")}
                >
                    <span aria-hidden="true">◎</span>
                    Show on globe
                </button>
            ) : null}
        </article>
    );
}

export function NinoCards({
    nino34Anomaly,
    unit,
    layout,
    onShowOnGlobe,
    activeBoxId = null,
}: NinoCardsProps) {
    const models = REGION_ORDER.map((id) =>
        ninoCardModel(id, nino34Anomaly, unit),
    );

    return (
        <section
            data-testid="nino-cards"
            aria-labelledby="nino-cards-heading"
            /*
             * `pointer-events-auto` — REQUIRED, and its absence was a real defect found by the C2 driver.
             *
             * The desktop right panel is `pointer-events-none` on purpose (it is an overlay above a
             * full-viewport canvas), so every interactive child re-enables pointer events for itself:
             * `RegionCards.tsx:31` does exactly this. Without it, `elementFromPoint` at the "Show on globe"
             * button returned the `#globe-canvas` div and Playwright reported "canvas intercepts pointer
             * events" on every retry — the only trigger for a Niño flight was unclickable on desktop.
             * Harmless on mobile, where the sheet body is not inside a pointer-events-none ancestor.
             */
            className={[
                "pointer-events-auto flex flex-col gap-2",
                layout === "mobile" ? "mt-3" : "mt-2",
            ].join(" ")}
        >
            <div className="flex items-center justify-between px-1">
                <h2
                    id="nino-cards-heading"
                    className="text-[8.5px] uppercase tracking-[0.2em] text-slate-500"
                >
                    Niño indices, empirical
                </h2>
                <span className="text-[8.5px] uppercase tracking-[0.14em] text-slate-600">
                    {REGION_ORDER.length} indices
                </span>
            </div>

            <div className="flex flex-col gap-2">
                {models.map((model) => (
                    <NinoCard
                        key={model.regionId}
                        model={model}
                        onShowOnGlobe={onShowOnGlobe}
                        activeBoxId={activeBoxId}
                    />
                ))}
            </div>
        </section>
    );
}
