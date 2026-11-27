import { describe, expect, it } from "vitest";

import {
  extraPaymentAlertEmail,
  paymentFailedAlertEmail,
  paymentFailedEmail,
  purchaseConfirmationEmail,
  renewalSuccessfulEmail,
  subscriptionRenewedEmail,
} from "./templates";

/** Correos de la suscripción (Fase 6, RF-08, RF-17, RF-18, DECISIONS A31). */
describe("plantillas de la suscripción", () => {
  const paid = {
    reference: "HM-2026-000077",
    customerName: "Sofía <Ramírez>",
    customerEmail: "sofia@example.com",
    customerWhatsapp: "+525587654321",
    programName: "HM RUN",
    amount: "$1,080 MXN",
    method: "Suscripción mensual con tarjeta (Stripe)",
    paidAt: "26 dic 2026, 10:00",
    serviceStart: "26 dic 2026, 10:00",
    serviceEnd: "26 ene 2027, 10:00",
    deliveryUrl: "https://hm.test/plan/entrega/tok",
  };

  it("Renewal Successful (Ferro) trae el número de mes, los datos y el botón de entrega", () => {
    const email = renewalSuccessfulEmail({ ...paid, monthNumber: 3 });
    expect(email.subject).toBe("Renovación registrada · HM-2026-000077 · Sofía <Ramírez>");
    expect(email.text).toContain("mes 3");
    expect(email.text).toContain("WhatsApp: +525587654321");
    expect(email.html).toContain("https://hm.test/plan/entrega/tok");
    expect(email.html).toContain("Sofía &lt;Ramírez&gt;");
    expect(email.html).not.toContain("<Ramírez>");
  });

  it("la renovación del cliente dice el nuevo periodo y que se renueva hasta cancelar", () => {
    const email = subscriptionRenewedEmail({ ...paid, manageUrl: "https://hm.test/suscripcion" });
    expect(email.subject).toContain("Tu suscripción se renovó");
    expect(email.text).toContain("Nuevo periodo: Del 26 dic 2026, 10:00 al 26 ene 2027, 10:00");
    expect(email.text).toContain("hasta que la canceles");
    // Enlace a "Administrar mi suscripción" (DECISIONS A33).
    expect(email.text).toContain("https://hm.test/suscripcion");
    expect(email.html).toContain('href="https://hm.test/suscripcion"');
  });

  it("Purchase Confirmation de una suscripción avisa que se renueva cada mes", () => {
    const base = { ...paid, method: "Suscripción mensual con tarjeta", startsLater: false };
    expect(purchaseConfirmationEmail({ ...base, renewsMonthly: true }).text).toContain(
      "se renueva sola cada mes",
    );
    expect(purchaseConfirmationEmail(base).text).not.toContain("se renueva");
    const manageUrl = "https://hm.test/suscripcion";
    expect(purchaseConfirmationEmail({ ...base, renewsMonthly: true, manageUrl }).text).toContain(
      manageUrl,
    );
    // El pago único no tiene nada que administrar.
    expect(purchaseConfirmationEmail({ ...base, manageUrl }).text).not.toContain(manageUrl);
  });

  it("Payment Failed (cliente) explica la pausa y ofrece pagar con otra tarjeta", () => {
    const email = paymentFailedEmail({ ...paid, payUrl: "https://invoice.stripe.test/i/in_1" });
    expect(email.text).toContain("tu servicio queda en pausa");
    expect(email.html).toContain("https://invoice.stripe.test/i/in_1");
    const noUrl = paymentFailedEmail({ ...paid, payUrl: null });
    expect(noUrl.text).toContain("escríbele a Ferro");
    expect(noUrl.html).not.toContain("Pagar ahora");
  });

  it("Payment Failed (Ferro) dice que el servicio está suspendido y el intento", () => {
    const email = paymentFailedAlertEmail({ ...paid, attempt: 2 });
    expect(email.subject).toBe("Pago fallido · HM-2026-000077 · Sofía <Ramírez>");
    expect(email.text).toContain("suspendido");
    expect(email.text).toContain("Intento: 2");
  });

  it("el aviso de pago adicional pide cancelar una suscripción duplicada", () => {
    const email = extraPaymentAlertEmail({
      ...paid,
      stripePaymentIntentId: "pi_1",
      duplicateSubscriptionId: "sub_dup",
    });
    expect(email.text).toContain("Suscripción duplicada: sub_dup");
    expect(email.text).toContain("Cancela esa suscripción");
  });
});
