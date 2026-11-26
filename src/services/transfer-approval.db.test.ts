import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashApprovalPin } from "@/lib/approval-pin";
import { ApprovalPinNotConfiguredError } from "@/lib/approval-pin";
import { hashToken } from "@/lib/crypto";
import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";

import {
  ContractNotPendingError,
  InvalidApprovalPinError,
  NotFoundError,
  TransferLinkUnavailableError,
} from "./errors";
import { syncProgramCatalog } from "./program.service";

const sendTransferPendingEmail = vi.fn();
const sendTransferConfirmedEmail = vi.fn();
const sendWelcomeEmail = vi.fn();
const sendPaymentReceivedEmail = vi.fn();
vi.mock("./email.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email.service")>()),
  sendTransferPendingEmail: (...args: unknown[]) => sendTransferPendingEmail(...args),
  sendTransferConfirmedEmail: (...args: unknown[]) => sendTransferConfirmedEmail(...args),
  sendWelcomeEmail: (...args: unknown[]) => sendWelcomeEmail(...args),
  sendPaymentReceivedEmail: (...args: unknown[]) => sendPaymentReceivedEmail(...args),
}));

const { requestTransfer } = await import("./transfer.service");
const { confirmTransfer, getTransferApprovalView, regenerateTransferLink } =
  await import("./transfer-approval.service");

const PIN = "482917";
const WRONG_PIN = "111222";

