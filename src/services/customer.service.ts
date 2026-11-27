import type Stripe from "stripe";

import type { Customer } from "@/generated/prisma/client";
import { getPrisma, type Db } from "@/lib/prisma";
import {
  customerDataSchema,
  emailSchema,
  normalizeEmail,
  type CustomerDataInput,
} from "@/lib/validations";

import { recordAudit } from "./audit.service";
import { EmailInUseError, NotFoundError, ServiceError } from "./errors";

/**
 * Clientes (RF-16, SDD §5.3).
 *
 * El correo es la identidad del cliente: se normaliza antes de guardarlo y de buscarlo, y es
 * UNIQUE en la BD. Este servicio no expone datos de un cliente a partir de su correo: las rutas
 * públicas solo pueden usarlo después de una verificación OTP del correo (RN-12, DECISIONS A4).
 */

/**
 * Crea el cliente o, si el correo ya existe, actualiza su nombre y WhatsApp (DECISIONS A4).
 * Es atómico ante solicitudes simultáneas con el mismo correo (`INSERT … ON CONFLICT`).
 *
 * Solo debe llamarse con un correo ya verificado por OTP en la sesión (Fase 3).
 */
export async function upsertVerifiedCustomer(
  input: CustomerDataInput,
  db: Db = getPrisma(),
): Promise<Customer> {
  const data = customerDataSchema.parse(input);
  return db.customer.upsert({
    where: { email: data.email },
    create: data,
    update: { fullName: data.fullName, whatsapp: data.whatsapp },
  });
}

/**
 * Id del cliente con ese correo, o `null`. Uso interno (p. ej. asociar un OTP a un cliente);
 * su resultado nunca debe reflejarse en una respuesta pública (SDD §7.1).
 */
export async function findCustomerIdByEmail(
  email: string,
  db: Db = getPrisma(),
): Promise<string | null> {
  const customer = await db.customer.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true },
  });
  return customer?.id ?? null;
}

/**
 * Cliente de Stripe del cliente (SDD §5.3 `stripeCustomerId`). Si no tiene, lo crea y lo guarda con
 * un compare-and-set: con dos solicitudes simultáneas gana la primera y la otra usa ese. La clave
 * de idempotencia hace que Stripe devuelva el mismo cliente a las dos durante 24 h.
 */
export async function ensureStripeCustomer(
  customer: Pick<Customer, "id" | "email" | "fullName" | "whatsapp" | "stripeCustomerId">,
  stripe: Pick<Stripe, "customers">,
  db: Db = getPrisma(),
): Promise<string> {
  if (customer.stripeCustomerId) return customer.stripeCustomerId;
  const created = await stripe.customers.create(
    {
      email: customer.email,
      name: customer.fullName,
      phone: customer.whatsapp,
      metadata: { customerId: customer.id },
    },
    { idempotencyKey: `customer-${customer.id}` },
  );
  await db.customer.updateMany({
    where: { id: customer.id, stripeCustomerId: null },
    data: { stripeCustomerId: created.id },
  });
  const saved = await db.customer.findUniqueOrThrow({
    where: { id: customer.id },
    select: { stripeCustomerId: true },
  });
  return saved.stripeCustomerId ?? created.id;
}

/** Correo inválido para `changeCustomerEmail` (el mensaje es el de la validación del formulario). */
export class InvalidEmailError extends ServiceError {
  constructor(message: string) {
    super(message, "invalid_email");
  }
}

export type EmailChangeResult = {
  customerId: string;
  from: string;
  to: string;
  /** El cliente de Stripe que también se actualizó, o `null` si el cliente no tiene. */
  stripeCustomerId: string | null;
};

/**
 * Cambia el correo de un cliente (DECISIONS A35). Solo lo usa `npm run customer:change-email`, que
 * corre quien mantiene el sistema a pedido de Ferro: no hay una ruta pública ni un panel.
 *
 * En una transacción: valida y normaliza los dos correos, bloquea al cliente, revisa que el correo
 * nuevo no sea de otro cliente, lo cambia y lo audita (`customer.email_changed`, sin los correos en
 * la metadata). Si el cliente tiene un cliente de Stripe, actualiza su correo **dentro** de la
 * transacción: si Stripe falla, no cambia nada. Contratos, pagos y suscripción están ligados al
 * cliente, no al correo, así que su historial se conserva.
 */
export async function changeCustomerEmail(
  input: { from: string; to: string },
  stripe: Pick<Stripe, "customers"> | null,
  db: Db = getPrisma(),
): Promise<EmailChangeResult> {
  const from = parseEmail(input.from);
  const to = parseEmail(input.to);
  if (from === to) throw new InvalidEmailError("El correo nuevo es igual al actual.");

  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "customers" WHERE "email" = ${from} FOR UPDATE`;
    const customerId = locked[0]?.id;
    if (!customerId) throw new NotFoundError("Cliente", from);
    const taken = await tx.customer.findUnique({ where: { email: to }, select: { id: true } });
    if (taken) throw new EmailInUseError();

    const customer = await tx.customer.update({
      where: { id: customerId },
      data: { email: to },
      select: { stripeCustomerId: true },
    });
    await recordAudit(
      {
        action: "customer.email_changed",
        actor: "system",
        entityType: "Customer",
        entityId: customerId,
        metadata: {
          via: "npm run customer:change-email",
          stripeUpdated: Boolean(customer.stripeCustomerId),
        },
      },
      tx,
    );
    if (customer.stripeCustomerId) {
      if (!stripe) {
        throw new ServiceError(
          "El cliente tiene un cliente de Stripe y STRIPE_SECRET_KEY no está definida: no se cambió nada.",
          "stripe_not_configured",
        );
      }
      // Los recibos y facturas de Stripe van a este correo.
      await stripe.customers.update(customer.stripeCustomerId, { email: to });
    }
    return { customerId, from, to, stripeCustomerId: customer.stripeCustomerId };
  });
}

function parseEmail(value: string): string {
  const parsed = emailSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidEmailError(
      `${value}: ${parsed.error.issues[0]?.message ?? "correo inválido"}`,
    );
  }
  return parsed.data;
}
