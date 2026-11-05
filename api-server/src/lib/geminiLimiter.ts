// Paces Gemini calls so that only the AI step is limited, not the whole lead pipeline.
// Crawling a site is plain HTTP and can run in parallel; only generateContent needs the quota.
// Free-tier Google AI Studio keys allow about 10 requests/minute for gemini-2.5-flash, so
// calls are spaced out instead of hitting 429 and backing off.

const REQUESTS_PER_MINUTE = Math.max(1, Number(process.env.GEMINI_REQUESTS_PER_MINUTE ?? 10));
const MAX_IN_FLIGHT = Math.max(1, Number(process.env.GEMINI_CONCURRENCY ?? 2));
const MIN_START_INTERVAL_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE);

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort: () => void;
}

const waiters: Waiter[] = [];
let inFlight = 0;
let nextStartAt = 0;
let wakeTimer: NodeJS.Timeout | null = null;

function drain(): void {
  while (waiters.length > 0 && inFlight < MAX_IN_FLIGHT) {
    const wait = nextStartAt - Date.now();
    if (wait > 0) {
      wakeTimer ??= setTimeout(() => {
        wakeTimer = null;
        drain();
      }, wait);
      return;
    }
    const waiter = waiters.shift()!;
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    nextStartAt = Date.now() + MIN_START_INTERVAL_MS;
    inFlight++;
    waiter.resolve();
  }
}

function acquire(signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Qualification cancelled"));
      return;
    }
    const waiter: Waiter = {
      resolve,
      reject,
      signal,
      onAbort: () => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error("Qualification cancelled"));
      },
    };
    signal?.addEventListener("abort", waiter.onAbort, { once: true });
    waiters.push(waiter);
    drain();
  });
}

/** Runs one Gemini request once a concurrency slot is free and the pacing interval has passed. */
export async function runGeminiCall<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  await acquire(signal);
  try {
    return await task();
  } finally {
    inFlight--;
    drain();
  }
}
