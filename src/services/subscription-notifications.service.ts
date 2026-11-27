import type { Program, Subscription } from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";
import { applicationHref } from "@/content/landing";
import { SUBSCRIPTION_PAGE_PATH } from "@/content/subscription";
import type { Db } from "@/lib/prisma";
import { formatBusinessDate, formatPrice } from "@/utils/format";

import type { SubscriptionEndReason } from "./email/templates";
import {
  sendSubscriptionCancellationRevertedEmail,
  sendSubscriptionCancellationScheduledEmail,
  sendSubscriptionChangeAlertEmail,
  sendSubscriptionDiscountEndedEmail,
  sendSubscriptionEndedEmail,
  sendSubscriptionPlanChangedEmail,
} from "./email.service";
import type { SubscriptionSnapshot } from "./subscription.service";
import { notifyQuietly, type ContractWithRelations } from "./stripe-webhook-shared";

/**
 * Avisos de los cambios de una suscripción (Fase 7, RF-14, RF-19, DECISIONS A33). Cada aviso va al
 * cliente y a Ferro:
 * - Cancelación programada (al pedirla en el portal): sigue hasta el final del periodo.
 * - Cancelación deshecha: vuelve a renovarse.
 * - Cambio de programa: aplica en la siguiente renovación (RN-08).
 * - Suscripción terminada: al final del periodo, por los tres cobros fallidos (A32) o porque Ferro
 *   la canceló en Stripe.
 *
 * Los webhooks los detectan dentro de la transacción y se envían después de confirmarla. Un fallo
 * al enviar se registra y no revierte nada (SDD §6.2).
 */

/** URL de la página "Administrar mi suscripción". */
export function manageSubscriptionUrl(): string {
  return `${getConfig().APP_URL}${SUBSCRIPTION_PAGE_PATH}`;
}

export type SubscriptionNotice = {
  contract: ContractWithRelations;
  /** Programa de la suscripción ahora (el que se está pagando). */
  program: Program;
} & (
  | { kind: "cancellation_scheduled"; endsOn: Date }
  | { kind: "cancellation_reverted"; renewsOn: Date }
  | { kind: "plan_changed"; to: Program; effectiveOn: Date }
  /** Se quitó el cupón (Ferro lo quitó o terminó su duración): se vuelve al precio normal (A34). */
  | { kind: "discount_ended"; promotionCode: string | null; renewsOn: Date }
  | { kind: "ended"; reason: SubscriptionEndReason }
);

/** Contratos cuya suscripción está vigente: solo de ellos se avisan los cambios del portal. */
const LIVE_CONTRACT = ["active", "payment_failed"] as const;

/**
 * Compara la fila Subscription de antes y de después de sincronizar y devuelve los avisos. La
 * primera sincronización (sin fila previa) no avisa nada: es el alta. Una suscripción ya cancelada
 * se avisa al cancelar el contrato (`endedNotice`), no aquí.
 *
 * Como cada evento copia el estado actual de Stripe, un cambio se detecta en el primer evento que
 * lo ve y los siguientes ya no encuentran diferencia: no se repite el aviso.
 */
export async function detectSubscriptionChanges(
  contract: ContractWithRelations,
  previous: Subscription | null,
  current: Subscription,
  snapshot: SubscriptionSnapshot,
  db: Db,
): Promise<SubscriptionNotice[]> {
  if (!previous || current.status === "canceled") return [];
  if (!(LIVE_CONTRACT as readonly string[]).includes(contract.status)) return [];

  const program = await programById(db, current.programId, contract);
  const notices: SubscriptionNotice[] = [];
  const periodEnd = current.currentPeriodEnd ?? contract.serviceEndDate;

  if (previous.programId !== current.programId && periodEnd) {
    const from = await programById(db, previous.programId, contract);
    notices.push({
      kind: "plan_changed",
      contract,
      program: from,
      to: program,
      effectiveOn: periodEnd,
    });
  }
  if (!previous.cancelAtPeriodEnd && current.cancelAtPeriodEnd) {
    const endsOn = snapshot.cancelAt ?? periodEnd;
    if (endsOn) notices.push({ kind: "cancellation_scheduled", contract, program, endsOn });
  } else if (previous.cancelAtPeriodEnd && !current.cancelAtPeriodEnd && periodEnd) {
    notices.push({ kind: "cancellation_reverted", contract, program, renewsOn: periodEnd });
  }
  // Una suscripción que ya no se va a renovar no tiene un "siguiente cobro" que avisar.
  if (previous.hasDiscount && !current.hasDiscount && !current.cancelAtPeriodEnd && periodEnd) {
    notices.push({
      kind: "discount_ended",
      contract,
      program,
      promotionCode: previous.promotionCode,
      renewsOn: periodEnd,
    });
  }
  return notices;
}

