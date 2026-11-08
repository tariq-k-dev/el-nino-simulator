/**
 * Screenshot capture for the WebGL canvas.
 *
 * `canvas.toDataURL()` on a WebGL context returns an EMPTY (black) image unless
 * `preserveDrawingBuffer: true`, because the browser is free to clear the
 * drawing buffer once a frame is composited. Leaving preserveDrawingBuffer on
 * permanently costs real frame time, so instead we keep a handle to the live
 * renderer and force one render immediately before reading the buffer — the
 * read then happens in the same task, before the compositor clears it.
 */

interface RendererHandle {
    render: () => void;
    domElement: HTMLCanvasElement;
}

let handle: RendererHandle | null = null;

export function registerRenderer(next: RendererHandle | null): void {
    handle = next;
}

/**
 * Returns the live WebGL canvas element, after forcing one render into the
 * drawing buffer.
 *
 * Used by the snapshot composer, which needs to `drawImage` the frame into a
 * larger offscreen canvas rather than read it as a data URL. Same
 * `preserveDrawingBuffer` caveat as `captureCanvas`: the render must happen in
 * the same task as the read, or the compositor clears the buffer first.
 */
export function captureCanvasElement(): HTMLCanvasElement | null {
    if (!handle) {
        return document.querySelector<HTMLCanvasElement>(
            "#globe-canvas canvas",
        );
    }
    try {
        handle.render();
        return handle.domElement;
    } catch {
        return null;
    }
}

export function captureCanvas(type = "image/png"): string | null {
    if (!handle) {
        // Fall back to the selector in case the handle was never registered.
        const canvas = document.querySelector<HTMLCanvasElement>(
            "#globe-canvas canvas",
        );
        if (!canvas) return null;
        try {
            return canvas.toDataURL(type);
        } catch {
            return null;
        }
    }

    try {
        // Force a draw into the drawing buffer, then read it in the same task.
        handle.render();
        return handle.domElement.toDataURL(type);
    } catch {
        return null;
    }
}
