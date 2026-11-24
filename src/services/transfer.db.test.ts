import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { hashToken } from "@/lib/crypto";
import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";
import { isContractReference } from "@/utils/reference";

import { ProgramUnavailableError } from "./errors";
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
    verifiedAt: new Date(Date.now() - 60_000),
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
        verifiedAt: new Date(),
        fullName: "Ana María López",
        whatsapp: "+34612345678",
        programSlug: "hm-complete",
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
    expect(await prisma.contract.count()).toBe(2);
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
});