/** Aviso de una suscripción que terminó y cuyo contrato se acaba de cancelar. */
export async function endedNotice(
  contract: ContractWithRelations,
  reason: SubscriptionEndReason,
  db: Db,
): Promise<SubscriptionNotice> {
  const subscription = await db.subscription.findUnique({
    where: { contractId: contract.id },
    select: { programId: true },
  });
  const program = await programById(db, subscription?.programId ?? contract.programId, contract);
  return { kind: "ended", contract, program, reason };
}

/** Motivo de una cancelación según Stripe: los cobros fallidos tienen su propio texto (A32). */
export function endReasonFromStripe(cancellationReason: string | null): SubscriptionEndReason {
  return cancellationReason === "payment_failed" ? "payment_failed" : "requested";
}

async function programById(
  db: Db,
  programId: string,
  contract: ContractWithRelations,
): Promise<Program> {
  if (programId === contract.programId) return contract.program;
  return db.program.findUniqueOrThrow({ where: { id: programId } });
}

/** Envía los avisos (cliente y Ferro) después de confirmar la transacción. */
export async function sendSubscriptionNotices(
  notices: readonly SubscriptionNotice[],
  db: Db,
): Promise<void> {
  for (const notice of notices) {
    const { contract, program } = notice;
    const { customer } = contract;
    const base = {
      reference: contract.reference,
      customerName: customer.fullName,
    };
    const alertBase = {
      ...base,
      customerEmail: customer.email,
      customerWhatsapp: customer.whatsapp,
      programName: program.name,
    };
    const to = customer.email;
    switch (notice.kind) {
      case "cancellation_scheduled": {
        const endsOn = formatBusinessDate(notice.endsOn);
        await notifyQuietly(db, contract, "subscription_cancellation_scheduled", () =>
          sendSubscriptionCancellationScheduledEmail({
            to,
            ...base,
            programName: program.name,
            endsOn,
            manageUrl: manageSubscriptionUrl(),
          }),
        );
        await notifyQuietly(db, contract, "subscription_cancellation_scheduled_alert", () =>
          sendSubscriptionChangeAlertEmail({ ...alertBase, kind: notice.kind, endsOn }),
        );
        break;
      }
      case "cancellation_reverted": {
        const renewsOn = formatBusinessDate(notice.renewsOn);
        await notifyQuietly(db, contract, "subscription_cancellation_reverted", () =>
          sendSubscriptionCancellationRevertedEmail({
            to,
            ...base,
            programName: program.name,
            renewsOn,
            manageUrl: manageSubscriptionUrl(),
          }),
        );
        await notifyQuietly(db, contract, "subscription_cancellation_reverted_alert", () =>
          sendSubscriptionChangeAlertEmail({ ...alertBase, kind: notice.kind, renewsOn }),
        );
        break;
      }
      case "plan_changed": {
        const effectiveOn = formatBusinessDate(notice.effectiveOn);
        const amount = formatPrice(
          notice.to.subscriptionPrice.toFixed(2) as `${number}`,
          notice.to.currency,
        );
        await notifyQuietly(db, contract, "subscription_plan_changed", () =>
          sendSubscriptionPlanChangedEmail({
            to,
            ...base,
            fromProgramName: program.name,
            toProgramName: notice.to.name,
            amount,
            effectiveOn,
            manageUrl: manageSubscriptionUrl(),
          }),
        );
        await notifyQuietly(db, contract, "subscription_plan_changed_alert", () =>
          sendSubscriptionChangeAlertEmail({
            ...alertBase,
            kind: notice.kind,
            toProgramName: notice.to.name,
            amount,
            effectiveOn,
          }),
        );
        break;
      }
      case "discount_ended": {
        const renewsOn = formatBusinessDate(notice.renewsOn);
        const amount = formatPrice(
          program.subscriptionPrice.toFixed(2) as `${number}`,
          program.currency,
        );
        await notifyQuietly(db, contract, "subscription_discount_ended", () =>
          sendSubscriptionDiscountEndedEmail({
            to,
            ...base,
            programName: program.name,
            promotionCode: notice.promotionCode,
            amount,
            renewsOn,
            manageUrl: manageSubscriptionUrl(),
          }),
        );
        await notifyQuietly(db, contract, "subscription_discount_ended_alert", () =>
          sendSubscriptionChangeAlertEmail({
            ...alertBase,
            kind: notice.kind,
            promotionCode: notice.promotionCode,
            amount,
            renewsOn,
          }),
        );
        break;
      }
      case "ended": {
        await notifyQuietly(db, contract, "subscription_ended", () =>
          sendSubscriptionEndedEmail({
            to,
            ...base,
            programName: program.name,
            reason: notice.reason,
            rejoinUrl: `${getConfig().APP_URL}${applicationHref()}`,
          }),
        );
        await notifyQuietly(db, contract, "subscription_ended_alert", () =>
          sendSubscriptionChangeAlertEmail({
            ...alertBase,
            kind: notice.kind,
            reason: notice.reason,
          }),
        );
        break;
      }
    }
  }
}