describe.skipIf(!testDatabaseUrl)(
  "transfer-approval.service con PostgreSQL (RF-11, RF-12, RF-20)",
  () => {
    const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
    const createdAt = new Date("2026-11-24T16:00:00Z");
    const now = new Date("2026-11-25T16:30:00Z");
    const context = { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Ferro)" };
    let pinHash: string;

    beforeAll(async () => {
      pinHash = await hashApprovalPin(PIN, 4);
    });
    beforeEach(async () => {
      await truncateAll(prisma);
      await syncProgramCatalog(prisma);
      for (const mock of [
        sendTransferPendingEmail,
        sendTransferConfirmedEmail,
        sendWelcomeEmail,
        sendPaymentReceivedEmail,
      ]) {
        mock.mockReset().mockResolvedValue({ mode: "console" });
      }
    });
    afterAll(() => prisma.$disconnect());

    const lastToken = (): string => {
      const call = sendTransferPendingEmail.mock.calls.at(-1)?.[0] as { confirmUrl: string };
      return call.confirmUrl.split("/").at(-1) ?? "";
    };

    async function pendingTransfer(email = "ana@example.com") {
      const result = await requestTransfer(
        {
          verifiedEmail: email,
          fullName: "Ana López",
          whatsapp: "+525512345678",
          programSlug: "hm-run",
        },
        {},
        prisma,
        createdAt,
      );
      return { ...result, token: lastToken() };
    }

    const confirm = (token: string, pin: string, at: Date = now) =>
      confirmTransfer({ token, pin }, context, prisma, at, pinHash);

    async function snapshot() {
      return {
        contracts: await prisma.contract.findMany({ orderBy: { createdAt: "asc" } }),
        approvals: await prisma.transferApproval.findMany({ orderBy: { createdAt: "asc" } }),
        payments: await prisma.payment.count(),
      };
    }

    describe("vista del enlace (GET, solo lectura)", () => {
      it("muestra los datos del contrato sin modificar nada", async () => {
        const { token, contract } = await pendingTransfer();
        const before = await snapshot();

        const view = await getTransferApprovalView(token, prisma, now);
        expect(view).toMatchObject({
          state: "valid",
          details: {
            reference: contract.reference,
            customerName: "Ana López",
            customerEmail: "ana@example.com",
            programName: "HM RUN",
            method: "Transferencia bancaria",
            status: "pending_payment",
          },
          remainingAttempts: 5,
        });
        // Abrirlo varias veces (p. ej. un escáner de correo) no cambia nada.
        await getTransferApprovalView(token, prisma, now);
        expect(await snapshot()).toEqual(before);
      });

      it("no muestra datos del cliente con un token inexistente o mal formado", async () => {
        await pendingTransfer();
        expect(await getTransferApprovalView("x".repeat(43), prisma, now)).toEqual({
          state: "not_found",
        });
        expect(await getTransferApprovalView("../../etc", prisma, now)).toEqual({
          state: "not_found",
        });
      });

      it("con un enlace vencido solo muestra la referencia y ofrece regenerarlo", async () => {
        const { token, contract } = await pendingTransfer();
        const later = new Date(createdAt.getTime() + 8 * 24 * 3600_000);
        expect(await getTransferApprovalView(token, prisma, later)).toEqual({
          state: "expired",
          reference: contract.reference,
          canRegenerate: true,
        });
      });
    });

    describe("confirmación con PIN", () => {
      it("activa el contrato, registra el pago y la auditoría en una transacción", async () => {
        const { token, contract } = await pendingTransfer();
        const result = await confirm(token, PIN);

        expect(result.contract).toMatchObject({
          id: contract.id,
          status: "active",
          serviceStartDate: now,
          serviceEndDate: new Date("2026-12-25T16:30:00Z"),
        });
        const payment = await prisma.payment.findFirstOrThrow();
        expect(payment).toMatchObject({
          contractId: contract.id,
          method: "transfer",
          status: "succeeded",
          currency: contract.currency,
          paidAt: now,
        });
        expect(payment.amount.toFixed(2)).toBe(contract.amount.toFixed(2));

        const approval = await prisma.transferApproval.findUniqueOrThrow({
          where: { tokenHash: hashToken(token) },
        });
        expect(approval).toMatchObject({ usedAt: now, approvedBy: "ferro", pinAttempts: 0 });

        const audit = await prisma.auditLog.findFirstOrThrow({
          where: { action: "transfer.approved" },
        });
        expect(audit).toMatchObject({
          actor: "ferro",
          entityType: "Contract",
          entityId: contract.id,
          ip: context.ip,
          userAgent: context.userAgent,
        });
        const serialized = JSON.stringify(await prisma.auditLog.findMany());
        expect(serialized).not.toContain(token);
        expect(serialized).not.toContain(PIN);
      });

      it("envía Transfer Confirmed y Welcome al cliente y Payment Received a Ferro", async () => {
        const { token, contract } = await pendingTransfer();
        await confirm(token, PIN);
        expect(sendTransferConfirmedEmail).toHaveBeenCalledWith(
          expect.objectContaining({ to: "ana@example.com", reference: contract.reference }),
        );
        expect(sendWelcomeEmail).toHaveBeenCalledWith(
          expect.objectContaining({ to: "ana@example.com", programName: "HM RUN" }),
        );
        expect(sendPaymentReceivedEmail).toHaveBeenCalledWith(
          expect.objectContaining({ reference: contract.reference }),
        );
      });

      it("un correo que falla no revierte el pago y queda en la auditoría", async () => {
        const { token } = await pendingTransfer();
        sendWelcomeEmail.mockRejectedValue(new Error("resend caído"));
        vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await confirm(token, PIN);
        expect(result.contract.status).toBe("active");
        expect(sendPaymentReceivedEmail).toHaveBeenCalled();
        const failed = await prisma.auditLog.findFirstOrThrow({
          where: { action: "transfer.notification_failed" },
        });
        expect(failed.metadata).toMatchObject({ email: "welcome" });
      });

      it("un PIN incorrecto no cambia el contrato, cuenta el intento y se audita", async () => {
        const { token, contract } = await pendingTransfer();
        await expect(confirm(token, WRONG_PIN)).rejects.toMatchObject({
          constructor: InvalidApprovalPinError,
          remainingAttempts: 4,
        });

        expect(
          await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } }),
        ).toMatchObject({ status: "pending_payment", serviceStartDate: null });
        expect(await prisma.payment.count()).toBe(0);
        const approval = await prisma.transferApproval.findFirstOrThrow();
        expect(approval).toMatchObject({ pinAttempts: 1, usedAt: null, invalidatedAt: null });
        const audit = await prisma.auditLog.findFirstOrThrow({
          where: { action: "transfer.pin_failed" },
        });
        expect(audit).toMatchObject({ ip: context.ip, userAgent: context.userAgent });
        expect(audit.metadata).toMatchObject({ failedAttempts: 1, linkInvalidated: false });
        expect(JSON.stringify(audit)).not.toContain(WRONG_PIN);
      });

      it("con 5 PIN incorrectos invalida el enlace; el contrato sigue pendiente", async () => {
        const { token, contract } = await pendingTransfer();
        for (const remaining of [4, 3, 2, 1, 0]) {
          await expect(confirm(token, WRONG_PIN)).rejects.toMatchObject({
            remainingAttempts: remaining,
          });
        }
        const approval = await prisma.transferApproval.findFirstOrThrow();
        expect(approval.invalidatedAt).toEqual(now);
        expect(approval.pinAttempts).toBe(5);

        // Ni el PIN correcto sirve ya con ese enlace.
        await expect(confirm(token, PIN)).rejects.toMatchObject({
          constructor: TransferLinkUnavailableError,
          reason: "invalidated",
          reference: contract.reference,
        });
        expect(
          (await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status,
        ).toBe("pending_payment");
        expect(await getTransferApprovalView(token, prisma, now)).toMatchObject({
          state: "invalidated",
          canRegenerate: true,
        });
      });

      it("con intentos simultáneos nunca se prueban más de 5 PIN por enlace", async () => {
        const { token } = await pendingTransfer();
        const results = await Promise.allSettled(
          Array.from({ length: 8 }, () => confirm(token, WRONG_PIN)),
        );
        const pinErrors = results.filter(
          (r) => r.status === "rejected" && r.reason instanceof InvalidApprovalPinError,
        );
        expect(pinErrors).toHaveLength(5);
        expect(results.every((r) => r.status === "rejected")).toBe(true);
        const approval = await prisma.transferApproval.findFirstOrThrow();
        expect(approval.pinAttempts).toBe(5);
        expect(approval.invalidatedAt).not.toBeNull();
      });

      it("un PIN correcto después de errores aprueba y deja solo los errores contados", async () => {
        const { token } = await pendingTransfer();
        await expect(confirm(token, WRONG_PIN)).rejects.toBeInstanceOf(InvalidApprovalPinError);
        await expect(confirm(token, WRONG_PIN)).rejects.toBeInstanceOf(InvalidApprovalPinError);
        await confirm(token, PIN);
        expect((await prisma.transferApproval.findFirstOrThrow()).pinAttempts).toBe(2);
      });

      it("el enlace es de un solo uso: una segunda confirmación no tiene efecto", async () => {
        const { token, contract } = await pendingTransfer();
        await confirm(token, PIN);
        await expect(confirm(token, PIN)).rejects.toMatchObject({
          constructor: TransferLinkUnavailableError,
          reason: "used",
        });
        expect(await prisma.payment.count()).toBe(1);
        expect(await getTransferApprovalView(token, prisma, now)).toMatchObject({
          state: "used",
          reference: contract.reference,
          usedAt: now,
        });
      });

      it("dos confirmaciones simultáneas con el PIN correcto crean un solo pago", async () => {
        const { token } = await pendingTransfer();
        const results = await Promise.allSettled([confirm(token, PIN), confirm(token, PIN)]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(await prisma.payment.count()).toBe(1);
        expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
      });

      it("rechaza un enlace vencido sin tocar el contrato", async () => {
        const { token } = await pendingTransfer();
        const later = new Date(createdAt.getTime() + 7 * 24 * 3600_000);
        await expect(confirm(token, PIN, later)).rejects.toMatchObject({ reason: "expired" });
        expect(await prisma.payment.count()).toBe(0);
        expect((await prisma.transferApproval.findFirstOrThrow()).pinAttempts).toBe(0);
      });

      it("rechaza un token inexistente o vacío", async () => {
        await pendingTransfer();
        await expect(confirm("A".repeat(43), PIN)).rejects.toMatchObject({ reason: "not_found" });
        await expect(confirm("", PIN)).rejects.toMatchObject({ reason: "not_found" });
      });

      it("rechaza un contrato que ya no está pendiente", async () => {
        const { token, contract } = await pendingTransfer();
        await prisma.contract.update({
          where: { id: contract.id },
          data: { status: "active", serviceStartDate: now, serviceEndDate: new Date("2027-01-01") },
        });
        await expect(confirm(token, PIN)).rejects.toBeInstanceOf(ContractNotPendingError);
        expect(await prisma.payment.count()).toBe(0);
        expect((await prisma.transferApproval.findFirstOrThrow()).usedAt).toBeNull();
      });

      it("sin FERRO_APPROVAL_PIN_HASH no confirma ni cuenta intentos", async () => {
        const { token } = await pendingTransfer();
        await expect(
          confirmTransfer({ token, pin: PIN }, context, prisma, now, undefined),
        ).rejects.toBeInstanceOf(ApprovalPinNotConfiguredError);
        expect((await prisma.transferApproval.findFirstOrThrow()).pinAttempts).toBe(0);
      });
    });

    describe("meses pagados y entrega del plan (DECISIONS A19, A20)", () => {
      const day = 24 * 3600_000;

      it("crea el ServicePeriod y el botón de entrega, y se lo manda a Ferro", async () => {
        const { token, contract } = await pendingTransfer();
        const result = await confirm(token, PIN);

        const period = await prisma.servicePeriod.findFirstOrThrow({
          include: { deliveryLinks: true },
        });
        expect(period).toMatchObject({
          contractId: contract.id,
          paymentId: result.payment.id,
          programId: contract.programId,
          sequence: 1,
          paidAt: now,
          startDate: now,
          endDate: new Date("2026-12-25T16:30:00Z"),
          planDeliveredOn: null,
        });
        expect(period.deliveryLinks).toHaveLength(1);
        const email = sendPaymentReceivedEmail.mock.calls[0]?.[0] as {
          deliveryUrl: string;
          prepaid: unknown;
        };
        expect(email.prepaid).toBeNull();
        const deliveryToken = email.deliveryUrl.split("/plan/entrega/")[1]!;
        expect(period.deliveryLinks[0]!.tokenHash).toBe(hashToken(deliveryToken));
      });

      it("pago tardío: confirma un contrato vencido y lo audita", async () => {
        const { token, contract } = await pendingTransfer();
        await prisma.contract.update({ where: { id: contract.id }, data: { status: "expired" } });
        const result = await confirm(token, PIN);
        expect(result.paidAfterExpiry).toBe(true);
        expect(result.contract.status).toBe("active");
        expect(
          await prisma.auditLog.count({ where: { action: "contract.paid_after_expiry" } }),
        ).toBe(1);
      });

      it("un pendiente con 7 días sin actividad (aún no vencido en la BD) también cuenta como tardío", async () => {
        const { token } = await pendingTransfer();
        // Regenera el enlace a los 8 días: el contrato sigue en pending_payment en la BD.
        const at = new Date(createdAt.getTime() + 8 * day);
        await prisma.transferApproval.updateMany({
          data: { expiresAt: new Date(at.getTime() + day) },
        });
        const result = await confirm(token, PIN, at);
        expect(result.paidAfterExpiry).toBe(true);
      });

      it("pago tardío con un mes vigente: el mes nuevo empieza cuando termina el vigente (scheduled)", async () => {
        // Ya no se paga por adelantado (A28), pero un pago real tardío se respeta (A20): Ana dejó
        // vencer una transferencia, contrató y pagó otra, y después Ferro confirma la primera.
        const late = await pendingTransfer();
        const dec2 = new Date("2026-12-02T16:00:00Z");
        const second = await requestTransfer(
          {
            verifiedEmail: "ana@example.com",
            fullName: "Ana López",
            whatsapp: "+525512345678",
            programSlug: "hm-complete",
          },
          {},
          prisma,
          dec2,
        );
        expect(second.outcome).toBe("created");
        const paidSecond = await confirm(lastToken(), PIN, dec2);
        expect(paidSecond.contract.status).toBe("active");

        const dec3 = new Date("2026-12-03T16:00:00Z");
        await regenerateTransferLink(
          { reference: late.contract.reference, pin: PIN },
          context,
          prisma,
          dec3,
          pinHash,
        );
        const result = await confirm(lastToken(), PIN, dec3);
        expect(result.paidAfterExpiry).toBe(true);
        expect(result.contract).toMatchObject({
          status: "scheduled",
          serviceStartDate: paidSecond.contract.serviceEndDate,
          serviceEndDate: new Date("2027-02-02T16:00:00Z"),
        });
        expect(result.servicePeriod.paidAt).toEqual(dec3);
        const email = sendPaymentReceivedEmail.mock.calls.at(-1)?.[0] as { prepaid: unknown };
        expect(email.prepaid).toEqual({
          from: "2 de enero de 2027",
          to: "2 de febrero de 2027",
        });
      });
    });

    describe("regeneración del enlace", () => {
      const regenerate = (reference: string, pin: string, at: Date = now) =>
        regenerateTransferLink({ reference, pin }, context, prisma, at, pinHash);

      it("invalida el enlace anterior y envía uno nuevo solo a Ferro", async () => {
        const { token: oldToken, contract } = await pendingTransfer();
        const later = new Date(createdAt.getTime() + 8 * 24 * 3600_000);

        const result = await regenerate(contract.reference, PIN, later);
        expect(result).toMatchObject({ reference: contract.reference, emailed: true });
        expect(JSON.stringify(result)).not.toMatch(/[A-Za-z0-9_-]{43}/);
        const newToken = lastToken();
        expect(newToken).not.toBe(oldToken);

        expect(await getTransferApprovalView(oldToken, prisma, later)).toMatchObject({
          state: "invalidated",
        });
        expect(await getTransferApprovalView(newToken, prisma, later)).toMatchObject({
          state: "valid",
        });
        expect(
          await prisma.auditLog.count({ where: { action: "transfer.link_regenerated" } }),
        ).toBe(1);

        await confirm(newToken, PIN, later);
        expect(
          (await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status,
        ).toBe("active");
      });

      it("con un PIN incorrecto responde igual exista o no la referencia", async () => {
        const { contract } = await pendingTransfer();
        const errors = await Promise.all(
          [contract.reference, "HM-2026-999999"].map((reference) =>
            regenerate(reference, WRONG_PIN).catch((error: unknown) => error),
          ),
        );
        for (const error of errors) {
          expect(error).toBeInstanceOf(InvalidApprovalPinError);
          expect((error as InvalidApprovalPinError).remainingAttempts).toBeNull();
        }
        expect(sendTransferPendingEmail).toHaveBeenCalledTimes(1);
        expect(await prisma.auditLog.count({ where: { action: "transfer.pin_failed" } })).toBe(2);
      });

      it("regenera el enlace de un contrato vencido para un pago tardío", async () => {
        const { contract } = await pendingTransfer();
        await prisma.contract.update({ where: { id: contract.id }, data: { status: "expired" } });
        await expect(regenerate(contract.reference, PIN)).resolves.toMatchObject({ emailed: true });
        await confirm(lastToken(), PIN);
        expect(
          (await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status,
        ).toBe("active");
      });

      it("regenerar el enlace de un pendiente cuenta como actividad", async () => {
        const { contract } = await pendingTransfer();
        await regenerate(contract.reference, PIN);
        expect(
          (await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).lastActivityAt,
        ).toEqual(now);
      });

      it("no regenera un contrato inexistente ni uno que ya no está pendiente", async () => {
        const { token, contract } = await pendingTransfer();
        await expect(regenerate("HM-2026-999999", PIN)).rejects.toBeInstanceOf(NotFoundError);
        await confirm(token, PIN);
        await expect(regenerate(contract.reference, PIN)).rejects.toBeInstanceOf(
          ContractNotPendingError,
        );
      });

      it("si el correo falla, lo informa (el enlace solo viaja por correo)", async () => {
        const { contract } = await pendingTransfer();
        sendTransferPendingEmail.mockRejectedValue(new Error("resend caído"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(regenerate(contract.reference, PIN)).resolves.toMatchObject({
          emailed: false,
        });
      });
    });
  },
);
