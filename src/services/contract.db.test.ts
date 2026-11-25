import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";
import { isContractReference } from "@/utils/reference";

import {
  activateContract,
  cancelContract,
  completeContract,
  completeExpiredContracts,
  createContract,
  markContractPaymentFailed,
  nextContractReference,
} from "./contract.service";
import { upsertVerifiedCustomer } from "./customer.service";
import {
  InvalidContractTransitionError,
  InvalidServicePeriodError,
  NotFoundError,
  ProgramUnavailableError,
} from "./errors";
import { syncProgramCatalog } from "./program.service";

describe.skipIf(!testDatabaseUrl)("contract.service con PostgreSQL", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  let customerId: string;

  const period = {
    serviceStartDate: new Date("2026-12-01T00:00:00Z"),
    serviceEndDate: new Date("2027-01-01T00:00:00Z"),
  };

  beforeEach(async () => {
    await truncateAll(prisma);
    await syncProgramCatalog(prisma);
    const customer = await upsertVerifiedCustomer(
      { fullName: "Ana López", email: "ana@example.com", whatsapp: "+525512345678" },
      prisma,
    );
    customerId = customer.id;
  });
  afterAll(() => prisma.$disconnect());

  // Un cliente nuevo por contrato: cada cliente puede tener solo un pendiente (DECISIONS A20).
  let customerCounter = 0;
  const create = async (
    programSlug = "hm-complete",
    paymentType: "transfer" | "one_time" | "subscription" = "transfer",
  ) => {
    const customer = await upsertVerifiedCustomer(
      {
        fullName: "Cliente",
        email: `cliente${++customerCounter}@example.com`,
        whatsapp: "+525512345678",
      },
      prisma,
    );
    return createContract({ customerId: customer.id, programSlug, paymentType }, prisma);
  };

  describe("creación", () => {
    it("crea el contrato pending_payment con el importe del programa en la BD", async () => {
      await prisma.program.update({
        where: { slug: "hm-complete" },
        data: { monthlyPrice: new Prisma.Decimal("1899.99") },
      });
      const contract = await create();
      expect(contract.status).toBe("pending_payment");
      expect(contract.amount.toFixed(2)).toBe("1899.99");
      expect(contract.amount).toBeInstanceOf(Prisma.Decimal);
      expect(contract.currency).toBe("MXN");
      expect(isContractReference(contract.reference)).toBe(true);
      expect(contract.serviceStartDate).toBeNull();
    });

    it("un programa tiene muchos contratos (DECISIONS A2)", async () => {
      await create();
      await create();
      const program = await prisma.program.findUniqueOrThrow({
        where: { slug: "hm-complete" },
        include: { contracts: true },
      });
      expect(program.contracts).toHaveLength(2);
    });

    it("rechaza un programa inexistente o inactivo", async () => {
      await expect(create("hm-yoga")).rejects.toThrow(ProgramUnavailableError);
      await prisma.program.update({ where: { slug: "hm-run" }, data: { active: false } });
      await expect(create("hm-run")).rejects.toThrow(ProgramUnavailableError);
      expect(await prisma.contract.count()).toBe(0);
    });
  });

  describe("referencias HM-AAAA-NNNNNN", () => {
    it("son consecutivas y llevan el año en hora de México", async () => {
      const a = await nextContractReference(prisma, new Date("2026-06-01T12:00:00Z"));
      const b = await nextContractReference(prisma, new Date("2026-06-01T12:00:00Z"));
      expect(a).toMatch(/^HM-2026-\d{6}$/);
      expect(Number(b.slice(-6))).toBe(Number(a.slice(-6)) + 1);
    });

    it("no se repiten con creaciones simultáneas", async () => {
      const contracts = await Promise.all(Array.from({ length: 40 }, () => create()));
      const references = new Set(contracts.map((c) => c.reference));
      expect(references.size).toBe(40);
    });

    it("la BD rechaza una referencia duplicada o con formato inválido", async () => {
      const contract = await create();
      const program = await prisma.program.findUniqueOrThrow({ where: { slug: "hm-run" } });
      const base = {
        customerId,
        programId: program.id,
        paymentType: "transfer" as const,
        amount: new Prisma.Decimal("1200.00"),
        currency: "MXN",
      };
      await expect(
        prisma.contract.create({ data: { ...base, reference: contract.reference } }),
      ).rejects.toThrow();
      await expect(
        prisma.contract.create({ data: { ...base, reference: "HM-26-1" } }),
      ).rejects.toThrow();
    });
  });

  describe("transiciones", () => {
    it("pending_payment → active asigna el periodo de servicio", async () => {
      const contract = await create();
      const active = await activateContract(contract.id, period, prisma);
      expect(active.status).toBe("active");
      expect(active.serviceStartDate).toEqual(period.serviceStartDate);
      expect(active.serviceEndDate).toEqual(period.serviceEndDate);
    });

    it("no activa dos veces el mismo contrato", async () => {
      const contract = await create();
      await activateContract(contract.id, period, prisma);
      await expect(activateContract(contract.id, period, prisma)).rejects.toThrow(
        InvalidContractTransitionError,
      );
    });

    it("con activaciones simultáneas (webhook duplicado) solo una gana", async () => {
      const contract = await create();
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => activateContract(contract.id, period, prisma)),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(InvalidContractTransitionError);
      }
    });

    it("rechaza un periodo con fin anterior al inicio", async () => {
      const contract = await create();
      await expect(
        activateContract(
          contract.id,
          { serviceStartDate: period.serviceEndDate, serviceEndDate: period.serviceStartDate },
          prisma,
        ),
      ).rejects.toThrow(InvalidServicePeriodError);
    });

    it("active → payment_failed → active → cancelled", async () => {
      const contract = await create("hm-run", "subscription");
      await activateContract(contract.id, period, prisma);
      expect((await markContractPaymentFailed(contract.id, prisma)).status).toBe("payment_failed");
      expect((await activateContract(contract.id, period, prisma)).status).toBe("active");
      expect((await cancelContract(contract.id, prisma)).status).toBe("cancelled");
      await expect(activateContract(contract.id, period, prisma)).rejects.toThrow(
        InvalidContractTransitionError,
      );
    });

    it("payment_failed → cancelled", async () => {
      const contract = await create("hm-run", "subscription");
      await activateContract(contract.id, period, prisma);
      await markContractPaymentFailed(contract.id, prisma);
      expect((await cancelContract(contract.id, prisma)).status).toBe("cancelled");
    });

    it("rechaza transiciones desde pending_payment que no sean activar", async () => {
      const contract = await create();
      await expect(cancelContract(contract.id, prisma)).rejects.toThrow(
        InvalidContractTransitionError,
      );
      await expect(markContractPaymentFailed(contract.id, prisma)).rejects.toThrow(
        InvalidContractTransitionError,
      );
      await expect(completeContract(contract.id, prisma)).rejects.toThrow(
        InvalidContractTransitionError,
      );
      const unchanged = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(unchanged.status).toBe("pending_payment");
    });

    it("completa solo contratos de pago único o transferencia ya vencidos", async () => {
      const contract = await create();
      await activateContract(contract.id, period, prisma);
      await expect(
        completeContract(contract.id, prisma, new Date("2026-12-15T00:00:00Z")),
      ).rejects.toThrow(InvalidServicePeriodError);
      const done = await completeContract(contract.id, prisma, new Date("2027-01-02T00:00:00Z"));
      expect(done.status).toBe("completed");

      const sub = await create("hm-run", "subscription");
      await activateContract(sub.id, period, prisma);
      await expect(
        completeContract(sub.id, prisma, new Date("2027-01-02T00:00:00Z")),
      ).rejects.toThrow(InvalidServicePeriodError);
    });

    it("completeExpiredContracts marca solo los vencidos que no se renuevan", async () => {
      const expired = await create("hm-run", "one_time");
      const current = await create("hm-run", "transfer");
      const sub = await create("hm-run", "subscription");
      const pending = await create("hm-run", "transfer");
      await activateContract(expired.id, period, prisma);
      await activateContract(
        current.id,
        { ...period, serviceEndDate: new Date("2027-02-01T00:00:00Z") },
        prisma,
      );
      await activateContract(sub.id, period, prisma);

      const count = await completeExpiredContracts(prisma, new Date("2027-01-15T00:00:00Z"));
      expect(count).toBe(1);
      const status = async (id: string) =>
        (await prisma.contract.findUniqueOrThrow({ where: { id } })).status;
      expect(await status(expired.id)).toBe("completed");
      expect(await status(current.id)).toBe("active");
      expect(await status(sub.id)).toBe("active");
      expect(await status(pending.id)).toBe("pending_payment");
    });

    it("informa si el contrato no existe", async () => {
      await expect(cancelContract("00000000-0000-0000-0000-000000000000", prisma)).rejects.toThrow(
        NotFoundError,
      );
    });

    it("se combina con otras escrituras en una sola transacción", async () => {
      const contract = await create();
      await expect(
        prisma.$transaction(async (tx) => {
          await activateContract(contract.id, period, tx);
          throw new Error("falla después de activar");
        }),
      ).rejects.toThrow("falla después de activar");
      const unchanged = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
      expect(unchanged.status).toBe("pending_payment");
    });
  });
});
