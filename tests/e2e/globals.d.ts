/**
 * Page-side globals installed by addInitScript and read back via page.evaluate.
 * Declared here so the specs typecheck without `any` casts.
 */
declare global {
  interface Window {
    /** Long-task durations collected by the PerformanceObserver in case b. */
    __LT: number[];
    /** Body MutationObserver counter used by case h. */
    __MUT: number;
  }
}

export {};
