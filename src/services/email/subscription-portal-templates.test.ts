import { describe, expect, it } from "vitest";

import {
  subscriptionCancellationRevertedEmail,
  subscriptionCancellationScheduledEmail,
  subscriptionChangeAlertEmail,
  subscriptionEndedEmail,
  subscriptionPlanChangedEmail,
  verificationCodeEmail,
} from "./templates";

/** Correos del portal y de la cancelación (Fase 7, RF-14, RF-19, RN-08, DECISIONS A33). */
describe("plantillas del portal de la suscripción", () => {
  const customer = {
    reference: "HM-2026-000077",
    customerName: "Sofía <Ramírez>",
    manageUrl: "https://hm.test/suscripcion",
  };
  const alert = {
    reference: "HM-2026-000077",
    customerName: "Sofía <Ramírez>",
    customerEmail: "sofia@example.com",
    customerWhatsapp: "+525587654321",
    programName: "HM RUN",
  };

  it("cancelación programada: dice hasta cuándo sigue el servicio y cómo deshacerla", () => {
    const email = subscriptionCancellationScheduledEmail({
      ...customer,
      programName: "HM RUN",
      endsOn: "26 dic 2026",
    });
    expect(email.subject).toBe("Tu suscripción terminará el 26 dic 2026 · HM-2026-000077");
    expect(email.text).toContain("Tu servicio sigue activo hasta el 26 dic 2026");
    expect(email.text).toContain("no se hará ningún otro cobro");
    expect(email.text).toContain("deshacer la cancelación");
    expect(email.html).toContain('href="https://hm.test/suscripcion"');
    expect(email.html).toContain("Sofía &lt;Ramírez&gt;");
    expect(email.html).not.toContain("<Ramírez>");
  });

  it("cancelación deshecha: confirma el siguiente cobro", () => {
    const email = subscriptionCancellationRevertedEmail({
      ...customer,
      programName: "HM RUN",
      renewsOn: "26 dic 2026",
    });
    expect(email.subject).toBe("Tu suscripción sigue activa · HM-2026-000077");
    expect(email.text).toContain("el siguiente cobro es el 26 dic 2026");
  });

  it("cambio de programa: aplica en la siguiente renovación, sin perder el mes pagado", () => {
    const email = subscriptionPlanChangedEmail({
      ...customer,
      fromProgramName: "HM RUN",
      toProgramName: "HM STRENGTH",
      amount: "$1,350 MXN",
      effectiveOn: "26 dic 2026",
    });
    expect(email.subject).toBe("Cambiaste a HM STRENGTH · HM-2026-000077");
    expect(email.text).toContain("aplica en tu siguiente renovación, el 26 dic 2026");
    expect(email.text).toContain("Hasta entonces sigues con HM RUN");
    expect(email.text).toContain("Importe mensual: $1,350 MXN");
  });

  it("suscripción terminada: distingue la cancelación pedida de los cobros fallidos", () => {
    const base = {
      ...customer,
      programName: "HM RUN",
      rejoinUrl: "https://hm.test/#athlete-application",
    };
    const requested = subscriptionEndedEmail({ ...base, reason: "requested" });
    expect(requested.subject).toBe("Tu suscripción terminó · HM-2026-000077");
    expect(requested.text).toContain("Gracias por entrenar");
    expect(requested.html).toContain("https://hm.test/#athlete-application");
    expect(requested.html).toContain("Volver a inscribirme");

    const failed = subscriptionEndedEmail({ ...base, reason: "payment_failed" });
    expect(failed.text).toContain("en ninguno de los 3 intentos");
    expect(failed.text).toContain("terminó tu programación");
  });

  it("los avisos a Ferro dicen qué pasó, con los datos del cliente", () => {
    const scheduled = subscriptionChangeAlertEmail({
      ...alert,
      kind: "cancellation_scheduled",
      endsOn: "26 dic 2026",
    });
    expect(scheduled.subject).toBe("Cancelación programada · HM-2026-000077 · Sofía <Ramírez>");
    expect(scheduled.text).toContain("Su servicio sigue hasta el 26 dic 2026");
    expect(scheduled.text).toContain("WhatsApp: +525587654321");
    expect(scheduled.html).not.toContain("<Ramírez>");

    const reverted = subscriptionChangeAlertEmail({
      ...alert,
      kind: "cancellation_reverted",
      renewsOn: "26 dic 2026",
    });
    expect(reverted.subject).toContain("Cancelación deshecha");

    const changed = subscriptionChangeAlertEmail({
      ...alert,
      kind: "plan_changed",
      toProgramName: "HM STRENGTH",
      amount: "$1,350 MXN",
      effectiveOn: "26 dic 2026",
    });
    expect(changed.subject).toContain("Cambio de programa");
    expect(changed.text).toContain("su programa será HM STRENGTH");
    expect(changed.text).toContain("Programa nuevo: HM STRENGTH");

    const ended = subscriptionChangeAlertEmail({ ...alert, kind: "ended", reason: "requested" });
    expect(ended.subject).toContain("Suscripción terminada");
    const failed = subscriptionChangeAlertEmail({
      ...alert,
      kind: "ended",
      reason: "payment_failed",
    });
    expect(failed.subject).toContain("Suscripción cancelada por pagos fallidos");
  });

  it("el código de verificación sirve para la inscripción y para el portal", () => {
    const email = verificationCodeEmail({ code: "123456", expiresInMinutes: 10 });
    expect(email.html).toContain("para continuar:");
    expect(email.html).not.toContain("inscripción");
  });
});
