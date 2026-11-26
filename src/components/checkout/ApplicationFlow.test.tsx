// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROGRAMS } from "@/content/programs";
import { getPhoneCountryOptions } from "@/lib/phone";

import { ApplicationFlow } from "./ApplicationFlow";

// Stripe.js carga un script de js.stripe.com: en las pruebas se sustituye por un Stripe.js falso
// que monta un formulario de mentira y deja disparar su evento "confirm".
type Handler = (event: unknown) => unknown;
const stripeJs = vi.hoisted(() => ({
  sdkOptions: [] as Array<Record<string, unknown>>,
  handlers: {} as Record<string, Handler>,
  confirm: vi.fn(),
  destroyed: 0,
}));
vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(async () => ({
    initCheckoutFormSdk: (options: Record<string, unknown>) => {
      stripeJs.sdkOptions.push(options);
      return {
        createForm: () => ({
          on: (name: string, handler: Handler) => {
            stripeJs.handlers[name] = handler;
          },
          mount: (container: HTMLElement) => {
            container.textContent = "Formulario de Stripe";
            stripeJs.handlers.ready?.({ elementType: "checkoutForm" });
          },
          destroy: () => {
            stripeJs.destroyed += 1;
          },
        }),
        loadActions: async () => ({
          type: "success",
          actions: { confirm: stripeJs.confirm },
        }),
      };
    },
  })),
}));

const COUNTRIES = getPhoneCountryOptions();

type Reply = { status: number; body: Record<string, unknown> };
const replies: Record<string, Reply[]> = {};
const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

function reply(url: string, status: number, body: Record<string, unknown>) {
  (replies[url] ??= []).push({ status, body });
}

