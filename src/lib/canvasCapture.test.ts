// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureCanvas, registerRenderer } from "./canvasCapture";

describe("canvasCapture", () => {
    beforeEach(() => {
        registerRenderer(null);
        document.body.innerHTML = "";
    });

    it("returns null when no renderer is registered and no canvas exists in DOM", () => {
        expect(captureCanvas()).toBeNull();
    });

    it("falls back to document.querySelector('#globe-canvas canvas') when no renderer is registered", () => {
        const container = document.createElement("div");
        container.id = "globe-canvas";
        const canvas = document.createElement("canvas");
        container.appendChild(canvas);
        document.body.appendChild(container);

        const mockDataURL = "data:image/png;base64,fallbackMock";
        const toDataURLSpy = vi.spyOn(canvas, "toDataURL").mockReturnValue(mockDataURL);

        expect(captureCanvas()).toBe(mockDataURL);
        expect(toDataURLSpy).toHaveBeenCalledWith("image/png");
    });

    it("uses registered renderer handle and calls render() synchronously before reading toDataURL", () => {
        const mockRender = vi.fn();
        const domElement = document.createElement("canvas");
        const mockDataURL = "data:image/png;base64,renderedMock";
        const toDataURLSpy = vi.spyOn(domElement, "toDataURL").mockReturnValue(mockDataURL);

        registerRenderer({
            render: mockRender,
            domElement,
        });

        expect(captureCanvas()).toBe(mockDataURL);
        expect(mockRender).toHaveBeenCalledTimes(1);
        expect(toDataURLSpy).toHaveBeenCalledWith("image/png");
    });

    it("returns null gracefully when toDataURL throws DOMException or error", () => {
        const mockRender = vi.fn();
        const domElement = document.createElement("canvas");
        vi.spyOn(domElement, "toDataURL").mockImplementation(() => {
            throw new DOMException("SecurityError");
        });

        registerRenderer({
            render: mockRender,
            domElement,
        });

        expect(captureCanvas()).toBeNull();
    });
});
