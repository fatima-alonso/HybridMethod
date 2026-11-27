import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PROGRAMS } from "@/content/programs";
import { Prisma } from "@/generated/prisma/client";
import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";

import { recordAudit } from "./audit.service";
import { getLandingPrograms, syncProgramCatalog } from "./program.service";

describe.skipIf(!testDatabaseUrl)("esquema y seed con PostgreSQL (SDD §5, RNF-07)", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);

  beforeEach(() => truncateAll(prisma));
  afterAll(() => prisma.$disconnect());

  describe("seed de programas", () => {
    it("crea los tres programas con sus precios como Decimal", async () => {
      await syncProgramCatalog(prisma);
      const programs = await prisma.program.findMany({ orderBy: { displayOrder: "asc" } });
      expect(programs.map((p) => [p.slug, p.monthlyPrice.toFixed(2), p.currency])).toEqual(
        PROGRAMS.map((p) => [p.slug, p.monthlyPrice, "MXN"]),
      );
      expect(programs.every((p) => p.active)).toBe(true);
    });

    it("es idempotente y no toca los Price IDs de Stripe", async () => {
      await syncProgramCatalog(prisma);
      await prisma.program.update({
        where: { slug: "hm-run" },
        data: { stripePriceIdOneTime: "price_one", stripePriceIdRecurring: "price_rec" },
      });
      await syncProgramCatalog(prisma);
      expect(await prisma.program.count()).toBe(3);
      const run = await prisma.program.findUniqueOrThrow({ where: { slug: "hm-run" } });
      expect(run.stripePriceIdOneTime).toBe("price_one");
      expect(run.stripePriceIdRecurring).toBe("price_rec");
    });

    it("la landing lee de la BD solo los programas activos, en orden", async () => {
      await syncProgramCatalog(prisma);
      await prisma.program.update({
        where: { slug: "hm-strength" },
        data: { active: false },
      });
      await prisma.program.update({
        where: { slug: "hm-run" },
        data: { monthlyPrice: new Prisma.Decimal("1300") },
      });
      const programs = await getLandingPrograms(prisma);
      expect(programs.map((p) => [p.slug, p.monthlyPrice])).toEqual([
        ["hm-run", "1300.00"],
        ["hm-complete", "1800.00"],
      ]);
    });
  });

  describe("restricciones", () => {
    it("rechaza precios no positivos", async () => {
      await expect(
        prisma.program.create({
          data: {
            slug: "x",
            name: "X",
            description: "",
            monthlyPrice: new Prisma.Decimal("0"),
            subscriptionPrice: new Prisma.Decimal("0"),
          },
        }),
      ).rejects.toThrow();
    });

    it("el precio con suscripción no puede ser mayor que el precio completo (A18)", async () => {
      await expect(
        prisma.program.create({
          data: {
            slug: "x",
            name: "X",
            description: "",
            monthlyPrice: new Prisma.Decimal("100"),
            subscriptionPrice: new Prisma.Decimal("101"),
          },
        }),
      ).rejects.toThrow();
    });

    it("stripeEventId es UNIQUE (idempotencia de webhooks, RN-11)", async () => {
      await prisma.webhookEvent.create({
        data: { stripeEventId: "evt_1", eventType: "invoice.paid" },
      });
      await expect(
        prisma.webhookEvent.create({ data: { stripeEventId: "evt_1", eventType: "invoice.paid" } }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("no permite borrar un programa o cliente con contratos (FK)", async () => {
      const [program] = await syncProgramCatalog(prisma);
      const customer = await prisma.customer.create({
        data: { fullName: "Ana", email: "ana@example.com", whatsapp: "+525512345678" },
      });
      await prisma.contract.create({
        data: {
          reference: "HM-2026-999999",
          customerId: customer.id,
          programId: program.id,
          paymentType: "transfer",
          amount: program.monthlyPrice,
          currency: "MXN",
        },
      });
      await expect(prisma.program.delete({ where: { id: program.id } })).rejects.toThrow();
      await expect(prisma.customer.delete({ where: { id: customer.id } })).rejects.toThrow();
    });

    it("un contrato activo necesita su periodo de servicio", async () => {
      const [program] = await syncProgramCatalog(prisma);
      const customer = await prisma.customer.create({
        data: { fullName: "Ana", email: "ana@example.com", whatsapp: "+525512345678" },
      });
      await expect(
        prisma.contract.create({
          data: {
            reference: "HM-2026-999998",
            customerId: customer.id,
            programId: program.id,
            paymentType: "transfer",
            status: "active",
            amount: program.monthlyPrice,
            currency: "MXN",
          },
        }),
      ).rejects.toThrow();
    });

    it("un pago de $0 solo se admite con un descuento que lo cubra (cortesía, A34)", async () => {
      const [program] = await syncProgramCatalog(prisma);
      const customer = await prisma.customer.create({
        data: { fullName: "Ana", email: "ana@example.com", whatsapp: "+525512345678" },
      });
      const contract = await prisma.contract.create({
        data: {
          reference: "HM-2026-999996",
          customerId: customer.id,
          programId: program.id,
          paymentType: "one_time",
          amount: program.monthlyPrice,
          currency: "MXN",
        },
      });
      const payment = (data: Record<string, unknown>) =>
        prisma.payment.create({
          data: {
            contractId: contract.id,
            method: "stripe_one_time",
            currency: "MXN",
            status: "succeeded",
            amount: "0",
            ...data,
          },
        });
      await expect(payment({})).rejects.toThrow();
      await expect(payment({ discountAmount: "0" })).rejects.toThrow();
      await expect(payment({ amount: "-1", discountAmount: "1" })).rejects.toThrow();
      await expect(payment({ discountAmount: "1200.00" })).resolves.toBeTruthy();
    });

    it("TransferApproval no admite más de 5 intentos de PIN", async () => {
      const [program] = await syncProgramCatalog(prisma);
      const customer = await prisma.customer.create({
        data: { fullName: "Ana", email: "ana@example.com", whatsapp: "+525512345678" },
      });
      const contract = await prisma.contract.create({
        data: {
          reference: "HM-2026-999997",
          customerId: customer.id,
          programId: program.id,
          paymentType: "transfer",
          amount: program.monthlyPrice,
          currency: "MXN",
        },
      });
      await expect(
        prisma.transferApproval.create({
          data: {
            contractId: contract.id,
            tokenHash: "h",
            expiresAt: new Date(),
            pinAttempts: 6,
          },
        }),
      ).rejects.toThrow();
    });
  });

  it("guarda entradas de auditoría", async () => {
    const entry = await recordAudit(
      {
        action: "transfer.link_regenerated",
        actor: "ferro",
        entityType: "Contract",
        entityId: "c1",
        metadata: { reference: "HM-2026-000001" },
      },
      prisma,
    );
    expect(entry.metadata).toEqual({ reference: "HM-2026-000001" });
  });
});
