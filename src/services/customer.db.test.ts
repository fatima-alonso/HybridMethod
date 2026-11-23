import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";

import { findCustomerIdByEmail, upsertVerifiedCustomer } from "./customer.service";

describe.skipIf(!testDatabaseUrl)("customer.service con PostgreSQL (RF-16)", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);

  beforeEach(() => truncateAll(prisma));
  afterAll(() => prisma.$disconnect());

  const data = {
    fullName: "Ana López",
    email: "  Ana.Lopez@Example.COM ",
    whatsapp: "55 1234 5678",
  };

  it("crea el cliente con el correo y el WhatsApp normalizados", async () => {
    const customer = await upsertVerifiedCustomer(data, prisma);
    expect(customer.email).toBe("ana.lopez@example.com");
    expect(customer.whatsapp).toBe("5512345678");
    expect(customer).not.toHaveProperty("country");
  });

  it("si el correo ya existe, actualiza nombre y WhatsApp en lugar de duplicar (DECISIONS A4)", async () => {
    const first = await upsertVerifiedCustomer(data, prisma);
    const second = await upsertVerifiedCustomer(
      { fullName: "Ana López Ruiz", email: "ANA.LOPEZ@example.com", whatsapp: "+52 55 9999 0000" },
      prisma,
    );
    expect(second.id).toBe(first.id);
    expect(second.fullName).toBe("Ana López Ruiz");
    expect(second.whatsapp).toBe("+525599990000");
    expect(await prisma.customer.count()).toBe(1);
  });

  it("no duplica el cliente con solicitudes simultáneas del mismo correo", async () => {
    await Promise.all(Array.from({ length: 10 }, () => upsertVerifiedCustomer(data, prisma)));
    expect(await prisma.customer.count()).toBe(1);
  });

  it("rechaza datos inválidos", async () => {
    await expect(
      upsertVerifiedCustomer({ ...data, email: "no-es-correo" }, prisma),
    ).rejects.toThrow();
    expect(await prisma.customer.count()).toBe(0);
  });

  it("busca por correo normalizado", async () => {
    const customer = await upsertVerifiedCustomer(data, prisma);
    expect(await findCustomerIdByEmail(" ANA.lopez@EXAMPLE.com", prisma)).toBe(customer.id);
    expect(await findCustomerIdByEmail("otra@example.com", prisma)).toBeNull();
  });

  it("la BD rechaza correos sin normalizar aunque se salten el servicio", async () => {
    await expect(
      prisma.customer.create({
        data: { fullName: "X", email: "Mayus@Example.com", whatsapp: "5512345678" },
      }),
    ).rejects.toThrow();
  });
});
