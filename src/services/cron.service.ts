import { getConfig } from "@/lib/config";
import { getPrisma, type Db } from "@/lib/prisma";
import { purgeRateLimitBuckets } from "@/lib/rate-limit";
import {
  businessDate,
  businessDaysBetween,
  dateStringToDbDate,
  isBusinessDay,
  type DateString,
} from "@/utils/business-calendar";
import { formatBusinessDateTime } from "@/utils/format";

import { recordAudit } from "./audit.service";
import {
  activateDueScheduledContracts,
  completeExpiredContracts,
  expireStalePendingContracts,
} from "./contract.service";
import { createPlanDeliveryLink } from "./delivery-link";
import { sendPlanDeliveryReminderEmail } from "./email.service";

/**
 * Tareas diarias (SDD §7.8). Las ejecuta `GET /api/cron/daily` (Vercel Cron, una vez al día).
 * Todas son idempotentes: ejecutarlas dos veces el mismo día no duplica nada.
 */

export type DailyJobsResult = {
  expiredPending: number;
  scheduledActivated: number;
  completed: number;
  reminders: { sent: number; failed: number; skippedNotBusinessDay: boolean };
  rateLimitBucketsPurged: number;
};

export async function runDailyJobs(
  db = getPrisma(),
  now: Date = new Date(),
): Promise<DailyJobsResult> {
  const expiredPending = await expireStalePendingContracts(db, now);
  // Primero los meses que empiezan y después los que terminan (un mes puede hacer las dos cosas).
  const scheduledActivated = await activateDueScheduledContracts(db, now);
  const completed = await completeExpiredContracts(db, now);
  const reminders = await sendPlanDeliveryReminders(db, now);
  const rateLimitBucketsPurged = await purgeRateLimitBuckets(undefined, db, now);
  return { expiredPending, scheduledActivated, completed, reminders, rateLimitBucketsPurged };
}

/**
 * Recordatorios de entrega (DECISIONS A19): de lunes a viernes, sin festivos, un correo por cada
 * mes sin fecha de entrega que lleve `PLAN_DELIVERY_REMINDER_BUSINESS_DAYS` días hábiles o más
 * desde el pago y no tenga recordatorio hoy. Cada correo trae un botón nuevo.
 *
 * `lastReminderAt` se marca con un compare-and-set antes de enviar: dos ejecuciones simultáneas
 * no mandan dos recordatorios. Si el correo falla, se registra y se reintenta el siguiente día hábil.
 */
export async function sendPlanDeliveryReminders(
  db: Db = getPrisma(),
  now: Date = new Date(),
  minBusinessDays: number = getConfig().PLAN_DELIVERY_REMINDER_BUSINESS_DAYS,
): Promise<DailyJobsResult["reminders"]> {
  const today = businessDate(now);
  if (!isBusinessDay(today)) return { sent: 0, failed: 0, skippedNotBusinessDay: true };

  // Medianoche de hoy en la zona del negocio, como instante: un recordatorio anterior a eso fue
  // de otro día.
  const todayStart = startOfBusinessDay(today);
  const candidates = await db.servicePeriod.findMany({
    where: {
      planDeliveredOn: null,
      OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: todayStart } }],
    },
    include: { program: true, contract: { include: { customer: true } } },
    orderBy: { paidAt: "asc" },
  });

  let sent = 0;
  let failed = 0;
  for (const period of candidates) {
    if (businessDaysBetween(businessDate(period.paidAt), today) < minBusinessDays) continue;

    const { count } = await db.servicePeriod.updateMany({
      where: {
        id: period.id,
        planDeliveredOn: null,
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: todayStart } }],
      },
      data: { lastReminderAt: now },
    });
    if (count === 0) continue;

    try {
      const link = await createPlanDeliveryLink(period.id, db, now);
      await sendPlanDeliveryReminderEmail({
        customerName: period.contract.customer.fullName,
        programName: period.program.name,
        reference: period.contract.reference,
        paidAt: formatBusinessDateTime(period.paidAt),
        deliveryUrl: link.url,
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `[cron] No se pudo enviar el recordatorio de ${period.contract.reference}:`,
        error instanceof Error ? error.name : "error desconocido",
      );
      await recordAudit(
        {
          action: "plan.reminder_failed",
          actor: "system",
          entityType: "ServicePeriod",
          entityId: period.id,
          metadata: { reference: period.contract.reference, sequence: period.sequence },
        },
        db,
      ).catch(() => undefined);
    }
  }
  return { sent, failed, skippedNotBusinessDay: false };
}

/** Instante en que empieza un día del negocio (00:00 en America/Mexico_City). */
export function startOfBusinessDay(day: DateString): Date {
  // El desfase de la zona está entre −14 y +14 horas: la primera hora de ese rango que ya cae en
  // `day` es su medianoche local (México usa desfases de horas completas).
  const base = dateStringToDbDate(day).getTime();
  for (let hours = -14; hours <= 14; hours += 1) {
    const instant = new Date(base + hours * 3600_000);
    if (businessDate(instant) === day) return instant;
  }
  return new Date(base);
}