beforeEach(() => {
  for (const key of Object.keys(replies)) delete replies[key];
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const next = replies[url]?.shift();
      if (!next) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(next.body), { status: next.status });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fillForm() {
  fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Ana López" } });
  fireEvent.change(screen.getByLabelText("Correo electrónico"), {
    target: { value: "Ana@Example.com" },
  });
  fireEvent.change(screen.getByLabelText("WhatsApp"), { target: { value: "55 1234 5678" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

const transfer = {
  success: true,
  reference: "HM-2026-000042",
  status: "pending_payment",
  program: { slug: "hm-run", name: "HM RUN" },
  amount: "1200.00",
  currency: "MXN",
  whatsappUrl: "https://wa.me/5215512345678?text=Hola",
};

function checkoutCreated(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    clientSecret: "cs_test_1_secret_x",
    publishableKey: "pk_test_123",
    returnUrl: "http://localhost:3000/pago/exito",
    mode: "payment",
    reference: "HM-2026-000050",
    status: "pending_payment",
    outcome: "created",
    program: { slug: "hm-run", name: "HM RUN" },
    amount: "1200.00",
    currency: "MXN",
    ...overrides,
  };
}

async function reachPaymentStep() {
  reply("/api/verification/request", 200, { success: true, message: "ok" });
  reply("/api/verification/confirm", 200, { success: true });
  render(<ApplicationFlow programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />);
  fillForm();
  await screen.findByRole("heading", { name: "Verifica tu correo" });
  fireEvent.change(screen.getByLabelText("Código de verificación"), {
    target: { value: "123 456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
  await screen.findByRole("heading", { name: "Elige cómo pagar" });
}

describe("ApplicationFlow (SDD §8.1, §8.4)", () => {
  it("formulario → código → método de pago → transferencia pendiente", async () => {
    await reachPaymentStep();
    expect(calls[0]).toEqual({
      url: "/api/verification/request",
      body: { email: "Ana@Example.com" },
    });
    expect(calls[1]).toEqual({
      url: "/api/verification/confirm",
      body: { email: "Ana@Example.com", code: "123456" },
    });

    reply("/api/transfers", 201, transfer);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Transferencia pendiente" });

    // El navegador no envía correo, importe ni Price ID (SDD §9.2).
    expect(calls[2]).toEqual({
      url: "/api/transfers",
      body: {
        fullName: "Ana López",
        whatsapp: { country: "MX", number: "55 1234 5678" },
        program: "hm-run",
        privacyAccepted: true,
      },
    });
    expect(screen.getByText("HM-2026-000042")).toBeTruthy();
    const whatsapp = screen.getByRole("link", { name: /WhatsApp/ });
    expect(whatsapp.getAttribute("href")).toBe(transfer.whatsappUrl);
  });

  it("al terminar, 'Volver al inicio' limpia el formulario y sube al inicio de la página", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    await reachPaymentStep();
    reply("/api/transfers", 201, transfer);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Transferencia pendiente" });

    fireEvent.click(screen.getByRole("button", { name: "Volver al inicio" }));
    expect((screen.getByLabelText("Nombre completo") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Correo electrónico") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("con un pendiente de otro programa pregunta y reenvía la elección (DECISIONS A20)", async () => {
    await reachPaymentStep();
    reply("/api/transfers", 409, {
      success: false,
      error: "pending_contract_exists",
      message: "Encontramos un registro pendiente a tu nombre.",
      pending: {
        reference: "HM-2026-000007",
        programSlug: "hm-strength",
        programName: "HM STRENGTH",
        paymentType: "transfer",
        amount: "1500.00",
        currency: "MXN",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Tienes un registro pendiente" });
    expect(
      screen.getByText(/HM STRENGTH · Transferencia · .*1,500.* · HM-2026-000007/),
    ).toBeTruthy();

    reply("/api/transfers", 200, { ...transfer, outcome: "changed" });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a HM RUN · Transferencia" }));
    await screen.findByRole("heading", { name: "Transferencia pendiente" });
    expect(calls.at(-1)?.body).toMatchObject({ program: "hm-run", pendingAction: "change" });
  });

  it("el paso de pago muestra el precio de cada modalidad (10 % menos con suscripción)", async () => {
    await reachPaymentStep();
    const labels = screen.getAllByRole("radio").map((radio) => radio.closest("label")?.textContent);
    expect(labels[0]).toMatch(/Transferencia bancaria.*\$1,200.*\/ mes/);
    expect(labels[1]).toMatch(/Pago único.*\$1,200/);
    expect(labels[2]).toMatch(/Suscripción mensual.*\$1,080/);
  });

  it("el encabezado de cada paso recibe el foco", async () => {
    await reachPaymentStep();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Elige cómo pagar" }));
  });

  it("las tres formas de pago están disponibles; transferencia por defecto", async () => {
    await reachPaymentStep();
    const transferOption = screen.getByRole("radio", { name: /Transferencia bancaria/ });
    expect((transferOption as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /Pago único/ }) as HTMLInputElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole("radio", { name: /Suscripción/ }) as HTMLInputElement).disabled).toBe(
      false,
    );
  });

  it("suscripción: pide el Checkout en modo subscription y avisa que se cobra cada mes", async () => {
    await reachPaymentStep();
    reply(
      "/api/checkout",
      201,
      checkoutCreated({ mode: "subscription", amount: "1080.00", reference: "HM-2026-000051" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Suscripción/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Suscríbete con tarjeta" });
    await screen.findByText("Formulario de Stripe");
    expect(screen.getByText(/\$1,080 MXN \/ mes/)).toBeTruthy();
    expect(screen.getByText(/cobra el siguiente en la misma fecha cada mes/)).toBeTruthy();
    expect(calls.at(-1)).toEqual({
      url: "/api/checkout",
      body: {
        fullName: "Ana López",
        whatsapp: { country: "MX", number: "55 1234 5678" },
        program: "hm-run",
        privacyAccepted: true,
        mode: "subscription",
      },
    });
  });

  it("pago único: pide el Checkout al servidor y monta el formulario de Stripe (DECISIONS A29)", async () => {
    stripeJs.sdkOptions.length = 0;
    stripeJs.confirm
      .mockReset()
      .mockResolvedValue({ type: "error", error: { message: "Tu tarjeta fue rechazada." } });
    await reachPaymentStep();
    reply("/api/checkout", 201, checkoutCreated());
    fireEvent.click(screen.getByRole("radio", { name: /Pago único/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Paga con tarjeta" });
    await screen.findByText("Formulario de Stripe");
    expect(screen.getByText("HM-2026-000050")).toBeTruthy();
    // Tema oscuro con los colores de la marca.
    expect(stripeJs.sdkOptions.at(-1)).toMatchObject({
      clientSecret: "cs_test_1_secret_x",
      appearance: { theme: "night", variables: { colorPrimary: "#FF6A00" } },
    });

    // Al pagar se confirma con la página de "¡Gracias!"; si Stripe rechaza, se muestra el motivo.
    const event = { source: "checkout-form-pay-button", paymentMethodType: "card" };
    await act(async () => {
      await stripeJs.handlers.confirm?.(event);
    });
    expect(stripeJs.confirm).toHaveBeenCalledWith({
      formConfirmEvent: event,
      returnUrl: "http://localhost:3000/pago/exito",
    });
    expect(await screen.findByText("Tu tarjeta fue rechazada.")).toBeTruthy();

    // Solo programa y modalidad: el importe y el Price los decide el servidor (SDD §9.2).
    expect(calls.at(-1)).toEqual({
      url: "/api/checkout",
      body: {
        fullName: "Ana López",
        whatsapp: { country: "MX", number: "55 1234 5678" },
        program: "hm-run",
        privacyAccepted: true,
        mode: "payment",
      },
    });

    // Puede regresar a elegir otra forma de pago.
    fireEvent.click(screen.getByRole("button", { name: "Elegir otra forma de pago" }));
    await screen.findByRole("heading", { name: "Elige cómo pagar" });
  });

  it("pago único: si Stripe no está disponible muestra el aviso y deja elegir otra forma", async () => {
    await reachPaymentStep();
    reply("/api/checkout", 503, {
      success: false,
      error: "payments_unavailable",
      message: "El pago con tarjeta no está disponible en este momento.",
    });
    fireEvent.click(screen.getByRole("radio", { name: /Pago único/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText(/no está disponible en este momento/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Elige cómo pagar" })).toBeTruthy();
  });

  it("pago único con un pendiente por transferencia: pregunta con la modalidad elegida", async () => {
    await reachPaymentStep();
    reply("/api/checkout", 409, {
      success: false,
      error: "pending_contract_exists",
      message: "Encontramos un registro pendiente a tu nombre.",
      pending: {
        reference: "HM-2026-000007",
        programSlug: "hm-run",
        programName: "HM RUN",
        paymentType: "transfer",
        amount: "1200.00",
        currency: "MXN",
      },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Pago único/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Tienes un registro pendiente" });
    reply(
      "/api/checkout",
      200,
      checkoutCreated({ reference: "HM-2026-000007", outcome: "changed" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Cambiar a HM RUN · Pago único/ }));
    await screen.findByRole("heading", { name: "Paga con tarjeta" });
    expect(calls.at(-1)?.body).toMatchObject({ mode: "payment", pendingAction: "change" });
  });

  it("muestra el error del código y los intentos restantes", async () => {
    reply("/api/verification/request", 200, { success: true });
    reply("/api/verification/confirm", 400, {
      success: false,
      error: "invalid_code",
      message: "El código no es correcto. Te quedan 4 intentos.",
      remainingAttempts: 4,
    });
    render(
      <ApplicationFlow programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillForm();
    await screen.findByRole("heading", { name: "Verifica tu correo" });
    fireEvent.change(screen.getByLabelText("Código de verificación"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    expect(await screen.findByText("El código no es correcto. Te quedan 4 intentos.")).toBeTruthy();
  });

  it("valida el formato del código antes de enviarlo", async () => {
    reply("/api/verification/request", 200, { success: true });
    render(
      <ApplicationFlow programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillForm();
    await screen.findByRole("heading", { name: "Verifica tu correo" });
    fireEvent.change(screen.getByLabelText("Código de verificación"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    expect(await screen.findByText("El código tiene 6 dígitos.")).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it("el reenvío espera 60 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    reply("/api/verification/request", 200, { success: true });
    render(
      <ApplicationFlow programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillForm();
    await screen.findByRole("heading", { name: "Verifica tu correo" });
    const resend = () =>
      screen.getByRole("button", { name: /Reenviar código/ }) as HTMLButtonElement;
    expect(resend().disabled).toBe(true);
    expect(resend().textContent).toMatch(/60 s/);
    for (let i = 0; i < 61; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(resend().disabled).toBe(false);
    reply("/api/verification/request", 200, { success: true });
    fireEvent.click(resend());
    expect(await screen.findByText(/Te enviamos un código nuevo/)).toBeTruthy();
    expect(calls.filter((c) => c.url === "/api/verification/request")).toHaveLength(2);
  });

  it("si la sesión venció al crear la transferencia, pide otro código", async () => {
    await reachPaymentStep();
    reply("/api/transfers", 401, { success: false, error: "verification_required", message: "" });
    reply("/api/verification/request", 200, { success: true });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Verifica tu correo" });
    expect(screen.getByText(/Tu verificación venció/)).toBeTruthy();
  });

  it("sin conexión muestra un error y se queda en el formulario", async () => {
    render(
      <ApplicationFlow programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillForm();
    expect(await screen.findByText(/No pudimos conectar/)).toBeTruthy();
    expect(screen.getByLabelText("Nombre completo")).toBeTruthy();
  });

  it("al regresar al formulario conserva los datos", async () => {
    reply("/api/verification/request", 200, { success: true });
    render(
      <ApplicationFlow programs={PROGRAMS} countries={COUNTRIES} preselectedProgram="hm-run" />,
    );
    fillForm();
    await screen.findByRole("heading", { name: "Verifica tu correo" });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mis datos" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Nombre completo") as HTMLInputElement).value).toBe(
        "Ana López",
      ),
    );
    expect((screen.getByLabelText("Correo electrónico") as HTMLInputElement).value).toBe(
      "Ana@Example.com",
    );
  });
});
