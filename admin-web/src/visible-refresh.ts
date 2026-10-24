/** UI scheduling only; booking permissions and rules remain on the API. */
export interface VisibilityHost {
  isVisible(): boolean;
  subscribe(listener: () => void): () => void;
  schedule(callback: () => void, milliseconds: number): number;
  cancel(handle: number): void;
}

export function startVisibleRefresh(
  refresh: () => Promise<void>,
  host: VisibilityHost,
  intervalMilliseconds = 5000,
): () => void {
  let stopped = false;
  let running = false;
  let queued = false;
  let timer: number | undefined;
  function clearTimer() {
    if (timer !== undefined) host.cancel(timer);
    timer = undefined;
  }
  function schedule() {
    if (!stopped && host.isVisible()) timer = host.schedule(() => void run(), intervalMilliseconds);
  }
  async function run() {
    if (stopped || !host.isVisible()) return;
    if (running) { queued = true; return; }
    running = true;
    clearTimer();
    try { await refresh(); }
    catch { /* The caller presents request errors; a later refresh can recover. */ }
    finally {
      running = false;
      if (!stopped && host.isVisible()) {
        if (queued) { queued = false; void run(); }
        else schedule();
      }
    }
  }
  const unsubscribe = host.subscribe(() => {
    clearTimer();
    if (host.isVisible()) void run();
    else queued = false;
  });
  schedule();
  return () => { stopped = true; queued = false; clearTimer(); unsubscribe(); };
}

/** A late response may update only its original account's latest active request. */
export function createLatestRequest(owner: () => string | undefined) {
  let version = 0;
  let stopped = false;
  return {
    begin() {
      const requestVersion = ++version;
      const account = owner();
      return () => !stopped && !!account && owner() === account && requestVersion === version;
    },
    invalidate() { version++; },
    stop() { stopped = true; version++; },
  };
}
