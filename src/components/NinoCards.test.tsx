/**
 * The two empirical cards, tested as STATIC MARKUP.
 *
 * ## Why `renderToStaticMarkup` and not `@testing-library/react`
 *
 * The component has no state, no effects, no event handlers and no refs — it is a pure
 * function of its props. Rendering it to a string is therefore the exact test: it proves the
 * markup the browser will receive, and it makes the "nothing interactive" rule checkable on
 * the raw string instead of through a live DOM where a `<button>` could be hidden behind a
 * query that happens to miss it. `@testing-library/react` IS installed (A3), so this is a
 * choice, not a constraint: no jsdom pragma, no `cleanup`, no act() warnings.
 *
 * ## Why the expectations are derived from `ninoCardModel`
 *
 * Hand-typing `+1.5` would pass today and silently rot the moment the fit is refit or the
 * relation module is corrected. Every text assertion below calls `ninoCardModel` at the same
 * slider position the component used and asserts the card CONTAINS the string the model
 * produced. The one exception is the `°C`/`°F` distinction, which is a literal in the model
 * and is asserted as a literal.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { NinoCards } from '@/components/NinoCards';
import { ninoCardModel } from '@/lib/ninoCard';

const SLIDER = 1.5;
const EXTRAPOLATING = 2.9;

/** Strip tags so text assertions are not confused by class names or attribute values. */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

describe('NinoCards markup', () => {
  const html = renderToStaticMarkup(<NinoCards nino34Anomaly={SLIDER} unit="C" layout="desktop" />);
  const text = textOf(html);

  it('renders the section with its test id', () => {
    expect(html).toContain('data-testid="nino-cards"');
  });

  it('renders exactly two cards with the two region test ids', () => {
    expect(html).toContain('data-testid="nino-card-nino12"');
    expect(html).toContain('data-testid="nino-card-nino4"');
    expect(html.match(/<article/g) ?? []).toHaveLength(2);
  });

  it.each(['nino12', 'nino4'] as const)('prints every string the model produces for %s', (id) => {
    const model = ninoCardModel(id, SLIDER, 'C');
    expect(text).toContain(model.regionLabel);
    expect(text).toContain(model.valueText);
    expect(text).toContain(model.rangeText);
    expect(text).toContain(model.badgeText);
    expect(text).toContain(model.captionText);
  });

  it('shows the metric and the range in °C', () => {
    expect(text).toContain('°C');
    expect(text).not.toContain('°F');
  });

  it('has the heading and both accessible region names', () => {
    expect(text).toContain('Niño indices, empirical');
    expect(text).toContain('NIÑO 1+2');
    expect(text).toContain('NIÑO 4');
  });

  it('labels the section by its heading', () => {
    expect(html).toContain('aria-labelledby="nino-cards-heading"');
    expect(html).toContain('id="nino-cards-heading"');
  });
});

describe('NinoCards is not interactive', () => {
  const html = renderToStaticMarkup(<NinoCards nino34Anomaly={SLIDER} unit="C" layout="desktop" />);

  it('contains no button', () => {
    expect(html).not.toMatch(/<button/i);
  });

  it('contains no anchor', () => {
    expect(html).not.toMatch(/<a[\s>]/i);
  });

  it('contains no form control', () => {
    expect(html).not.toMatch(/<input/i);
    expect(html).not.toMatch(/<select/i);
    expect(html).not.toMatch(/<textarea/i);
  });

  it('contains no tabindex in any casing', () => {
    expect(html).not.toMatch(/tabindex/i);
  });

  it('claims no button role', () => {
    expect(html).not.toMatch(/role="button"/i);
  });

  it('attaches no click handler attribute', () => {
    // Server rendering strips handlers anyway; this asserts none survived into the markup.
    expect(html).not.toMatch(/onclick/i);
  });

  it('uses no transition or animation class', () => {
    expect(html).not.toMatch(/transition|animate-/);
  });
});

