import type { TelemetryBundle } from "@/types/enso"

const WORKER_URL =
  (import.meta.env.VITE_TELEMETRY_WORKER_URL as string | undefined)?.trim() ||
  "http://localhost:8787"

let cachedBundle: TelemetryBundle | null = null
let inFlightPromise: Promise<TelemetryBundle | null> | null = null

/**
 * Fetches the combined telemetry bundle from the Cloudflare Worker.
 * Gracefully falls back to null if the worker dev server is offline.
 */
export async function fetchTelemetryBundle(
  forceRefresh = false,
): Promise<TelemetryBundle | null> {
  if (cachedBundle && !forceRefresh) {
    return cachedBundle
  }

  if (inFlightPromise && !forceRefresh) {
    return inFlightPromise
  }

  inFlightPromise = (async () => {
    try {
      const url = `${WORKER_URL}/api/telemetry/bundle${forceRefresh ? "?refresh=true" : ""}`
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      })

      if (!response.ok) {
        console.warn(`[telemetry] Worker returned status: ${response.status}`)
        return null
      }

      const bundle = (await response.json()) as TelemetryBundle
      cachedBundle = bundle
      return bundle
    } catch (err) {
      console.warn(
        "[telemetry] Live telemetry worker offline or unreachable; using static fallback.",
        err,
      )
      return null
    } finally {
      inFlightPromise = null
    }
  })()

  return inFlightPromise
}
