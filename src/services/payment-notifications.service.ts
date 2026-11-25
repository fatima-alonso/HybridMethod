import type {
  Contract,
  Customer,
  PaymentMethod,
  Program,
  ServicePeriod,
} from "@/generated/prisma/client";
import { getWhatsAppNumber } from "@/lib/config";
import { getPrisma, type Db } from "@/lib/prisma";
import { formatBusinessDate, formatBusinessDateTime, formatPrice } from "@/utils/format";
import { buildWhatsAppLink } from "@/utils/whatsapp";

import { recordAudit } from "./audit.service";
import {
  sendPaymentReceivedEmail,
  sendPurchaseConfirmationEmail,
  sendTransferConfirmedEmail,
  sendWelcomeEmail,
} from "./email.service";

/**
 * Correos después de un pago confirmado (SDD §7.5 paso 6, §7.6 paso 5, DECISIONS A19):
 * - Cliente: la confirmación (Transfer Confirmed o Purchase Confirmation) y Welcome.
 * - Ferro: Payment Received con todos los datos del cliente y el botón "Registrar entrega del plan".
 *
 * Se envían después de la transacción. Un fallo se registra en la consola y en AuditLog y nunca
 * revierte el pago (SDD §10).
 */

/** Cómo se describe cada método al cliente y a Ferro. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, { customer: string; ferro: string }> = {
  transfer: {
    customer: "Transferencia bancaria",
    ferro: "Transferencia bancaria (confirmada por ti)",
  },
  stripe_one_time: {
    customer: "Pago único con tarjeta",
    ferro: "Pago único con tarjeta (Stripe)",
  },
  stripe_subscription: {
    customer: "Suscripción mensual con tarjeta",
    ferro: "Suscripción mensual con tarjeta (Stripe)",
  },
};

export type PaidNotificationInput = {
  contract: Contract;
  customer: Customer;
  program: Program;
  servicePeriod: ServicePeriod;
  method: PaymentMethod;
  /** Importe cobrado (puede venir de Stripe), decimal en texto. */
  amount: `${number}`;
  currency: string;
  /** URL del botón "Registrar entrega del plan" (token en claro, solo viaja en el correo). */
  deliveryUrl: string;
  /** Acción de auditoría si un correo falla (p. ej. `transfer.notification_failed`). */
  failureAuditAction: string;
};

export async function sendPaidNotifications(
  input: PaidNotificationInput,
  db: Db = getPrisma(),
): Promise<void> {
  const { contract, customer, program, servicePeriod, method } = input;
  const serviceStart = formatBusinessDateTime(contract.serviceStartDate!);
  const serviceEnd = formatBusinessDateTime(contract.serviceEndDate!);
  const amount = formatPrice(input.amount, input.currency);
  const labels = PAYMENT_METHOD_LABELS[method];
  const startsLater = contract.status === "scheduled";
  const whatsappNumber = getWhatsAppNumber();

  const confirmation: [string, () => Promise<unknown>] =
    method === "transfer"
      ? [
          "transfer_confirmed",
          () =>
            sendTransferConfirmedEmail({
              to: customer.email,
              customerName: customer.fullName,
              reference: contract.reference,
              programName: program.name,
              amount,
              serviceStart,
              serviceEnd,
            }),
        ]
      : [
          "purchase_confirmation",
          () =>
            sendPurchaseConfirmationEmail({
              to: customer.email,
              customerName: customer.fullName,
              reference: contract.reference,
              programName: program.name,
              amount,
              method: labels.customer,
              serviceStart,
              serviceEnd,
              startsLater,
            }),
        ];

  const emails: Array<[string, () => Promise<unknown>]> = [
    confirmation,
    [
      "welcome",
      () =>
        sendWelcomeEmail({
          to: customer.email,
          customerName: customer.fullName,
          programName: program.name,
          serviceStart,
          serviceEnd,
          whatsappUrl: whatsappNumber
            ? buildWhatsAppLink(
                whatsappNumber,
                `Hola Ferro, soy ${customer.fullName}. Ya está activo mi plan de ${program.name} (${contract.reference}).`,
              )
            : null,
        }),
    ],
    [
      "payment_received",
      () =>
        sendPaymentReceivedEmail({
          reference: contract.reference,
          customerName: customer.fullName,
          customerEmail: customer.email,
          customerWhatsapp: customer.whatsapp,
          programName: program.name,
          amount,
          method: labels.ferro,
          paidAt: formatBusinessDateTime(servicePeriod.paidAt),
          serviceStart,
          serviceEnd,
          prepaid: startsLater
            ? {
                from: formatBusinessDate(contract.serviceStartDate!),
                to: formatBusinessDate(contract.serviceEndDate!),
              }
            : null,
          deliveryUrl: input.deliveryUrl,
        }),
    ],
  ];

  for (const [name, send] of emails) {
    try {
      await send();
    } catch (error) {
      console.error(
        `[payment] No se pudo enviar ${name} para ${contract.reference}:`,
        error instanceof Error ? error.name : "error desconocido",
      );
      await recordAudit(
        {
          action: input.failureAuditAction,
          actor: "system",
          entityType: "Contract",
          entityId: contract.id,
          metadata: { reference: contract.reference, email: name },
        },
        db,
      ).catch(() => undefined);
    }
  }
}
