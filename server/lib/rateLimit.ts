import type express from "express";
import type { PlatformStorage } from "./storage/index.js";

export function fixedWindowRateLimit(args: {
  namespace?: string;
  windowMs: number;
  limit: number;
  key?: (request: express.Request) => string;
  maxEntries?: number;
  store?: PlatformStorage;
}): express.RequestHandler {
  const counters = new Map<string, { windowStart: number; count: number }>();
  return (request, response, next) => {
    const now = Date.now();
    for (const [entryKey, entry] of counters) {
      if (now - entry.windowStart >= args.windowMs) counters.delete(entryKey);
    }
    const rawKey = args.key?.(request) ?? request.ip ?? "unknown";
    const key = `${args.namespace ?? "default"}:${rawKey}`;
    const entry =
      args.store?.consumeRateLimit?.(key, args.windowMs, now) ??
      (() => {
        const current = counters.get(key);
        const value =
          !current || now - current.windowStart >= args.windowMs
            ? { windowStart: now, count: 1 }
            : { ...current, count: current.count + 1 };
        counters.set(key, value);
        return value;
      })();
    const maxEntries = args.maxEntries ?? 10_000;
    if (counters.size > maxEntries) {
      const oldest = [...counters.entries()]
        .sort((left, right) => left[1].windowStart - right[1].windowStart)
        .slice(0, counters.size - maxEntries);
      for (const [oldestKey] of oldest) counters.delete(oldestKey);
    }
    response.setHeader("RateLimit-Limit", String(args.limit));
    response.setHeader(
      "RateLimit-Remaining",
      String(Math.max(0, args.limit - entry.count)),
    );
    if (entry.count > args.limit) {
      response.setHeader(
        "Retry-After",
        String(Math.ceil((entry.windowStart + args.windowMs - now) / 1000)),
      );
      response.status(429).json({ error: "Rate limit exceeded." });
      return;
    }
    next();
  };
}
