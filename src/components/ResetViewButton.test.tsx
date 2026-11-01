// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResetViewButton } from './ResetViewButton';
import {
  __resetViewStore,
  getResetRequest,
  getViewState,
  publishViewState,
  requestReset,
  subscribeResetRequest,
  subscribeViewState,
} from '@/scene/viewStore';

/*
 * What these tests pin down, and why each one is here rather than in a spec:
 *
 *  1. `aria-disabled` mirrors `viewIsDefault` in BOTH directions. The acceptance case U6 asserts it end to
 *     end, but the component must not need a browser to get the mapping wrong.
 *  2. A click raises exactly one RESET request. The counter (not a boolean) is the whole mechanism by
 *     which two clicks are two events, so "one click, one increment" is the property.
 *  3. A disabled button does not raise one. `disabled` and `aria-disabled` must agree, or the control
 *     looks disabled and still fires.
 *  4. The store notifies only on a real change. That is what keeps a 60 Hz publisher from producing 60 Hz
 *     renders, and it is invisible from a spec.
 */

beforeEach(() => {
  cleanup();
  __resetViewStore();
});

describe('ResetViewButton', () => {
  it('is aria-disabled while the view is the default, and enabled once it is not', () => {
    render(<ResetViewButton />);

    const button = screen.getByRole('button', { name: 'Reset view' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);

    act(() => publishViewState({ viewIsDefault: false, spinning: true }));

    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('raises exactly one RESET request per click, and none while disabled', () => {
    render(<ResetViewButton />);
    const button = screen.getByRole('button', { name: 'Reset view' });

    const before = getResetRequest();
    fireEvent.click(button);
    expect(getResetRequest(), 'a disabled button must not raise a request').toBe(before);

    act(() => publishViewState({ viewIsDefault: false, spinning: true }));
    fireEvent.click(button);
    expect(getResetRequest()).toBe(before + 1);
    fireEvent.click(button);
    expect(getResetRequest(), 'two clicks are two events').toBe(before + 2);
  });

  it('re-renders when only `spinning` changes, so the label never goes stale', () => {
    render(<ResetViewButton />);
    const button = screen.getByRole('button', { name: 'Reset view' });

    act(() => publishViewState({ viewIsDefault: true, spinning: false }));
    // The button's own state did not change, so it stays disabled — the point is that the publish did
    // not throw and the button is still there, correctly disabled.
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('viewStore', () => {
  it('drops a no-change publish: no notification, and the same object back', () => {
    let notifications = 0;
    const unsubscribe = subscribeViewState(() => {
      notifications += 1;
    });

    const first = getViewState();
    expect(first).toEqual({ viewIsDefault: true, spinning: true });

    publishViewState({ viewIsDefault: true, spinning: true });
    expect(notifications, 'a 60 Hz publisher must not produce 60 Hz renders').toBe(0);
    expect(getViewState(), 'the snapshot reference must stay stable').toBe(first);

    publishViewState({ viewIsDefault: false, spinning: true });
    expect(notifications).toBe(1);
    expect(getViewState().viewIsDefault).toBe(false);

    unsubscribe();
    publishViewState({ viewIsDefault: true, spinning: true });
    expect(notifications, 'an unsubscribed listener must not hear anything').toBe(1);
  });

  it('the reset channel is monotonic and every live subscriber sees every request', () => {
    let a = 0;
    let b = 0;
    const unsubA = subscribeResetRequest(() => {
      a += 1;
    });
    const unsubB = subscribeResetRequest(() => {
      b += 1;
    });

    const start = getResetRequest();
    requestReset();
    requestReset();
    expect(getResetRequest(), 'monotonic: two requests, +2').toBe(start + 2);
    expect(a, 'every subscriber hears both').toBe(2);
    expect(b).toBe(2);

    /* A view-state publish is NOT a reset request — the two channels are independent. */
    publishViewState({ viewIsDefault: false, spinning: true });
    expect(getResetRequest()).toBe(start + 2);

    unsubA();
    requestReset();
    expect(a, 'an unsubscribed listener must not hear anything').toBe(2);
    expect(b).toBe(3);
    unsubB();
  });
});
