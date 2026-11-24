import { z } from "zod";

/**
 * Configuración del servidor (SDD §9.1).
 *
 * Lee y valida las variables de entorno con Zod. Solo debe importarse desde código de servidor
 * (Route Handlers, Server Components, `services/`): contiene secretos.
 *
 * Política (DECISIONS A9):
 * - En producción (`NODE_ENV=production`) todas las variables de §9.1 son obligatorias.
 * - En desarrollo y pruebas, las claves de servicios externos son opcionales para que la app
 *   arranque sin claves reales; cada servicio decide su modo de desarrollo (p. ej. el correo
 *   se registra en consola si falta `RESEND_API_KEY`).
 * - Si una variable está definida, siempre se valida su formato, en cualquier entorno.
 *
 * La validación es perezosa (al primer `getConfig()`) para que `next build` no exija secretos;
 * `src/instrumentation.ts` la ejecuta al arrancar el servidor para fallar pronto.
 */

/** Trata las cadenas vacías (`VAR=` en `.env`) como no definidas. */
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const required = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(emptyToUndefined, schema);
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional());

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, "debe ser una URL de PostgreSQL (postgres:// o postgresql://)");

const prefixed = (prefix: string) => z.string().startsWith(prefix, `debe empezar con "${prefix}"`);

/** Número de WhatsApp en formato internacional sin "+", espacios ni guiones (formato de wa.me). */
const whatsappNumber = z
  .string()
  .regex(
    /^\d{8,15}$/,
    "debe tener solo dígitos en formato internacional, sin + (ej. 5215512345678)",
  );

/** Hash bcrypt ($2a$/$2b$/$2y$) generado con `npm run hash-pin` (DECISIONS A17). */
const pinHash = z
  .string()
  .regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, "debe ser un hash bcrypt (npm run hash-pin)");

const fields = {
  DATABASE_URL: postgresUrl,

  STRIPE_SECRET_KEY: prefixed("sk_"),
  STRIPE_WEBHOOK_SECRET: prefixed("whsec_"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: prefixed("pk_"),

  RESEND_API_KEY: prefixed("re_"),
  RESEND_FROM_EMAIL: z.string().min(3),
  FERRO_NOTIFICATION_EMAIL: z.email(),
  FERRO_WHATSAPP_NUMBER: whatsappNumber,

  APP_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, "")),
  FERRO_APPROVAL_PIN_HASH: pinHash,
  OTP_SESSION_SECRET: z.string().min(32, "debe tener al menos 32 caracteres"),
};

const transferLinkTtlDays = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(1).max(30).default(7),
);

