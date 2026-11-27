import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";

import {
  changeCustomerEmail,
  findCustomerIdByEmail,
  upsertVerifiedCustomer,
} from "./customer.service";
import { EmailInUseError, NotFoundError } from "./errors";

describe.skipIf(!testDatabaseUrl)("customer.service con PostgreSQL (RF-16)", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);

  beforeEach(() => truncateAll(prisma));
  afterAll(() => prisma.$disconnect());

  const data = {
    fullName: "Ana López",
    email: "  Ana.Lopez@Example.COM ",
    whatsapp: "+525512345678",
  };

  it("crea el cliente con el correo y el WhatsApp normalizados", async () => {
    const customer = await upsertVerifiedCustomer(data, prisma);
    expect(customer.email).toBe("ana.lopez@example.com");
    expect(customer.whatsapp).toBe("+525512345678");
    expect(customer).not.toHaveProperty("country");
  });

  it("si el correo ya existe, actualiza nombre y WhatsApp en lugar de duplicar (DECISIONS A4)", async () => {
    const first = await upsertVerifiedCustomer(data, prisma);
    const second = await upsertVerifiedCustomer(
      { fullName: "Ana López Ruiz", email: "ANA.LOPEZ@example.com", whatsapp: "+14155552671" },
      prisma,
    );
    expect(second.id).toBe(first.id);
    expect(second.fullName).toBe("Ana López Ruiz");
    expect(second.whatsapp).toBe("+14155552671");
    expect(await prisma.customer.count()).toBe(1);
  });

  it("no duplica el cliente con solicitudes simultáneas del mismo correo", async () => {
    await Promise.all(Array.from({ length: 10 }, () => upsertVerifiedCustomer(data, prisma)));
    expect(await prisma.customer.count()).toBe(1);
  });

  it("rechaza datos inválidos, incluido un WhatsApp que no está en E.164", async () => {
    await expect(
      upsertVerifiedCustomer({ ...data, email: "no-es-correo" }, prisma),
    ).rejects.toThrow();
    await expect(
      upsertVerifiedCustomer({ ...data, whatsapp: "5512345678" }, prisma),
    ).rejects.toThrow();
    expect(await prisma.customer.count()).toBe(0);
  });

  it("busca por correo normalizado", async () => {
    const customer = await upsertVerifiedCustomer(data, prisma);
    expect(await findCustomerIdByEmail(" ANA.lopez@EXAMPLE.com", prisma)).toBe(customer.id);
    expect(await findCustomerIdByEmail("otra@example.com", prisma)).toBeNull();
  });

  it("la BD rechaza correos sin normalizar y WhatsApp fuera de E.164 aunque se salten el servicio", async () => {
    await expect(
      prisma.customer.create({
        data: { fullName: "X", email: "Mayus@Example.com", whatsapp: "+525512345678" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.customer.create({
        data: { fullName: "X", email: "x@example.com", whatsapp: "5512345678" },
      }),
    ).rejects.toThrow();
  });

  describe("changeCustomerEmail (npm run customer:change-email, DECISIONS A35)", () => {
    function fakeStripe(fail = false) {
      const updates: Array<{ id: string; email: unknown }> = [];
      return {
        updates,
        stripe: {
          customers: {
            update: async (id: string, params: { email?: string }) => {
              if (fail) throw new Error("Stripe caído");
              updates.push({ id, email: params.email });
              return { id };
            },
          },
        } as never,
      };
    }

    it("cambia el correo en la BD y en Stripe, conserva el historial y lo audita", async () => {
      const customer = await upsertVerifiedCustomer(data, prisma);
      await prisma.customer.update({
        where: { id: customer.id },
        data: { stripeCustomerId: "cus_test_1" },
      });
      const { stripe, updates } = fakeStripe();
      const result = await changeCustomerEmail(
        { from: "ANA.LOPEZ@example.com", to: "  Ana@Nuevo.MX " },
        stripe,
        prisma,
      );
      expect(result).toEqual({
        customerId: customer.id,
        from: "ana.lopez@example.com",
        to: "ana@nuevo.mx",
        stripeCustomerId: "cus_test_1",
      });
      expect(await findCustomerIdByEmail("ana@nuevo.mx", prisma)).toBe(customer.id);
      expect(await findCustomerIdByEmail("ana.lopez@example.com", prisma)).toBeNull();
      expect(updates).toEqual([{ id: "cus_test_1", email: "ana@nuevo.mx" }]);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "customer.email_changed" },
      });
      expect(audit).toMatchObject({ entityId: customer.id, actor: "system" });
      // Sin los correos en la auditoría.
      expect(JSON.stringify(audit.metadata)).not.toContain("@");
    });

    it("sin cliente de Stripe solo cambia la BD", async () => {
      await upsertVerifiedCustomer(data, prisma);
      const result = await changeCustomerEmail(
        { from: data.email, to: "ana@nuevo.mx" },
        null,
        prisma,
      );
      expect(result.stripeCustomerId).toBeNull();
    });

    it("si Stripe falla, no cambia nada", async () => {
      const customer = await upsertVerifiedCustomer(data, prisma);
      await prisma.customer.update({
        where: { id: customer.id },
        data: { stripeCustomerId: "cus_test_1" },
      });
      await expect(
        changeCustomerEmail(
          { from: data.email, to: "ana@nuevo.mx" },
          fakeStripe(true).stripe,
          prisma,
        ),
      ).rejects.toThrow("Stripe caído");
      await expect(
        changeCustomerEmail({ from: data.email, to: "ana@nuevo.mx" }, null, prisma),
      ).rejects.toThrow("STRIPE_SECRET_KEY");
      expect(await findCustomerIdByEmail("ana.lopez@example.com", prisma)).toBe(customer.id);
      expect(await prisma.auditLog.count({ where: { action: "customer.email_changed" } })).toBe(0);
    });

    it("rechaza un correo inválido, igual, desconocido o que ya es de otro cliente", async () => {
      await upsertVerifiedCustomer(data, prisma);
      await upsertVerifiedCustomer({ ...data, email: "otro@example.com" }, prisma);
      const change = (from: string, to: string) => changeCustomerEmail({ from, to }, null, prisma);
      await expect(change(data.email, "no-es-correo")).rejects.toThrow("válido");
      await expect(change(data.email, "ANA.lopez@example.com")).rejects.toThrow("igual");
      await expect(change("nadie@example.com", "x@example.com")).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(change(data.email, "OTRO@example.com")).rejects.toBeInstanceOf(EmailInUseError);
    });
  });
});
