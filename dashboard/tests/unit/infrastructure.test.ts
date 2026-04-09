/**
 * Infrastructure Module Tests
 *
 * Tests the rate limiter, circuit breaker, and idempotency store
 * that protect the platform from abuse and cascading failures.
 *
 * These are pure in-memory state machines — no mocks needed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";
import { viamBreaker } from "@/lib/viam-circuit-breaker";
import { checkIdempotency, saveIdempotency } from "@/lib/idempotency";
import { withRetry } from "@/lib/supabase";
import { validateSQL } from "@/lib/report-validate";

// ── Rate Limiter ───────────────────────────────────────────────────

describe("createRateLimiter", () => {
  it("allows requests within the limit", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });

    for (let i = 0; i < 5; i++) {
      const result = limiter.check("user1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  it("blocks requests over the limit", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });

    limiter.check("user1"); // 1
    limiter.check("user1"); // 2
    limiter.check("user1"); // 3

    const result = limiter.check("user1"); // 4 — should be blocked
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks separate windows per key", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });

    limiter.check("user1");
    limiter.check("user1");
    expect(limiter.check("user1").allowed).toBe(false);

    // user2 should have its own window
    expect(limiter.check("user2").allowed).toBe(true);
  });

  it("resets after window expires", () => {
    vi.useFakeTimers();

    const limiter = createRateLimiter({ windowMs: 1000, max: 2 });

    limiter.check("user1");
    limiter.check("user1");
    expect(limiter.check("user1").allowed).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(1100);

    expect(limiter.check("user1").allowed).toBe(true);

    vi.useRealTimers();
  });

  it("reset() clears a specific key", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });

    limiter.check("user1");
    expect(limiter.check("user1").allowed).toBe(false);

    limiter.reset("user1");
    expect(limiter.check("user1").allowed).toBe(true);
  });
});

// ── Circuit Breaker ────────────────────────────────────────────────

describe("viamBreaker (Circuit Breaker)", () => {
  beforeEach(() => {
    viamBreaker.reset();
  });

  it("starts in closed state", () => {
    expect(viamBreaker.status.state).toBe("closed");
    expect(viamBreaker.status.failures).toBe(0);
  });

  it("passes through successful calls", async () => {
    const result = await viamBreaker.call(() => Promise.resolve(42));
    expect(result).toBe(42);
    expect(viamBreaker.status.state).toBe("closed");
  });

  it("counts failures", async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await viamBreaker.call(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
    }
    expect(viamBreaker.status.failures).toBe(3);
    expect(viamBreaker.status.state).toBe("closed"); // not yet at threshold (5)
  });

  it("opens after 5 failures", async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await viamBreaker.call(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
    }
    expect(viamBreaker.status.state).toBe("open");
  });

  it("rejects immediately when open", async () => {
    // Force open
    for (let i = 0; i < 5; i++) {
      try {
        await viamBreaker.call(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
    }

    await expect(
      viamBreaker.call(() => Promise.resolve("should not run")),
    ).rejects.toThrow("circuit breaker is OPEN");
  });

  it("transitions to half-open after timeout", async () => {
    vi.useFakeTimers();

    for (let i = 0; i < 5; i++) {
      try {
        await viamBreaker.call(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
    }
    expect(viamBreaker.status.state).toBe("open");

    // Advance past reset timeout (30s)
    vi.advanceTimersByTime(31_000);

    // The next status check triggers the transition
    expect(viamBreaker.status.state).toBe("half_open");

    vi.useRealTimers();
  });

  it("resets to closed on success after half-open", async () => {
    vi.useFakeTimers();

    for (let i = 0; i < 5; i++) {
      try {
        await viamBreaker.call(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
    }

    vi.advanceTimersByTime(31_000);

    // Successful call in half-open state should close the breaker
    const result = await viamBreaker.call(() => Promise.resolve("recovered"));
    expect(result).toBe("recovered");
    expect(viamBreaker.status.state).toBe("closed");

    vi.useRealTimers();
  });

  it("reset() restores to clean state", async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await viamBreaker.call(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
    }
    expect(viamBreaker.status.state).toBe("open");

    viamBreaker.reset();
    expect(viamBreaker.status.state).toBe("closed");
    expect(viamBreaker.status.failures).toBe(0);
  });
});

// ── Idempotency Store ──────────────────────────────────────────────

describe("Idempotency Store", () => {
  it("returns null for unknown keys", () => {
    expect(checkIdempotency("unknown-key-12345")).toBeNull();
  });

  it("returns cached response for known keys", () => {
    const key = `test-${Date.now()}`;
    saveIdempotency(key, { status: 200, body: { id: 1 } });

    const cached = checkIdempotency(key);
    expect(cached).not.toBeNull();
    expect(cached!.status).toBe(200);
    expect(cached!.body).toEqual({ id: 1 });
  });

  it("expires after TTL (5 minutes)", () => {
    vi.useFakeTimers();

    const key = `ttl-test-${Date.now()}`;
    saveIdempotency(key, { status: 201, body: { ok: true } });
    expect(checkIdempotency(key)).not.toBeNull();

    // Advance past TTL
    vi.advanceTimersByTime(6 * 60 * 1000);

    expect(checkIdempotency(key)).toBeNull();

    vi.useRealTimers();
  });

  it("different keys are independent", () => {
    const key1 = `key1-${Date.now()}`;
    const key2 = `key2-${Date.now()}`;

    saveIdempotency(key1, { status: 200, body: "a" });
    saveIdempotency(key2, { status: 201, body: "b" });

    expect(checkIdempotency(key1)!.body).toBe("a");
    expect(checkIdempotency(key2)!.body).toBe("b");
  });
});

// ── Supabase Retry Wrapper ─────────────────────────────────────────

describe("withRetry()", () => {
  it("returns data on first success without retrying", async () => {
    const result = await withRetry(() =>
      Promise.resolve({ data: [{ id: 1 }], error: null }),
    );
    expect(result.data).toEqual([{ id: 1 }]);
    expect(result.error).toBeNull();
  });

  it("does not retry on client errors (4xx)", async () => {
    let callCount = 0;
    const result = await withRetry(() => {
      callCount++;
      return Promise.resolve({
        data: null as unknown as never[],
        error: { message: "Not found", code: "404" },
      });
    }, { maxRetries: 3, baseDelayMs: 10 });

    expect(callCount).toBe(1);
    expect(result.error).not.toBeNull();
  });

  it("retries on server errors and succeeds", async () => {
    let callCount = 0;
    const result = await withRetry(() => {
      callCount++;
      if (callCount < 3) {
        return Promise.resolve({
          data: null as unknown as string,
          error: { message: "Server error", code: "500" },
        });
      }
      return Promise.resolve({ data: "recovered", error: null });
    }, { maxRetries: 3, baseDelayMs: 10 });

    expect(callCount).toBe(3);
    expect(result.data).toBe("recovered");
    expect(result.error).toBeNull();
  });

  it("gives up after maxRetries", async () => {
    let callCount = 0;
    const result = await withRetry(() => {
      callCount++;
      return Promise.resolve({
        data: null as unknown as never[],
        error: { message: "Server error", code: "500" },
      });
    }, { maxRetries: 2, baseDelayMs: 10 });

    expect(callCount).toBe(3); // initial + 2 retries
    expect(result.error!.message).toBe("Server error");
  });
});

// ── SQL Validator: Token-Aware Parsing ─────────────────────────────

describe("validateSQL: token-aware string stripping", () => {
  it("allows keywords inside string literals", () => {
    expect(validateSQL("SELECT * FROM orders WHERE note = 'please delete this'").valid).toBe(true);
    expect(validateSQL("SELECT * FROM orders WHERE name = 'drop zone'").valid).toBe(true);
    expect(validateSQL("SELECT * FROM orders WHERE msg = 'insert coin'").valid).toBe(true);
  });

  it("still blocks actual keyword usage outside strings", () => {
    expect(validateSQL("SELECT 1; DELETE FROM orders").valid).toBe(false);
    expect(validateSQL("DROP TABLE customers").valid).toBe(false);
  });

  it("limits query complexity (max 10 SELECTs)", () => {
    const nested = Array(11).fill("SELECT 1 FROM (").join("") + "SELECT 1" + ")".repeat(11);
    expect(validateSQL(nested).valid).toBe(false);
  });

  it("allows reasonable CTE complexity", () => {
    const cte = `WITH a AS (SELECT 1), b AS (SELECT 2), c AS (SELECT 3)
      SELECT * FROM a JOIN b ON 1=1 JOIN c ON 1=1`;
    expect(validateSQL(cte).valid).toBe(true);
  });
});