const productionSchema = z.object({
  DATABASE_URL: required(fields.DATABASE_URL),
  STRIPE_SECRET_KEY: required(fields.STRIPE_SECRET_KEY),
  STRIPE_WEBHOOK_SECRET: required(fields.STRIPE_WEBHOOK_SECRET),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: required(fields.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
  RESEND_API_KEY: required(fields.RESEND_API_KEY),
  RESEND_FROM_EMAIL: required(fields.RESEND_FROM_EMAIL),
  FERRO_NOTIFICATION_EMAIL: required(fields.FERRO_NOTIFICATION_EMAIL),
  FERRO_WHATSAPP_NUMBER: required(fields.FERRO_WHATSAPP_NUMBER),
  APP_URL: required(fields.APP_URL),
  FERRO_APPROVAL_PIN_HASH: required(fields.FERRO_APPROVAL_PIN_HASH),
  OTP_SESSION_SECRET: required(fields.OTP_SESSION_SECRET),
  TRANSFER_LINK_TTL_DAYS: transferLinkTtlDays,
});

const developmentSchema = z.object({
  DATABASE_URL: optional(fields.DATABASE_URL),
  STRIPE_SECRET_KEY: optional(fields.STRIPE_SECRET_KEY),
  STRIPE_WEBHOOK_SECRET: optional(fields.STRIPE_WEBHOOK_SECRET),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optional(fields.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
  RESEND_API_KEY: optional(fields.RESEND_API_KEY),
  RESEND_FROM_EMAIL: optional(fields.RESEND_FROM_EMAIL),
  FERRO_NOTIFICATION_EMAIL: optional(fields.FERRO_NOTIFICATION_EMAIL),
  FERRO_WHATSAPP_NUMBER: optional(fields.FERRO_WHATSAPP_NUMBER),
  APP_URL: z.preprocess(
    (value) => (value === "" || value === undefined ? "http://localhost:3000" : value),
    fields.APP_URL,
  ),
  FERRO_APPROVAL_PIN_HASH: optional(fields.FERRO_APPROVAL_PIN_HASH),
  OTP_SESSION_SECRET: optional(fields.OTP_SESSION_SECRET),
  TRANSFER_LINK_TTL_DAYS: transferLinkTtlDays,
});

type DevelopmentConfig = z.infer<typeof developmentSchema>;

export type AppEnvironment = "production" | "development" | "test";

/** En producción todos los campos existen; en desarrollo algunos pueden faltar. */
export type AppConfig = DevelopmentConfig & {
  environment: AppEnvironment;
  isProduction: boolean;
};

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuración inválida en las variables de entorno:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

function resolveEnvironment(nodeEnv: string | undefined): AppEnvironment {
  if (nodeEnv === "production" || nodeEnv === "test") return nodeEnv;
  return "development";
}

/**
 * Valida un conjunto de variables de entorno. Exportada para pruebas;
 * la aplicación debe usar `getConfig()`.
 */
export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const environment = resolveEnvironment(env.NODE_ENV);
  const isProduction = environment === "production";
  const schema = isProduction ? productionSchema : developmentSchema;
  const result = schema.safeParse(env);

  if (!result.success) {
    // Solo se reportan nombres de variables y motivos, nunca sus valores (SDD §9.6).
    const issues = result.error.issues.map((issue) => {
      const name = issue.path.join(".") || "(raíz)";
      const raw = typeof issue.path[0] === "string" ? env[issue.path[0]] : undefined;
      const missing = issue.code === "invalid_type" && (raw === undefined || raw === "");
      return missing ? `${name}: es obligatoria` : `${name}: ${issue.message}`;
    });
    throw new ConfigError(issues);
  }

  return { ...result.data, environment, isProduction };
}

let cached: AppConfig | undefined;

/** Configuración validada del proceso actual (se valida una vez y se guarda en memoria). */
export function getConfig(): AppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

/** Solo para pruebas: descarta la configuración guardada en memoria. */
export function resetConfigCache(): void {
  cached = undefined;
}

/**
 * Número de WhatsApp de Ferro para los enlaces `wa.me` de la landing.
 *
 * La landing se prerenderiza en `next build`, donde no se exigen los secretos de producción
 * (DECISIONS A9). Por eso esta función valida solo `FERRO_WHATSAPP_NUMBER` en lugar de llamar a
 * `getConfig()`. Devuelve `undefined` si no está definida (desarrollo); en producción el arranque
 * del servidor ya garantiza que existe. Un valor con formato inválido lanza `ConfigError`.
 */
export function getWhatsAppNumber(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const result = optional(whatsappNumber).safeParse(env.FERRO_WHATSAPP_NUMBER);
  if (!result.success) {
    throw new ConfigError([`FERRO_WHATSAPP_NUMBER: ${result.error.issues[0]?.message}`]);
  }
  return result.data;
}

/**
 * URL de PostgreSQL para el cliente de Prisma.
 *
 * Igual que `getWhatsAppNumber`, valida solo `DATABASE_URL` en lugar de llamar a `getConfig()`:
 * la landing lee los programas de la BD al prerenderizarse en `next build`, donde no se exigen los
 * demás secretos de producción (DECISIONS A9, A14). Devuelve `undefined` si no está definida; en
 * producción el arranque del servidor ya garantiza que existe. Un valor inválido lanza `ConfigError`.
 */
export function getDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const result = optional(postgresUrl).safeParse(env.DATABASE_URL);
  if (!result.success) {
    throw new ConfigError([`DATABASE_URL: ${result.error.issues[0]?.message}`]);
  }
  return result.data;
}
