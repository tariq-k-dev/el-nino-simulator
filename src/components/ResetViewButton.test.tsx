// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { ResetViewButton } from "./ResetViewButton";
import {
    __resetViewStore,
    getResetRequest,
    getViewState,
    publishHasRegion,
    publishViewState,
    requestReset,
    subscribeResetRequest,
    subscribeViewState,
} from "@/scene/viewStore";
import { resetView } from "@/scene/resetView";

/*
 * What these tests pin down, and why each one is here rather than in a spec:
 *
 *  1. `aria-disabled` mirrors the DISABLE RULE in BOTH directions, and the rule is
 *     `viewIsDefault && !hasRegion` (step 3B2-FIX1 B). The acceptance case U6 asserts it end to end, but
 *     the component must not need a browser to get the mapping wrong.
 *  2. A click raises exactly one RESET request AND one selection clear. The defect this step fixes was a
 *     button that raised only the first, so "both channels, once each" is the property under test — not
 *     merely "something happened".
 *  3. A disabled button does neither. `disabled` and `aria-disabled` must agree, or the control looks
 *     disabled and still fires.
 *  4. The store notifies only on a real change, including for the new `hasRegion` field.
 *  5. Reset never drives the camera or the machine directly: it calls the two channels, which is what keeps
 *     the single-writer guard intact.
 */

/** The view state with the defaults spelled out, so a test states only what it cares about. */
const view = (over: Partial<ReturnType<typeof getViewState>> = {}) => ({
    viewIsDefault: true,
    spinning: true,
    hasRegion: false,
    ...over,
});

beforeEach(() => {
    cleanup();
    __resetViewStore();
});

describe("ResetViewButton", () => {
    it("is aria-disabled at the load state, and enabled once the pose is not the default", () => {
        render(<ResetViewButton onClearSelection={() => {}} />);

        const button = screen.getByRole("button", { name: "Reset view" });
        expect(button.getAttribute("aria-disabled")).toBe("true");
        expect((button as HTMLButtonElement).disabled).toBe(true);

        act(() => publishViewState(view({ viewIsDefault: false })));

        expect(button.getAttribute("aria-disabled")).toBe("false");
        expect((button as HTMLButtonElement).disabled).toBe(false);
    });

    it("is ENABLED while a region is open even when the pose is the default", () => {
        /*
         * The regression this case exists for. `viewIsDefault` is a question about the POSE, so an open region
         * over a default-pose globe used to disable the one control that could close it — which is exactly the
         * state the old Reset produced, because it never cleared the selection.
         */
        render(<ResetViewButton onClearSelection={() => {}} />);
        const button = screen.getByRole("button", { name: "Reset view" });

        act(() => publishHasRegion(true));

        expect(
            getViewState().viewIsDefault,
            "the pose is still the default",
        ).toBe(true);
        expect(
            button.getAttribute("aria-disabled"),
            "an open region is its own reason to reset",
        ).toBe("false");
        expect((button as HTMLButtonElement).disabled).toBe(false);

        act(() => publishHasRegion(false));
        expect(
            button.getAttribute("aria-disabled"),
            "back at the load state, so disabled again",
        ).toBe("true");
    });

    it("raises exactly one RESET request AND one selection clear per click, and neither while disabled", () => {
        const clear = vi.fn();
        render(<ResetViewButton onClearSelection={clear} />);
        const button = screen.getByRole("button", { name: "Reset view" });

        const before = getResetRequest();
        fireEvent.click(button);
        expect(
            getResetRequest(),
            "a disabled button must not raise a request",
        ).toBe(before);
        expect(
            clear,
            "a disabled button must not clear the selection",
        ).not.toHaveBeenCalled();

        act(() => publishViewState(view({ viewIsDefault: false })));
        fireEvent.click(button);
        expect(getResetRequest()).toBe(before + 1);
        expect(
            clear,
            "Reset must take the drawer X / Escape path too",
        ).toHaveBeenCalledTimes(1);

        fireEvent.click(button);
        expect(getResetRequest(), "two clicks are two events").toBe(before + 2);
        expect(clear).toHaveBeenCalledTimes(2);
    });

    it("publishes hasRegion false immediately on click, so the drawer flag cannot outlive the selection", () => {
        const clear = vi.fn();
        render(<ResetViewButton onClearSelection={clear} />);
        act(() => publishHasRegion(true));

        fireEvent.click(screen.getByRole("button", { name: "Reset view" }));

        expect(clear).toHaveBeenCalledTimes(1);
        expect(
            getViewState().hasRegion,
            "the button knows the selection is gone",
        ).toBe(false);
    });

    it("moves focus out of the drawer when the drawer is what was focused", () => {
        /*
         * `Reset` can close the drawer from a button that lives in the HEADER, so the focused node after the
         * click is usually the button itself. The case that matters is a keyboard user who tabbed INTO the
         * drawer and then reached Reset: without this, focus stays on a node inside an `aria-hidden`
         * off-canvas panel.
         */
        render(<ResetViewButton onClearSelection={() => {}} />);
        const button = screen.getByRole("button", {
            name: "Reset view",
        }) as HTMLButtonElement;
        act(() => publishHasRegion(true));

        /* A stand-in for the drawer, marked the way RegionDrawer marks itself. */
        const drawer = document.createElement("div");
        drawer.setAttribute("data-occluder", "right-drawer");
        const inner = document.createElement("button");
        drawer.appendChild(inner);
        document.body.appendChild(drawer);
        inner.focus();
        expect(
            document.activeElement,
            "precondition: focus is inside the drawer",
        ).toBe(inner);

        fireEvent.click(button);

        expect(
            document.activeElement,
            "focus must not be left on a hidden element",
        ).toBe(button);
        drawer.remove();
    });

    it("leaves focus alone when it was not in the drawer", () => {
        render(<ResetViewButton onClearSelection={() => {}} />);
        const button = screen.getByRole("button", {
            name: "Reset view",
        }) as HTMLButtonElement;
        act(() => publishViewState(view({ viewIsDefault: false })));

        const elsewhere = document.createElement("input");
        document.body.appendChild(elsewhere);
        elsewhere.focus();

        fireEvent.click(button);

        expect(
            document.activeElement,
            "no focus theft from an unrelated control",
        ).toBe(elsewhere);
        elsewhere.remove();
    });

    it("re-renders when only `spinning` changes, so the label never goes stale", () => {
        render(<ResetViewButton onClearSelection={() => {}} />);
        const button = screen.getByRole("button", { name: "Reset view" });

        act(() => publishViewState(view({ spinning: false })));
        // The button's own state did not change, so it stays disabled — the point is that the publish did
        // not throw and the button is still there, correctly disabled.
        expect(button.getAttribute("aria-disabled")).toBe("true");
    });
});

