import { getConfig } from "@/lib/config";
import { generateToken, hashToken } from "@/lib/crypto";
import { getPrisma, type Db } from "@/lib/prisma";

/**
 * Botones "Registrar entrega del plan" (DECISIONS A19, SDD §5.3 PlanDeliveryLink). Cada uno es un
 * token de 32 bytes del que solo se guarda el SHA-256 y vence a los `TRANSFER_LINK_TTL_DAYS` días.
 * Varios botones del mismo mes pueden estar vigentes a la vez: uno no invalida a los otros.
 */

/** Ruta del botón (SDD §7.8). */
export function planDeliveryUrl(token: string, appUrl: string = getConfig().APP_URL): string {
  return `${appUrl}/plan/entrega/${token}`;
}

export async function createPlanDeliveryLink(
  servicePeriodId: string,
  db: Db = getPrisma(),
  now: Date = new Date(),
  ttlDays: number = getConfig().TRANSFER_LINK_TTL_DAYS,
): Promise<{ token: string; url: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  await db.planDeliveryLink.create({
    data: { servicePeriodId, tokenHash: hashToken(token), expiresAt, createdAt: now },
  });
  return { token, url: planDeliveryUrl(token), expiresAt };
}
