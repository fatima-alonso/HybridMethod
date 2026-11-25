import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashApprovalPin } from "@/lib/approval-pin";
import { createTestPrisma, testDatabaseUrl, truncateAll } from "@/test/db";

import { DeliveryLinkUnavailableError, InvalidDeliveryDateError } from "./errors";
import { syncProgramCatalog } from "./program.service";

const sendTransferPendingEmail = vi.fn();
const sendPaymentReceivedEmail = vi.fn();
const sendPlanDeliveryReminderEmail = vi.fn();
vi.mock("./email.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email.service")>()),
  sendTransferPendingEmail: (...args: unknown[]) => sendTransferPendingEmail(...args),
  sendTransferConfirmedEmail: async () => ({ mode: "console" }),
  sendWelcomeEmail: async () => ({ mode: "console" }),
  sendPaymentReceivedEmail: (...args: unknown[]) => sendPaymentReceivedEmail(...args),
  sendPlanDeliveryReminderEmail: (...args: unknown[]) => sendPlanDeliveryReminderEmail(...args),
}));

const { requestTransfer } = await import("./transfer.service");
const { confirmTransfer } = await import("./transfer-approval.service");
const { confirmDelivery, getDeliveryView } = await import("./delivery.service");
const { runDailyJobs, sendPlanDeliveryReminders, startOfBusinessDay } =
  await import("./cron.service");

const PIN = "482917";
const HOUR = 3600_000;
const DAY = 24 * HOUR;