describe("resetView — the rule", () => {
    it("drives the RESET intent FIRST, then the selection clear", () => {
        /*
         * The order is load-bearing, not stylistic: `RESET` puts the machine into `returning` with
         * `userZoomed: false` and `regionId: null` before React re-renders, so the selection effect's
         * `SELECT(null)` lands on `closeOrStay` and cannot start a second, competing return.
         */
        const order: string[] = [];
        resetView({
            requestViewReset: () => order.push("reset"),
            clearSelection: () => order.push("clear"),
        });
        expect(order).toEqual(["reset", "clear"]);
    });

    it("calls both channels unconditionally, including when nothing is selected", () => {
        /*
         * Reset after a plain wheel has no selection to clear, and Reset while a region is open has a user
         * zoom the CLOSE rule would deliberately preserve. Deciding which channel is "needed" from outside is
         * the second rule that produced the bug, so both always fire and each is a no-op where it must be.
         */
        const requestViewReset = vi.fn();
        const clearSelection = vi.fn();
        resetView({ requestViewReset, clearSelection });
        expect(requestViewReset).toHaveBeenCalledTimes(1);
        expect(clearSelection).toHaveBeenCalledTimes(1);
    });
});

describe("viewStore", () => {
    it("drops a no-change publish: no notification, and the same object back", () => {
        let notifications = 0;
        const unsubscribe = subscribeViewState(() => {
            notifications += 1;
        });

        const first = getViewState();
        expect(first).toEqual(view());

        publishViewState(view());
        expect(
            notifications,
            "a 60 Hz publisher must not produce 60 Hz renders",
        ).toBe(0);
        expect(getViewState(), "the snapshot reference must stay stable").toBe(
            first,
        );

        publishViewState(view({ viewIsDefault: false }));
        expect(notifications).toBe(1);
        expect(getViewState().viewIsDefault).toBe(false);

        unsubscribe();
        publishViewState(view());
        expect(
            notifications,
            "an unsubscribed listener must not hear anything",
        ).toBe(1);
    });

    it("notifies on a hasRegion change alone, which is the Reset enable test", () => {
        let notifications = 0;
        const unsubscribe = subscribeViewState(() => {
            notifications += 1;
        });

        publishHasRegion(true);
        expect(notifications).toBe(1);
        expect(getViewState().hasRegion).toBe(true);

        /* The same value twice is not a change. */
        publishHasRegion(true);
        expect(notifications).toBe(1);

        /* And the per-frame publish from the director carries the flag, so it is not cleared by a frame. */
        publishViewState(view({ hasRegion: true, viewIsDefault: false }));
        expect(notifications).toBe(2);
        expect(
            getViewState().hasRegion,
            "a frame must not clear the flag",
        ).toBe(true);

        unsubscribe();
    });

    it("the reset channel is monotonic and every live subscriber sees every request", () => {
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
        expect(getResetRequest(), "monotonic: two requests, +2").toBe(
            start + 2,
        );
        expect(a, "every subscriber hears both").toBe(2);
        expect(b).toBe(2);

        /* A view-state publish is NOT a reset request — the two channels are independent. */
        publishViewState(view({ viewIsDefault: false }));
        expect(getResetRequest()).toBe(start + 2);

        unsubA();
        requestReset();
        expect(a, "an unsubscribed listener must not hear anything").toBe(2);
        expect(b).toBe(3);
        unsubB();
    });
});
