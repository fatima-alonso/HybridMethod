import { hashToken } from "@/lib/crypto";
import { getPrisma, type Db } from "@/lib/prisma";
import {
  businessDate,
  dateStringToDbDate,
  dbDateToDateString,
  type DateString,
} from "@/utils/business-calendar";

import { recordAudit } from "./audit.service";
import { DeliveryLinkUnavailableError, InvalidDeliveryDateError } from "./errors";
import { formatContractAmount, type RequestContext } from "./transfer.service";
import { isWellFormedToken } from "./transfer-approval.service";

/**
 * Registro de la entrega del plan (RF-23, RN-07, SDD §7.8, DECISIONS A19). Solo guarda un dato de
 * referencia: no cambia estados, periodos ni cobros, y no envía correos. Sin PIN.
 *
 * - `getDeliveryView`: lo que muestra `GET /plan/entrega/[token]`. Solo lectura (los filtros de
 *   correo abren los enlaces solos; si el GET registrara algo, quedaría la fecha equivocada).
 * - `confirmDelivery`: `POST /api/plan-delivery/confirm` con `{ token, deliveredOn }`.
 */

export type DeliveryDetails = {
  customerName: string;
  programName: string;
  reference: string;
  amount: string;
  paidAt: Date;
  startDate: Date;
  endDate: Date;
  /** Fechas permitidas para la entrega: del día del pago a hoy (zona del negocio). */
  minDate: DateString;
  maxDate: DateString;
};

export type DeliveryView =
  | { state: "not_found" }
  | { state: "expired" }
  | { state: "delivered"; deliveredOn: DateString; details: DeliveryDetails }
  | { state: "valid"; details: DeliveryDetails; defaultDate: DateString };

async function findLink(token: string, db: Db) {
  if (!isWellFormedToken(token)) return null;
  return db.planDeliveryLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      servicePeriod: { include: { program: true, contract: { include: { customer: true } } } },
    },
  });
}

type LinkWithPeriod = NonNullable<Awaited<ReturnType<typeof findLink>>>;

function detailsOf(link: LinkWithPeriod, now: Date): DeliveryDetails {
  const period = link.servicePeriod;
  const today = businessDate(now);
  const paidDay = businessDate(period.paidAt);
  return {
    customerName: period.contract.customer.fullName,
    programName: period.program.name,
    reference: period.contract.reference,
    amount: formatContractAmount(period.contract),
    paidAt: period.paidAt,
    startDate: period.startDate,
    endDate: period.endDate,
    minDate: paidDay,
    // Si por diferencia de relojes "hoy" quedara antes del pago, se permite el día del pago.
    maxDate: today < paidDay ? paidDay : today,
  };
}

/**
 * Lo que ve Ferro al abrir un botón. Si la entrega ya se registró (con este botón o con otro del
 * mismo mes), muestra la fecha registrada aunque el botón haya vencido.
 */
export async function getDeliveryView(
  token: string,
  db: Db = getPrisma(),
  now: Date = new Date(),
): Promise<DeliveryView> {
  const link = await findLink(token, db);
  if (!link) return { state: "not_found" };
  const details = detailsOf(link, now);
  const delivered = link.servicePeriod.planDeliveredOn;
  if (delivered) {
    return { state: "delivered", deliveredOn: dbDateToDateString(delivered), details };
  }
  if (link.expiresAt.getTime() <= now.getTime()) return { state: "expired" };
  return { state: "valid", details, defaultDate: details.maxDate };
}

export type ConfirmDeliveryResult = {
  deliveredOn: DateString;
  /** `true` si la entrega ya estaba registrada: no se cambió nada. */
  alreadyRecorded: boolean;
};

/**
 * Registra la fecha de entrega del mes (SDD §7.8):
 * 1. Busca el botón por el hash del token. Si el mes ya tiene fecha, la devuelve sin cambiar nada.
 * 2. Valida el botón (no vencido) y la fecha: no futura ni anterior al día del pago.
 * 3. En una transacción con compare-and-set (`planDeliveredOn IS NULL`): guarda la fecha y cuándo se
 *    registró, marca el botón como usado y escribe `plan.delivered` en la auditoría.
 */
export async function confirmDelivery(
  input: { token: string; deliveredOn: DateString },
  context: RequestContext = {},
  db = getPrisma(),
  now: Date = new Date(),
): Promise<ConfirmDeliveryResult> {
  const link = await findLink(input.token, db);
  if (!link) throw new DeliveryLinkUnavailableError("not_found");
  const period = link.servicePeriod;
  if (period.planDeliveredOn) {
    return { deliveredOn: dbDateToDateString(period.planDeliveredOn), alreadyRecorded: true };
  }
  if (link.expiresAt.getTime() <= now.getTime()) throw new DeliveryLinkUnavailableError("expired");

  const { minDate, maxDate } = detailsOf(link, now);
  if (input.deliveredOn > maxDate) throw new InvalidDeliveryDateError("future");
  if (input.deliveredOn < minDate) throw new InvalidDeliveryDateError("before_payment");

  return db.$transaction(async (tx) => {
    const { count } = await tx.servicePeriod.updateMany({
      where: { id: period.id, planDeliveredOn: null },
      data: { planDeliveredOn: dateStringToDbDate(input.deliveredOn), deliveryRecordedAt: now },
    });
    if (count === 0) {
      // Otro botón del mismo mes la registró al mismo tiempo: se respeta la que quedó.
      const current = await tx.servicePeriod.findUniqueOrThrow({ where: { id: period.id } });
      return {
        deliveredOn: dbDateToDateString(current.planDeliveredOn!),
        alreadyRecorded: true,
      };
    }
    await tx.planDeliveryLink.update({ where: { id: link.id }, data: { usedAt: now } });
    await recordAudit(
      {
        action: "plan.delivered",
        actor: "ferro",
        entityType: "ServicePeriod",
        entityId: period.id,
        ip: context.ip,
        userAgent: context.userAgent,
        metadata: {
          reference: period.contract.reference,
          sequence: period.sequence,
          deliveredOn: input.deliveredOn,
        },
      },
      tx,
    );
    return { deliveredOn: input.deliveredOn, alreadyRecorded: false };
  });
}
