/**
 * Circuit breaker for Viam Data API calls.
 *
 * Prevents cascading failures when Viam Cloud is slow or rate-limited.
 * Three states: CLOSED (normal), OPEN (failing, reject fast), HALF_OPEN (testing recovery).
 *
 * Usage:
 *   const result = await viamBreaker.call(() => exportTabularData(...));
 */

type BreakerState = "closed" | "open" | "half_open";

interface BreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMax: number;
}

const DEFAULT_OPTS: BreakerOptions = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMax: 2,
};

class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;
  private opts: BreakerOptions;

  constructor(opts?: Partial<BreakerOptions>) {
    this.opts = { ...DEFAULT_OPTS, ...opts };
  }

  get isOpen(): boolean {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.opts.resetTimeoutMs) {
        this.state = "half_open";
        this.halfOpenAttempts = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  get status(): { state: BreakerState; failures: number } {
    // Trigger state transition check
    const _open = this.isOpen;
    return { state: this.state, failures: this.failures };
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen) {
      throw new Error(
        `Viam API circuit breaker is OPEN (${this.failures} failures). ` +
        `Will retry in ${Math.ceil((this.opts.resetTimeoutMs - (Date.now() - this.lastFailureTime)) / 1000)}s.`
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
    this.halfOpenAttempts = 0;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === "half_open") {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.opts.halfOpenMax) {
        this.state = "open";
      }
    } else if (this.failures >= this.opts.failureThreshold) {
      this.state = "open";
    }
  }

  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.halfOpenAttempts = 0;
  }
}

/** Singleton breaker for all Viam Data API calls. */
export const viamBreaker = new CircuitBreaker();
