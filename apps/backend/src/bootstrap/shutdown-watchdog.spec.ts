import {
  installShutdownWatchdog,
  SHUTDOWN_SIGNALS,
  type ShutdownWatchdogDeps,
  type TimerHandle,
} from './shutdown-watchdog';

/**
 * Deterministic tests for the bounded shutdown watchdog. All side effects are
 * injected, so no real timers, signals or process exit occur.
 */
describe('installShutdownWatchdog', () => {
  function harness(timeoutMs = 15000) {
    const handlers = new Map<NodeJS.Signals, () => void>();
    let timerFn: (() => void) | null = null;
    let timerMs: number | null = null;
    const unref = jest.fn();
    const exit = jest.fn();
    const log = jest.fn();

    const deps: ShutdownWatchdogDeps = {
      onSignal: (signal, handler) => handlers.set(signal, handler),
      setTimer: (fn, ms): TimerHandle => {
        timerFn = fn;
        timerMs = ms;
        return { unref };
      },
      exit,
      log,
    };

    const api = installShutdownWatchdog(timeoutMs, deps);
    return {
      api,
      exit,
      log,
      unref,
      raise: (signal: NodeJS.Signals) => handlers.get(signal)?.(),
      fireTimer: () => timerFn?.(),
      timerMs: () => timerMs,
      handlerCount: () => handlers.size,
    };
  }

  it('registers exactly one handler per shutdown signal', () => {
    const h = harness();
    expect(h.handlerCount()).toBe(SHUTDOWN_SIGNALS.length);
    expect(h.api.armed()).toBe(false);
  });

  it('does not exit when shutdown completes before the deadline', () => {
    const h = harness();
    h.raise('SIGTERM');
    expect(h.api.armed()).toBe(true);
    // A clean shutdown never fires the (unref'd) timer.
    expect(h.exit).not.toHaveBeenCalled();
    expect(h.unref).toHaveBeenCalledTimes(1); // timer does not keep loop alive
  });

  it('force-exits with a non-zero status when the deadline is exceeded', () => {
    const h = harness(15000);
    h.raise('SIGTERM');
    expect(h.timerMs()).toBe(15000);
    h.fireTimer(); // simulate a hanging shutdown reaching the deadline
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it('arms at most one deadline timer across repeated signals', () => {
    const h = harness();
    const setTimer = jest.fn();
    // Re-install with a counting timer to assert single arming.
    const handlers = new Map<NodeJS.Signals, () => void>();
    const api = installShutdownWatchdog(15000, {
      onSignal: (s, handler) => handlers.set(s, handler),
      setTimer: (fn, ms) => {
        setTimer(fn, ms);
        return { unref: jest.fn() };
      },
      exit: jest.fn(),
      log: jest.fn(),
    });
    handlers.get('SIGTERM')?.();
    handlers.get('SIGINT')?.();
    handlers.get('SIGTERM')?.();
    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(api.armed()).toBe(true);
    void h;
  });

  it('logs only safe lifecycle metadata (signal + deadline), no secrets', () => {
    const h = harness(20000);
    h.raise('SIGINT');
    h.fireTimer();
    const output = h.log.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('SIGINT');
    expect(output).toContain('20000');
    expect(output).toMatch(/forcing exit/);
    // No environment values or credentials.
    expect(output).not.toMatch(/postgres|password|DATABASE_URL|@/i);
  });
});
