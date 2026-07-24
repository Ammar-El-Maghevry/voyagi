/**
 * Bounded shutdown watchdog.
 *
 * Nest's `enableShutdownHooks()` runs `OnApplicationShutdown` handlers (which
 * close the database pool) on SIGTERM/SIGINT, but waiting on `pool.end()` has no
 * hard deadline — a stuck close would hang the process indefinitely. This
 * watchdog arms a single bounded timer on the first termination signal and force
 * exits with a non-zero status if graceful shutdown overruns the deadline.
 *
 * It is deterministic and fully unit-testable: all side effects (signal
 * registration, timer, exit, logging) are injected. It logs only safe lifecycle
 * metadata (signal name, deadline) and never touches environment values or
 * credentials.
 */

/** Minimal timer handle — a subset of Node's `Timeout` we depend on. */
export interface TimerHandle {
  unref(): void;
}

export interface ShutdownWatchdogDeps {
  /** Register a one-shot-safe signal handler (e.g. `process.on`). */
  onSignal: (signal: NodeJS.Signals, handler: () => void) => void;
  /** Schedule the deadline timer (e.g. `setTimeout`). */
  setTimer: (handler: () => void, ms: number) => TimerHandle;
  /** Force process termination when the deadline is exceeded. */
  exit: (code: number) => void;
  /** Safe, structured lifecycle logger — must never receive secret values. */
  log: (message: string) => void;
}

/** Signals that begin a graceful shutdown. */
export const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = [
  'SIGTERM',
  'SIGINT',
];

/**
 * Install the watchdog. Returns a handle exposing whether it has armed (useful
 * for tests). Registers exactly one handler per signal and arms at most one
 * deadline timer regardless of how many signals arrive.
 */
export function installShutdownWatchdog(
  timeoutMs: number,
  deps: ShutdownWatchdogDeps,
  signals: readonly NodeJS.Signals[] = SHUTDOWN_SIGNALS,
): { readonly armed: () => boolean } {
  let armed = false;

  const arm = (signal: NodeJS.Signals): void => {
    // Dedupe: a second signal must not start a second timer.
    if (armed) return;
    armed = true;
    deps.log(
      `Received ${signal}; graceful shutdown started (deadline ${timeoutMs}ms).`,
    );
    const timer = deps.setTimer(() => {
      deps.log(`Graceful shutdown exceeded ${timeoutMs}ms; forcing exit.`);
      deps.exit(1);
    }, timeoutMs);
    // Do not let the deadline timer itself keep the event loop alive: a clean
    // shutdown that closes every handle exits naturally before it fires. The
    // timer only fires when something else is still holding the loop open.
    timer.unref();
  };

  for (const signal of signals) {
    deps.onSignal(signal, () => arm(signal));
  }

  return { armed: () => armed };
}