describe.skipIf(!testDatabaseUrl)("entrega del plan y cron diario (DECISIONS A19, A20)", () => {
  const prisma = testDatabaseUrl ? createTestPrisma() : (undefined as never);
  // Martes 24 de noviembre de 2026, 10:00 en Ciudad de México.
  const paidAt = new Date("2026-11-24T16:00:00Z");
  let pinHash: string;

  beforeAll(async () => {
    pinHash = await hashApprovalPin(PIN, 4);
  });
  beforeEach(async () => {
    await truncateAll(prisma);
    await syncProgramCatalog(prisma);
    for (const mock of [
      sendTransferPendingEmail,
      sendPaymentReceivedEmail,
      sendPlanDeliveryReminderEmail,
    ]) {
      mock.mockReset().mockResolvedValue({ mode: "console" });
    }
  });
  afterAll(() => prisma.$disconnect());

  const tokenFrom = (url: string, marker: string) => url.split(marker)[1]!;

  /** Transferencia confirmada por Ferro en `paidAt`. Devuelve el token del botón de entrega. */
  async function paidMonth(email = "ana@example.com") {
    await requestTransfer(
      {
        verifiedEmail: email,
        fullName: "Ana López",
        whatsapp: "+525512345678",
        programSlug: "hm-run",
      },
      {},
      prisma,
      new Date(paidAt.getTime() - HOUR),
    );
    const approvalUrl = (sendTransferPendingEmail.mock.calls.at(-1)?.[0] as { confirmUrl: string })
      .confirmUrl;
    const result = await confirmTransfer(
      { token: tokenFrom(approvalUrl, "/transfer/confirm/"), pin: PIN },
      {},
      prisma,
      paidAt,
      pinHash,
    );
    const deliveryUrl = (sendPaymentReceivedEmail.mock.calls.at(-1)?.[0] as { deliveryUrl: string })
      .deliveryUrl;
    return { ...result, deliveryToken: tokenFrom(deliveryUrl, "/plan/entrega/") };
  }

  describe("registro de la entrega", () => {
    it("la página es de solo lectura y propone hoy como fecha", async () => {
      const { deliveryToken } = await paidMonth();
      const at = new Date("2026-11-26T18:00:00Z");
      const view = await getDeliveryView(deliveryToken, prisma, at);
      expect(view).toMatchObject({
        state: "valid",
        defaultDate: "2026-11-26",
        details: {
          customerName: "Ana López",
          programName: "HM RUN",
          minDate: "2026-11-24",
          maxDate: "2026-11-26",
        },
      });
      await getDeliveryView(deliveryToken, prisma, at);
      expect((await prisma.servicePeriod.findFirstOrThrow()).planDeliveredOn).toBeNull();
    });

    it("guarda la fecha elegida, marca el botón y audita", async () => {
      const { deliveryToken, servicePeriod } = await paidMonth();
      const at = new Date("2026-11-27T18:00:00Z");
      const result = await confirmDelivery(
        { token: deliveryToken, deliveredOn: "2026-11-25" },
        { ip: "203.0.113.9", userAgent: "vitest" },
        prisma,
        at,
      );
      expect(result).toEqual({ deliveredOn: "2026-11-25", alreadyRecorded: false });
      const period = await prisma.servicePeriod.findUniqueOrThrow({
        where: { id: servicePeriod.id },
        include: { deliveryLinks: true, contract: true },
      });
      expect(period.planDeliveredOn?.toISOString().slice(0, 10)).toBe("2026-11-25");
      expect(period.deliveryRecordedAt).toEqual(at);
      expect(period.deliveryLinks[0]!.usedAt).toEqual(at);
      // Solo es referencia: el contrato y su periodo no cambian.
      expect(period.contract.status).toBe("active");
      expect(period.startDate).toEqual(paidAt);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "plan.delivered" } });
      expect(audit).toMatchObject({
        actor: "ferro",
        ip: "203.0.113.9",
        entityId: servicePeriod.id,
      });
      expect(await getDeliveryView(deliveryToken, prisma, at)).toMatchObject({
        state: "delivered",
        deliveredOn: "2026-11-25",
      });
    });

    it("rechaza una fecha futura o anterior al pago", async () => {
      const { deliveryToken } = await paidMonth();
      const at = new Date("2026-11-27T18:00:00Z");
      await expect(
        confirmDelivery({ token: deliveryToken, deliveredOn: "2026-11-28" }, {}, prisma, at),
      ).rejects.toMatchObject({ constructor: InvalidDeliveryDateError, reason: "future" });
      await expect(
        confirmDelivery({ token: deliveryToken, deliveredOn: "2026-11-23" }, {}, prisma, at),
      ).rejects.toMatchObject({ reason: "before_payment" });
      expect((await prisma.servicePeriod.findFirstOrThrow()).planDeliveredOn).toBeNull();
    });

    it("una segunda vez (con este u otro botón) devuelve la fecha ya registrada sin cambiarla", async () => {
      const { deliveryToken } = await paidMonth();
      const at = new Date("2026-11-27T18:00:00Z");
      await confirmDelivery({ token: deliveryToken, deliveredOn: "2026-11-25" }, {}, prisma, at);
      const again = await confirmDelivery(
        { token: deliveryToken, deliveredOn: "2026-11-27" },
        {},
        prisma,
        at,
      );
      expect(again).toEqual({ deliveredOn: "2026-11-25", alreadyRecorded: true });
      expect(await prisma.auditLog.count({ where: { action: "plan.delivered" } })).toBe(1);
    });

    it("dos botones del mismo mes al mismo tiempo registran una sola fecha", async () => {
      const { deliveryToken, servicePeriod } = await paidMonth();
      const { createPlanDeliveryLink } = await import("./delivery-link");
      const other = await createPlanDeliveryLink(servicePeriod.id, prisma, paidAt);
      const at = new Date("2026-11-27T18:00:00Z");
      const results = await Promise.all([
        confirmDelivery({ token: deliveryToken, deliveredOn: "2026-11-25" }, {}, prisma, at),
        confirmDelivery({ token: other.token, deliveredOn: "2026-11-26" }, {}, prisma, at),
      ]);
      expect(results.filter((r) => !r.alreadyRecorded)).toHaveLength(1);
      expect(new Set(results.map((r) => r.deliveredOn)).size).toBe(1);
    });

    it("un botón vencido o inexistente no sirve", async () => {
      const { deliveryToken } = await paidMonth();
      const later = new Date(paidAt.getTime() + 8 * DAY);
      expect(await getDeliveryView(deliveryToken, prisma, later)).toEqual({ state: "expired" });
      await expect(
        confirmDelivery({ token: deliveryToken, deliveredOn: "2026-11-25" }, {}, prisma, later),
      ).rejects.toMatchObject({ constructor: DeliveryLinkUnavailableError, reason: "expired" });
      expect(await getDeliveryView("x".repeat(43), prisma, later)).toEqual({ state: "not_found" });
    });
  });

  describe("recordatorios", () => {
    const reminded = () => sendPlanDeliveryReminderEmail.mock.calls.length;

    it("empiezan el siguiente día hábil, uno por día, cada uno con su botón", async () => {
      await paidMonth();
      // Mismo día del pago: todavía no.
      await sendPlanDeliveryReminders(prisma, new Date("2026-11-24T23:00:00Z"), 1);
      expect(reminded()).toBe(0);
      // Miércoles 25: primer recordatorio; una segunda ejecución ese día no repite.
      const wednesday = new Date("2026-11-25T15:00:00Z");
      await sendPlanDeliveryReminders(prisma, wednesday, 1);
      await sendPlanDeliveryReminders(prisma, new Date("2026-11-25T20:00:00Z"), 1);
      expect(reminded()).toBe(1);
      const input = sendPlanDeliveryReminderEmail.mock.calls[0]?.[0] as {
        customerName: string;
        reference: string;
        deliveryUrl: string;
      };
      expect(input.customerName).toBe("Ana López");
      // El botón del recordatorio es nuevo y funciona.
      const token = tokenFrom(input.deliveryUrl, "/plan/entrega/");
      expect(await prisma.planDeliveryLink.count()).toBe(2);
      expect((await getDeliveryView(token, prisma, wednesday)).state).toBe("valid");
      // Jueves 26: otro.
      await sendPlanDeliveryReminders(prisma, new Date("2026-11-26T15:00:00Z"), 1);
      expect(reminded()).toBe(2);
    });

    it("no se envían en fin de semana ni en festivo", async () => {
      await paidMonth();
      const saturday = new Date("2026-11-28T15:00:00Z");
      expect(await sendPlanDeliveryReminders(prisma, saturday, 1)).toMatchObject({
        skippedNotBusinessDay: true,
      });
      expect(reminded()).toBe(0);
    });

    it("se detienen al registrar la entrega", async () => {
      const { deliveryToken } = await paidMonth();
      await confirmDelivery(
        { token: deliveryToken, deliveredOn: "2026-11-24" },
        {},
        prisma,
        new Date("2026-11-24T20:00:00Z"),
      );
      await sendPlanDeliveryReminders(prisma, new Date("2026-11-25T15:00:00Z"), 1);
      expect(reminded()).toBe(0);
    });

    it("si el correo falla, lo registra y lo reintenta el siguiente día hábil", async () => {
      await paidMonth();
      sendPlanDeliveryReminderEmail.mockRejectedValueOnce(new Error("resend caído"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await sendPlanDeliveryReminders(prisma, new Date("2026-11-25T15:00:00Z"), 1);
      expect(result).toMatchObject({ sent: 0, failed: 1 });
      expect(await prisma.auditLog.count({ where: { action: "plan.reminder_failed" } })).toBe(1);
      await sendPlanDeliveryReminders(prisma, new Date("2026-11-26T15:00:00Z"), 1);
      expect(reminded()).toBe(2);
    });
  });

  it("startOfBusinessDay es la medianoche de Ciudad de México", () => {
    expect(startOfBusinessDay("2026-11-25").toISOString()).toBe("2026-11-25T06:00:00.000Z");
  });

  it("runDailyJobs vence pendientes, inicia meses programados y completa los terminados", async () => {
    const { contract } = await paidMonth();
    // Otro cliente con un pendiente que lleva 8 días sin actividad.
    await requestTransfer(
      {
        verifiedEmail: "luis@example.com",
        fullName: "Luis",
        whatsapp: "+525512345679",
        programSlug: "hm-run",
      },
      {},
      prisma,
      paidAt,
    );
    const result = await runDailyJobs(prisma, new Date(paidAt.getTime() + 8 * DAY));
    expect(result.expiredPending).toBe(1);
    expect(result.completed).toBe(0);
    const end = await runDailyJobs(prisma, new Date("2026-12-26T15:00:00Z"));
    expect(end.completed).toBe(1);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      "completed",
    );
  });

  it("runDailyJobs activa el mes pagado por adelantado cuando termina el anterior", async () => {
    const first = await paidMonth();
    // Paga su siguiente mes el 1 de diciembre: queda programado del 24 dic al 24 ene.
    const december = new Date("2026-12-01T16:00:00Z");
    await requestTransfer(
      {
        verifiedEmail: "ana@example.com",
        fullName: "Ana López",
        whatsapp: "+525512345678",
        programSlug: "hm-run",
      },
      {},
      prisma,
      december,
    );
    const url = (sendTransferPendingEmail.mock.calls.at(-1)?.[0] as { confirmUrl: string })
      .confirmUrl;
    const second = await confirmTransfer(
      { token: tokenFrom(url, "/transfer/confirm/"), pin: PIN },
      {},
      prisma,
      december,
      pinHash,
    );
    expect(second.contract.status).toBe("scheduled");

    const result = await runDailyJobs(prisma, new Date("2026-12-24T17:00:00Z"));
    expect(result).toMatchObject({ scheduledActivated: 1, completed: 1 });
    const status = async (id: string) =>
      (await prisma.contract.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(first.contract.id)).toBe("completed");
    expect(await status(second.contract.id)).toBe("active");
  });
});
