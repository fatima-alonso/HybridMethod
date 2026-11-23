import type { Customer } from "@/generated/prisma/client";
import { getPrisma, type Db } from "@/lib/prisma";
import { customerDataSchema, normalizeEmail, type CustomerDataInput } from "@/lib/validations";

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
