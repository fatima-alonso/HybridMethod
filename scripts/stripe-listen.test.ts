import { describe, expect, it } from "vitest";

import { parsePort, readEnvValue, upsertEnvValue } from "./stripe-listen";

describe("npm run stripe:listen (DECISIONS A30)", () => {
  const env = [
    "DATABASE_URL=postgresql://localhost/hm",
    "STRIPE_SECRET_KEY=sk_test_123",
    'STRIPE_WEBHOOK_SECRET="whsec_viejo"',
    "STRIPE_WEBHOOK_SECRET=whsec_repetido",
    "",
  ].join("\n");

  it("lee el último valor de una variable, sin comillas", () => {
    expect(readEnvValue(env, "STRIPE_SECRET_KEY")).toBe("sk_test_123");
    expect(readEnvValue(env, "STRIPE_WEBHOOK_SECRET")).toBe("whsec_repetido");
    expect(readEnvValue(env, "NO_EXISTE")).toBeUndefined();
  });

  it("deja una sola línea con el secreto nuevo y conserva las demás", () => {
    const updated = upsertEnvValue(env, "STRIPE_WEBHOOK_SECRET", "whsec_nuevo");
    expect(updated.match(/STRIPE_WEBHOOK_SECRET=/g)).toHaveLength(1);
    expect(readEnvValue(updated, "STRIPE_WEBHOOK_SECRET")).toBe("whsec_nuevo");
    expect(updated).toContain("DATABASE_URL=postgresql://localhost/hm\n");
    expect(updated.endsWith("whsec_nuevo\n")).toBe(true);
    // Funciona también con saltos de línea de Windows.
    const crlf = upsertEnvValue("A=1\r\nSTRIPE_WEBHOOK_SECRET=x\r\n", "STRIPE_WEBHOOK_SECRET", "y");
    expect(crlf).toBe("A=1\nSTRIPE_WEBHOOK_SECRET=y\n");
  });

  it("usa el puerto 3000 por defecto, o el de --port", () => {
    expect(parsePort([])).toBe(3000);
    expect(parsePort(["--port", "3001"])).toBe(3001);
    expect(() => parsePort(["--port", "abc"])).toThrow();
  });
});
