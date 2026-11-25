import { describe, expect, it } from "vitest";

import { ConfigError, getDatabaseUrl, getWhatsAppNumber, parseConfig } from "./config";

const validProductionEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@host.neon.tech/db?sslmode=verify-full",
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_123",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_123",
  RESEND_API_KEY: "re_123",
  RESEND_FROM_EMAIL: "THE HYBRID METHOD <hola@example.com>",
  FERRO_NOTIFICATION_EMAIL: "ferro@example.com",
  FERRO_WHATSAPP_NUMBER: "5215512345678",
  APP_URL: "https://thehybridmethod.example/",
  FERRO_APPROVAL_PIN_HASH: "$2b$12$" + "a".repeat(53),
  OTP_SESSION_SECRET: "x".repeat(32),
  TRANSFER_LINK_TTL_DAYS: "7",
};

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("se esperaba un ConfigError");
}

describe("parseConfig en desarrollo", () => {
  it("arranca sin ninguna variable y aplica valores por defecto", () => {
    const config = parseConfig({ NODE_ENV: "development" });

    expect(config.environment).toBe("development");
    expect(config.isProduction).toBe(false);
    expect(config.APP_URL).toBe("http://localhost:3000");
    expect(config.TRANSFER_LINK_TTL_DAYS).toBe(7);
    expect(config.RESEND_API_KEY).toBeUndefined();
    expect(config.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("trata las variables vacías como no definidas (como en .env.example)", () => {
    const config = parseConfig({
      NODE_ENV: "development",
      RESEND_API_KEY: "",
      APP_URL: "",
      TRANSFER_LINK_TTL_DAYS: "",
    });

    expect(config.RESEND_API_KEY).toBeUndefined();
    expect(config.APP_URL).toBe("http://localhost:3000");
    expect(config.TRANSFER_LINK_TTL_DAYS).toBe(7);
  });

  it("trata un NODE_ENV desconocido o ausente como desarrollo", () => {
    expect(parseConfig({}).environment).toBe("development");
    expect(parseConfig({ NODE_ENV: "staging" }).environment).toBe("development");
    expect(parseConfig({ NODE_ENV: "test" }).environment).toBe("test");
  });

  it("valida el formato de las variables que sí están definidas", () => {
    const issues = issuesOf(() =>
      parseConfig({
        NODE_ENV: "development",
        STRIPE_SECRET_KEY: "pk_test_equivocada",
        FERRO_WHATSAPP_NUMBER: "+52 55 1234 5678",
        OTP_SESSION_SECRET: "corto",
      }),
    );

    expect(issues).toHaveLength(3);
    expect(issues.join("\n")).toMatch(/STRIPE_SECRET_KEY/);
    expect(issues.join("\n")).toMatch(/FERRO_WHATSAPP_NUMBER/);
    expect(issues.join("\n")).toMatch(/OTP_SESSION_SECRET/);
  });
});

describe("parseConfig en producción", () => {
  it("acepta una configuración completa y normaliza APP_URL", () => {
    const config = parseConfig(validProductionEnv);

    expect(config.isProduction).toBe(true);
    expect(config.APP_URL).toBe("https://thehybridmethod.example");
    expect(config.TRANSFER_LINK_TTL_DAYS).toBe(7);
  });

  it("aplica TRANSFER_LINK_TTL_DAYS=7 por defecto y respeta un valor configurado", () => {
    const { TRANSFER_LINK_TTL_DAYS: _omit, ...withoutTtl } = validProductionEnv;
    expect(parseConfig(withoutTtl).TRANSFER_LINK_TTL_DAYS).toBe(7);
    expect(
      parseConfig({ ...validProductionEnv, TRANSFER_LINK_TTL_DAYS: "3" }).TRANSFER_LINK_TTL_DAYS,
    ).toBe(3);
  });

  it("exige todas las variables obligatorias", () => {
    const issues = issuesOf(() => parseConfig({ NODE_ENV: "production" }));
    const required = Object.keys(validProductionEnv).filter(
      (key) => key !== "NODE_ENV" && key !== "TRANSFER_LINK_TTL_DAYS",
    );

    expect(issues).toHaveLength(required.length);
    for (const key of required) {
      expect(issues).toContain(`${key}: es obligatoria`);
    }
  });

  it("considera faltante una variable vacía", () => {
    const issues = issuesOf(() => parseConfig({ ...validProductionEnv, OTP_SESSION_SECRET: "" }));
    expect(issues).toEqual(["OTP_SESSION_SECRET: es obligatoria"]);
  });

  it.each([
    ["DATABASE_URL", "mysql://localhost/db"],
    ["STRIPE_WEBHOOK_SECRET", "sk_test_123"],
    ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "sk_test_123"],
    ["FERRO_NOTIFICATION_EMAIL", "no-es-un-correo"],
    ["APP_URL", "ftp://example.com"],
    ["FERRO_APPROVAL_PIN_HASH", "123456"],
    ["TRANSFER_LINK_TTL_DAYS", "0"],
    ["TRANSFER_LINK_TTL_DAYS", "siete"],
  ])("rechaza %s con un formato inválido", (key, value) => {
    const issues = issuesOf(() => parseConfig({ ...validProductionEnv, [key]: value }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(new RegExp(`^${key}:`));
  });

  it("rechaza un hash argon2 como FERRO_APPROVAL_PIN_HASH (solo se verifica bcrypt, A23)", () => {
    const issues = issuesOf(() =>
      parseConfig({
        ...validProductionEnv,
        FERRO_APPROVAL_PIN_HASH: "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
      }),
    );
    expect(issues).toEqual([expect.stringMatching(/^FERRO_APPROVAL_PIN_HASH:/)]);
  });

  it("nunca incluye valores secretos en el mensaje de error", () => {
    const secret = "pk_live_valor_secreto";
    try {
      parseConfig({ ...validProductionEnv, STRIPE_SECRET_KEY: secret });
      throw new Error("se esperaba un ConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

describe("getWhatsAppNumber", () => {
  it("devuelve el número si es válido", () => {
    expect(getWhatsAppNumber({ FERRO_WHATSAPP_NUMBER: "5215512345678" })).toBe("5215512345678");
  });

  it("devuelve undefined si no está definido o está vacío", () => {
    expect(getWhatsAppNumber({})).toBeUndefined();
    expect(getWhatsAppNumber({ FERRO_WHATSAPP_NUMBER: "" })).toBeUndefined();
  });

  it("lanza ConfigError con un formato inválido, sin exigir otras variables", () => {
    expect(() =>
      getWhatsAppNumber({ NODE_ENV: "production", FERRO_WHATSAPP_NUMBER: "+52 55" }),
    ).toThrow(ConfigError);
  });
});

describe("getDatabaseUrl (DECISIONS A14)", () => {
  it("devuelve la URL sin exigir los demás secretos de producción (next build)", () => {
    expect(getDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@h/db" })).toBe(
      "postgresql://u:p@h/db",
    );
  });

  it("devuelve undefined si no está definida o está vacía", () => {
    expect(getDatabaseUrl({})).toBeUndefined();
    expect(getDatabaseUrl({ DATABASE_URL: "" })).toBeUndefined();
  });

  it("lanza ConfigError con un formato inválido, sin mostrar el valor", () => {
    expect(() => getDatabaseUrl({ DATABASE_URL: "mysql://secreto@h/db" })).toThrow(ConfigError);
    try {
      getDatabaseUrl({ DATABASE_URL: "mysql://secreto@h/db" });
    } catch (error) {
      expect((error as Error).message).not.toContain("secreto");
    }
  });
});
