import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { hashToken } from "@/lib/crypto";
import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";
import { isContractReference } from "@/utils/reference";

import {
  ActivePeriodError,
  PendingContractExistsError,
  ProgramUnavailableError,
  SubscriptionActiveError,
} from "./errors";
import { syncProgramCatalog } from "./program.service";

const sendTransferPendingEmail = vi.fn();
vi.mock("./email.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email.service")>()),
  sendTransferPendingEmail: (...args: unknown[]) => sendTransferPendingEmail(...args),
}));

const { createTransferApproval, requestTransfer, transferConfirmUrl } =
  await import("./transfer.service");

describe.skipIf(!testDatabaseUrl)("transfer.service con PostgreSQL (RF-09)", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  const now = new Date("2026-11-24T10:00:00Z");
  const input = {
    verifiedEmail: "ana@example.com",
    fullName: "Ana López",
    whatsapp: "+525512345678",
    programSlug: "hm-run",
  };

  beforeEach(async () => {
    await truncateAll(prisma);
    await syncProgramCatalog(prisma);
    sendTransferPendingEmail.mockReset().mockResolvedValue({ mode: "console" });
  });
  afterAll(() => prisma.$disconnect());

  const sentToken = (): string => {
    const call = sendTransferPendingEmail.mock.calls.at(-1)?.[0] as { confirmUrl: string };
    return call.confirmUrl.split("/").at(-1) ?? "";
  };

  it("crea el cliente, el contrato pending_payment con el importe de la BD y el enlace", async () => {
    await prisma.program.update({
      where: { slug: "hm-run" },
      data: { monthlyPrice: new Prisma.Decimal("1350.50") },
    });
    const result = await requestTransfer(input, { ip: "1.2.3.4", userAgent: "test" }, prisma, now);

    expect(result.created).toBe(true);
    expect(result.customer).toMatchObject({ email: "ana@example.com", fullName: "Ana López" });
    expect(result.contract).toMatchObject({ status: "pending_payment", paymentType: "transfer" });
    expect(isContractReference(result.contract.reference)).toBe(true);
    expect(result.contract.amount.toFixed(2)).toBe("1350.50");
    expect(result.program.slug).toBe("hm-run");

    const approval = await prisma.transferApproval.findFirstOrThrow();
    const token = sentToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(approval.tokenHash).toBe(hashToken(token));
    expect(approval.tokenHash).not.toContain(token);
    expect(approval.expiresAt.getTime() - now.getTime()).toBe(7 * 24 * 3600_000);
    expect(approval).toMatchObject({ usedAt: null, invalidatedAt: null, pinAttempts: 0 });

    const audit = await prisma.auditLog.findFirstOrThrow();
    expect(audit).toMatchObject({
      action: "transfer.requested",
      actor: `customer:${result.customer.id}`,
      entityId: result.contract.id,
      ip: "1.2.3.4",
    });
    expect(JSON.stringify(audit.metadata)).not.toContain(token);
  });

  it("avisa a Ferro con los datos del contrato y el enlace privado", async () => {
    const { contract } = await requestTransfer(input, {}, prisma, now);
    expect(sendTransferPendingEmail).toHaveBeenCalledTimes(1);
    expect(sendTransferPendingEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: contract.reference,
        customerName: "Ana López",
        customerEmail: "ana@example.com",
        customerWhatsapp: "+525512345678",
        programName: "HM RUN",
        confirmUrl: transferConfirmUrl(sentToken()),
      }),
    );
    expect(transferConfirmUrl("abc", "https://hm.example")).toBe(
      "https://hm.example/transfer/confirm/abc",
    );
  });

  it("asocia la contratación a un cliente existente y actualiza nombre y WhatsApp (A4)", async () => {
    const first = await requestTransfer(input, {}, prisma, now);
    const second = await requestTransfer(
      {
        ...input,
        fullName: "Ana María López",
        whatsapp: "+34612345678",
        programSlug: "hm-complete",
        pendingAction: "change",
      },
      {},
      prisma,
      now,
    );
    expect(second.customer.id).toBe(first.customer.id);
    expect(second.customer).toMatchObject({
      fullName: "Ana María López",
      whatsapp: "+34612345678",
    });
    expect(await prisma.customer.count()).toBe(1);
  });

  it("un doble envío en la misma sesión no duplica el contrato ni el correo", async () => {
    const [a, b] = await Promise.all([
      requestTransfer(input, {}, prisma, now),
      requestTransfer(input, {}, prisma, now),
    ]);
    expect(a.contract.id).toBe(b.contract.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(await prisma.contract.count()).toBe(1);
    expect(await prisma.transferApproval.count()).toBe(1);
    expect(sendTransferPendingEmail).toHaveBeenCalledTimes(1);
  });

  it("rechaza un programa inactivo sin crear nada", async () => {
    await prisma.program.update({ where: { slug: "hm-run" }, data: { active: false } });
    await expect(requestTransfer(input, {}, prisma, now)).rejects.toBeInstanceOf(
      ProgramUnavailableError,
    );
    expect(await prisma.contract.count()).toBe(0);
    expect(await prisma.customer.count()).toBe(0);
  });

  it("si falla el correo a Ferro, conserva el contrato y lo registra en la auditoría", async () => {
    sendTransferPendingEmail.mockRejectedValue(new Error("resend caído"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { contract } = await requestTransfer(input, {}, prisma, now);
    expect(contract.status).toBe("pending_payment");
    const actions = (await prisma.auditLog.findMany()).map((a) => a.action).sort();
    expect(actions).toEqual(["transfer.notification_failed", "transfer.requested"]);
    expect(error).toHaveBeenCalled();
  });

  it("un enlace nuevo deja sin efecto los anteriores", async () => {
    const { contract } = await requestTransfer(input, {}, prisma, now);
    await createTransferApproval(contract.id, prisma, now, 7);
    const approvals = await prisma.transferApproval.findMany({ orderBy: { createdAt: "asc" } });
    expect(approvals).toHaveLength(2);
    expect(approvals.filter((a) => a.invalidatedAt === null)).toHaveLength(1);
  });

  describe("un solo pendiente por cliente (DECISIONS A20)", () => {
    const day = 24 * 3600_000;
    const later = (days: number) => new Date(now.getTime() + days * day);

    it("con otro programa pendiente pregunta antes de hacer nada", async () => {
      const { contract } = await requestTransfer(input, {}, prisma, now);
      const error = await requestTransfer(
        { ...input, programSlug: "hm-complete" },
        {},
        prisma,
        now,
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PendingContractExistsError);
      expect((error as PendingContractExistsError).pending).toEqual({
        reference: contract.reference,
        programSlug: "hm-run",
        programName: "HM RUN",
        paymentType: "transfer",
        amount: "1200.00",
        currency: "MXN",
      });
      expect(await prisma.contract.count()).toBe(1);
      expect(sendTransferPendingEmail).toHaveBeenCalledTimes(1);
    });

    it("«continuar» retoma el pendiente tal cual, sin otro correo", async () => {
      const first = await requestTransfer(input, {}, prisma, now);
      const again = await requestTransfer(
        { ...input, programSlug: "hm-complete", pendingAction: "continue" },
        {},
        prisma,
        later(1),
      );
      expect(again.outcome).toBe("continued");
      expect(again.contract).toMatchObject({ id: first.contract.id, lastActivityAt: later(1) });
      expect(again.program.slug).toBe("hm-run");
      expect(sendTransferPendingEmail).toHaveBeenCalledTimes(1);
    });

    it("«cambiar» actualiza el mismo contrato, invalida su enlace y avisa a Ferro", async () => {
      const first = await requestTransfer(input, {}, prisma, now);
      const oldToken = sentToken();
      const changed = await requestTransfer(
        { ...input, programSlug: "hm-complete", pendingAction: "change" },
        { ip: "1.2.3.4" },
        prisma,
        later(1),
      );
      expect(changed.outcome).toBe("changed");
      expect(changed.contract.id).toBe(first.contract.id);
      expect(changed.contract.reference).toBe(first.contract.reference);
      expect(changed.contract.amount.toFixed(2)).toBe("1800.00");
      expect(changed.program.slug).toBe("hm-complete");
      expect(sendTransferPendingEmail).toHaveBeenCalledTimes(2);
      const old = await prisma.transferApproval.findUniqueOrThrow({
        where: { tokenHash: hashToken(oldToken) },
      });
      expect(old.invalidatedAt).toEqual(later(1));
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "contract.pending_changed" },
      });
      expect(audit.metadata).toMatchObject({
        from: { program: "hm-run", paymentType: "transfer" },
        to: { program: "hm-complete", paymentType: "transfer" },
      });
    });

    it("mismo programa: reutiliza el pendiente; si su enlace ya no sirve, genera otro", async () => {
      const first = await requestTransfer(input, {}, prisma, now);
      const reused = await requestTransfer(input, {}, prisma, later(1));
      expect(reused.outcome).toBe("reused");
      expect(reused.contract.id).toBe(first.contract.id);
      expect(sendTransferPendingEmail).toHaveBeenCalledTimes(1);

      // El enlace vence a los 7 días, pero el contrato sigue vivo por la actividad del día 1.
      const again = await requestTransfer(input, {}, prisma, later(7.5));
      expect(again.contract.id).toBe(first.contract.id);
      expect(sendTransferPendingEmail).toHaveBeenCalledTimes(2);
      expect(await prisma.auditLog.count({ where: { action: "transfer.link_regenerated" } })).toBe(
        1,
      );
    });

    it("un pendiente con 7 días sin actividad vence y se crea otro contrato", async () => {
      const first = await requestTransfer(input, {}, prisma, now);
      const second = await requestTransfer(
        { ...input, programSlug: "hm-complete" },
        {},
        prisma,
        later(7),
      );
      expect(second.outcome).toBe("created");
      expect(second.contract.id).not.toBe(first.contract.id);
      expect(
        (await prisma.contract.findUniqueOrThrow({ where: { id: first.contract.id } })).status,
      ).toBe("expired");
    });

    it("la BD impide dos pendientes del mismo cliente", async () => {
      const { contract } = await requestTransfer(input, {}, prisma, now);
      await expect(
        prisma.contract.create({
          data: {
            reference: "HM-2026-999999",
            customerId: contract.customerId,
            programId: contract.programId,
            paymentType: "transfer",
            amount: contract.amount,
            currency: "MXN",
          },
        }),
      ).rejects.toThrow();
    });

    it("con una suscripción activa no se crea otra contratación", async () => {
      const { contract, customer, program } = await requestTransfer(input, {}, prisma, now);
      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          status: "active",
          paymentType: "subscription",
          serviceStartDate: now,
          serviceEndDate: later(30),
        },
      });
      await prisma.subscription.create({
        data: {
          customerId: customer.id,
          programId: program.id,
          contractId: contract.id,
          stripeSubscriptionId: "sub_test",
          status: "past_due",
        },
      });
      await expect(requestTransfer(input, {}, prisma, later(1))).rejects.toBeInstanceOf(
        SubscriptionActiveError,
      );
    });

    it("mes con mes: con un mes pagado vigente rechaza otra contratación hasta que termine (A28)", async () => {
      const { contract } = await requestTransfer(input, {}, prisma, now);
      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: "active", serviceStartDate: now, serviceEndDate: later(30) },
      });
      const error = await requestTransfer(input, {}, prisma, later(1)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ActivePeriodError);
      expect((error as ActivePeriodError).activeUntil).toEqual(later(30));
      // El día en que termina ya puede pagar su siguiente mes.
      const next = await requestTransfer(input, {}, prisma, later(30));
      expect(next.outcome).toBe("created");
    });
  });
});
