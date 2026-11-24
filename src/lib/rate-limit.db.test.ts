import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";

import { consumeRateLimit, purgeRateLimitBuckets, rateLimitKey } from "./rate-limit";

describe.skipIf(!testDatabaseUrl)("rate limit en PostgreSQL (DECISIONS A16)", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  const rule = { scope: "test", limit: 3, windowMs: 60_000 };
  const t0 = new Date("2026-11-24T10:00:00Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);

  beforeEach(() => truncateAll(prisma));
  afterAll(() => prisma.$disconnect());

  it("permite hasta el límite dentro de la ventana y luego indica cuánto esperar", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await consumeRateLimit(rule, "1.2.3.4", prisma, at(i * 1000))).toEqual({
        allowed: true,
      });
    }
    expect(await consumeRateLimit(rule, "1.2.3.4", prisma, at(10_000))).toEqual({
      allowed: false,
      retryAfterSeconds: 50,
    });
  });

  it("empieza una ventana nueva cuando termina la anterior", async () => {
    for (let i = 0; i < 4; i++) await consumeRateLimit(rule, "1.2.3.4", prisma, t0);
    expect(await consumeRateLimit(rule, "1.2.3.4", prisma, at(60_000))).toEqual({
      allowed: true,
    });
  });

  it("separa identificadores y alcances, y no guarda el identificador en claro", async () => {
    for (let i = 0; i < 3; i++) await consumeRateLimit(rule, "1.2.3.4", prisma, t0);
    expect((await consumeRateLimit(rule, "5.6.7.8", prisma, t0)).allowed).toBe(true);
    expect(
      (await consumeRateLimit({ ...rule, scope: "otro" }, "1.2.3.4", prisma, t0)).allowed,
    ).toBe(true);
    const keys = (await prisma.rateLimitBucket.findMany()).map((b) => b.key);
    expect(keys).toContain(rateLimitKey("test", "1.2.3.4"));
    expect(keys.join()).not.toContain("1.2.3.4");
  });

  it("es atómico con solicitudes simultáneas", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit(rule, "ana@example.com", prisma, t0)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });

  it("purga los contadores viejos", async () => {
    await consumeRateLimit(rule, "a", prisma, t0);
    await consumeRateLimit(rule, "b", prisma, at(2 * 24 * 3600_000));
    expect(await purgeRateLimitBuckets(24 * 3600_000, prisma, at(2 * 24 * 3600_000))).toBe(1);
    expect(await prisma.rateLimitBucket.count()).toBe(1);
  });
});