describe('NinoCards units', () => {
  const celsius = renderToStaticMarkup(<NinoCards nino34Anomaly={SLIDER} unit="C" layout="desktop" />);
  const fahrenheit = renderToStaticMarkup(<NinoCards nino34Anomaly={SLIDER} unit="F" layout="desktop" />);

  it('produces different markup in °F than in °C', () => {
    expect(fahrenheit).not.toBe(celsius);
  });

  it('prints the °F model strings and the °F glyph', () => {
    const text = textOf(fahrenheit);
    for (const id of ['nino12', 'nino4'] as const) {
      const model = ninoCardModel(id, SLIDER, 'F');
      expect(text).toContain(model.valueText);
      expect(text).toContain(model.rangeText);
    }
    expect(text).toContain('°F');
  });

  it('uses °C only in the caption, which names the slider input', () => {
    // The value and range of every card are °F; the CAPTION still says "Niño 3.4 anomaly of
    // 1.5 °C" because it describes the slider's input, and the input is always °C
    // (`ninoCard.ts` builds that sentence from the °C argument). Two cards, two captions,
    // so exactly two °C — anything more means a metric line failed to convert.
    const text = textOf(fahrenheit);
    expect(text.match(/°C/g) ?? []).toHaveLength(2);
    expect(text.match(/°F/g) ?? []).toHaveLength(4);
    for (const id of ['nino12', 'nino4'] as const) {
      const model = ninoCardModel(id, SLIDER, 'C');
      expect(text).toContain(model.captionText);
    }
  });

  it('converts the value as a delta: the °F card never shows an absolute temperature', () => {
    // A +1.5 °C anomaly is +2.7 °F as a delta. With a +32 offset it would read +34.7 °F,
    // which on a card labelled "Typical range" would be nonsense. Assert the delta reading.
    const text = textOf(fahrenheit);
    const model = ninoCardModel('nino12', SLIDER, 'F');
    expect(text).toContain(model.valueText);
    expect(text).not.toContain('34.7');
  });
});

describe('NinoCards extrapolation note', () => {
  it('shows the note when the slider is beyond the observed range', () => {
    const html = renderToStaticMarkup(<NinoCards nino34Anomaly={EXTRAPOLATING} unit="C" layout="desktop" />);
    const text = textOf(html);
    expect(text).toContain('Beyond the observed range');
    // And it is the model's exact sentence, not a second hand-written one.
    expect(text).toContain(ninoCardModel('nino12', EXTRAPOLATING, 'C').noteText);
  });

  it('omits the note inside the observed range', () => {
    const html = renderToStaticMarkup(<NinoCards nino34Anomaly={SLIDER} unit="C" layout="desktop" />);
    expect(textOf(html)).not.toContain('Beyond the observed range');
  });

  it('names the observed maximum in the note', () => {
    const html = renderToStaticMarkup(<NinoCards nino34Anomaly={EXTRAPOLATING} unit="C" layout="desktop" />);
    // 2.72 °C is the warmest Niño 3.4 anomaly in the fit; the note must state it.
    expect(textOf(html)).toContain('2.72');
  });
});

describe('NinoCards conveys weakness in text, not colour', () => {
  it('prints the badge with r2 and n for both cards', () => {
    const html = renderToStaticMarkup(<NinoCards nino34Anomaly={SLIDER} unit="C" layout="desktop" />);
    const text = textOf(html);
    for (const id of ['nino12', 'nino4'] as const) {
      expect(text).toContain(ninoCardModel(id, SLIDER, 'C').badgeText);
    }
    expect(text.match(/EMPIRICAL/g) ?? []).toHaveLength(2);
  });

  it('says the number is a correlation, not a forecast', () => {
    const html = renderToStaticMarkup(<NinoCards nino34Anomaly={SLIDER} unit="C" layout="desktop" />);
    const text = textOf(html);
    expect(text).toContain('not a forecast');
    expect(text.match(/not a forecast/g) ?? []).toHaveLength(2);
  });

  it('prints the band as signed numbers so it survives with no colour at all', () => {
    const html = renderToStaticMarkup(<NinoCards nino34Anomaly={SLIDER} unit="C" layout="desktop" />);
    expect(textOf(html)).toContain(ninoCardModel('nino12', SLIDER, 'C').rangeText);
  });
});

describe('NinoCards layouts agree', () => {
  it('renders the same numbers on mobile as on desktop', () => {
    const desktop = textOf(renderToStaticMarkup(<NinoCards nino34Anomaly={SLIDER} unit="C" layout="desktop" />));
    const mobile = textOf(renderToStaticMarkup(<NinoCards nino34Anomaly={SLIDER} unit="C" layout="mobile" />));
    // Same text, different spacing class only.
    expect(mobile).toContain(ninoCardModel('nino12', SLIDER, 'C').valueText);
    expect(mobile).toContain(ninoCardModel('nino4', SLIDER, 'C').valueText);
    expect(desktop).toContain('Niño indices, empirical');
    expect(mobile).toContain('Niño indices, empirical');
  });
});
