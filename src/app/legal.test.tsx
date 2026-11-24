// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import TermsPage from "./condiciones/page";
import PrivacyPage from "./privacidad/page";

afterEach(cleanup);

describe("borradores legales (DECISIONS A22)", () => {
  it("la política de privacidad muestra sus secciones y que es un borrador", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Política de privacidad" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Tus derechos" })).toBeTruthy();
    expect(screen.getByText(/Borrador/)).toBeTruthy();
  });

  it("las condiciones explican el inicio del mes y el descuento de la suscripción", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { name: "Inicio de tu mes" })).toBeTruthy();
    expect(screen.getByText(/empieza el día en que recibes el plan/)).toBeTruthy();
    expect(screen.getByText(/10 % de descuento/)).toBeTruthy();
  });
});
