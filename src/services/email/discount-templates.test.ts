import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

import { emailDiscount } from "../payment-notifications.service";
import {
  paymentReceivedEmail,
  purchaseConfirmationEmail,
  renewalSuccessfulEmail,
  subscriptionChangeAlertEmail,
  subscriptionDiscountEndedEmail,
  subscriptionRenewedEmail,
} from "./templates";

/** Correos con cupones de descuento (Fase 7B, DECISIONS A34). */
describe("correos con descuento", () => {
  const paid = {
    reference: "HM-2026-000090",
    customerName: "Ana López",
    customerEmail: "ana@example.com",
    customerWhatsapp: "+525512345678",
    programName: "HM RUN",
    method: "Pago único con tarjeta",
    paidAt: "27 nov 2026, 10:00",
    serviceStart: "27 nov 2026, 10:00",
    serviceEnd: "27 dic 2026, 10:00",
    deliveryUrl: "https://hm.test/plan/entrega/tok",
    startsLater: false,
    manageUrl: "https://hm.test/suscripcion",
  };

  it("emailDiscount calcula el precio antes del cupón con Decimal y marca la cortesía", () => {
    const partial = emailDiscount("960.00", "MXN", {
      amount: new Prisma.Decimal("240.00"),
      promotionCode: "VERANO20",
    });
    expect(partial).toEqual({
      listAmount: "$1,200 MXN",
      discount: "$240 MXN",
      promotionCode: "VERANO20",
      courtesy: false,
    });
    const courtesy = emailDiscount("0.00", "MXN", {
      amount: new Prisma.Decimal("1080.00"),
      promotionCode: null,
    });
    expect(courtesy).toMatchObject({ listAmount: "$1,080 MXN", courtesy: true });
    expect(emailDiscount("1200.00", "MXN", null)).toBeNull();
  });

  const discount = {
    listAmount: "$1,200 MXN",
    discount: "$240 MXN",
    promotionCode: "VERANO20",
    courtesy: false,
  };
  const courtesy = {
    listAmount: "$1,200 MXN",
    discount: "$1,200 MXN",
    promotionCode: "CORTESIA-ANA",
    courtesy: true,
  };

  it("Purchase Confirmation muestra precio, descuento con el código y lo cobrado", () => {
    const email = purchaseConfirmationEmail({ ...paid, amount: "$960 MXN", discount });
    expect(email.text).toContain("Precio: $1,200 MXN");
    expect(email.text).toContain("Descuento: −$240 MXN (código VERANO20)");
    expect(email.text).toContain("Importe: $960 MXN");
    expect(email.text).toContain("recibimos tu pago");
  });

  it("una cortesía dice que no tuvo costo, al cliente y a Ferro", () => {
    const customer = purchaseConfirmationEmail({ ...paid, amount: "$0 MXN", discount: courtesy });
    expect(customer.text).toContain("tu inscripción quedó registrada sin costo");
    expect(customer.text).toContain("Importe: Cortesía (sin costo)");
    const ferro = paymentReceivedEmail({
      ...paid,
      amount: "$0 MXN",
      prepaid: null,
      discount: courtesy,
    });
    expect(ferro.text).toContain("Importe: Cortesía (sin costo)");
    expect(ferro.text).toContain("código CORTESIA-ANA");
    // Sin cupón, como antes.
    const plain = paymentReceivedEmail({ ...paid, amount: "$1,200 MXN", prepaid: null });
    expect(plain.text).toContain("Importe: $1,200 MXN");
    expect(plain.text).not.toContain("Descuento");
  });

  it("las renovaciones con cupón lo muestran a los dos", () => {
    const customer = subscriptionRenewedEmail({ ...paid, amount: "$0 MXN", discount: courtesy });
    expect(customer.text).toContain("sin costo para ti");
    expect(customer.text).toContain("Importe: Cortesía (sin costo)");
    const ferro = renewalSuccessfulEmail({ ...paid, amount: "$864 MXN", monthNumber: 2, discount });
    expect(ferro.text).toContain("Descuento: −$240 MXN (código VERANO20)");
  });

  it("al terminar el descuento avisa el precio normal y la fecha del siguiente cobro", () => {
    const email = subscriptionDiscountEndedEmail({
      customerName: "Ana López",
      reference: "HM-2026-000090",
      programName: "HM RUN",
      promotionCode: "CORTESIA-ANA",
      amount: "$1,080 MXN",
      renewsOn: "27 dic 2026",
      manageUrl: "https://hm.test/suscripcion",
    });
    expect(email.subject).toBe("Tu descuento terminó · HM-2026-000090");
    expect(email.text).toContain("Tu siguiente cobro, el 27 dic 2026, será de $1,080 MXN");
    expect(email.text).toContain("puedes cancelar antes de esa fecha");
    expect(email.html).toContain('href="https://hm.test/suscripcion"');

    const alert = subscriptionChangeAlertEmail({
      reference: "HM-2026-000090",
      customerName: "Ana López",
      customerEmail: "ana@example.com",
      customerWhatsapp: "+525512345678",
      programName: "HM RUN",
      kind: "discount_ended",
      promotionCode: "CORTESIA-ANA",
      amount: "$1,080 MXN",
      renewsOn: "27 dic 2026",
    });
    expect(alert.subject).toBe("Descuento terminado · HM-2026-000090 · Ana López");
    expect(alert.text).toContain("será de $1,080 MXN");
  });
});
