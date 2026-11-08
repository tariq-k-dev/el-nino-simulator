import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureCanvas, registerRenderer } from "./canvasCapture";

describe("canvasCapture", () => {
    beforeEach(() => {
        registerRenderer(null);
        document.body.innerHTML = "";
    });

    it("returns null when no renderer is registered and no canvas exists", () => {
        expect(captureCanvas()).toBeNull();
    });

    it("falls back to document.querySelector when no renderer is registered", () => {
        const mockCanvas = document.createElement("canvas");
        mockCanvas.id = "globe-canvas";
        document.body.appendChild(mockCanvas);

        const mockDataURL = "data:image/png;base64,test";
        const toDataURLSpy = vi.spyOn(mockCanvas, "toDataURL").mockReturnValue(mockDataURL);

        expect(captureCanvas()).toBe(mockDataURL);
        expect(toDataURLSpy).toHaveBeenCalledWith("image/png");

        toDataURLSpy.mockRestore();
    });

    it("uses registered renderer and calls render() before toDataURL", () => {
        const mockRender = vi.fn();
        const mockCanvas = {
            render: mockRender,
            domElement: document.createElement("canvas"),
        };
        const mockDataURL = "data:image/png;base64,test";
        const toDataURLSpy = vi.spyOn(mockCanvas.domElement, "toDataURL").mockReturnValue(mockDataURL);

        registerRenderer(mockRender);
        expect(captureCanvas()).toBe(mockDataURL);
        expect(mockRender).toHaveBeenCalledOnce();
        expect(toDataURLSpy).toHaveBeenCalledWith("image/png");

        toDataURLSpy.mockRestore();
    });

    it("returns null gracefully when toDataURL throws", () => {
        // Test with registered renderer
        const mockRender = vi.fn();
        const mockCanvas = {
            render: mockRender,
            domElement: document.createElement("canvas"),
        };
        vi.spyOn(mockCanvas.domElement, "toDataURL").mockImplementation(() => {
            throw new DOMException("Security error");
        });
        registerRenderer(mockRender);
        expect(captureCanvas()).toBeNull();

        // Test with fallback canvas
        const fallbackCanvas = document.createElement("canvas");
        fallbackCanvas.id = "globe-canvas";
        document.body.appendChild(fallbackCanvas);
        vi.spyOn(fallbackCanvas, "toDataURL").mockImplementation(() => {
            throw new Error("Test error");
        });
        registerRenderer(null);
        expect(captureCanvas()).toBeNull();
    });
});
