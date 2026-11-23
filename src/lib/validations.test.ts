import { describe, expect, it } from "vitest";

import { applicationSchema, customerDataSchema, whatsappInputSchema } from "./validations";

const valid = {
  fullName: "  Ana López  ",
  email: " Ana@Example.COM ",
  whatsapp: { country: "MX", number: "55 1234 5678" },
  program: "hm-run",
  privacyAccepted: true,
};

function errorsOf(input: unknown) {
  const result = applicationSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));
}

describe("applicationSchema (RF-04, RF-05)", () => {
  it("acepta datos válidos y los normaliza", () => {
    expect(applicationSchema.parse(valid)).toEqual({
      fullName: "Ana López",
      email: "ana@example.com",
      whatsapp: "+525512345678",
      program: "hm-run",
      privacyAccepted: true,
    });
  });

  it("exige todos los campos", () => {
    const errors = errorsOf({
      fullName: "",
      email: "",
      whatsapp: { country: "MX", number: "" },
      program: "",
      privacyAccepted: false,
    });
    expect(Object.keys(errors).sort()).toEqual(
      ["email", "fullName", "privacyAccepted", "program", "whatsapp"].sort(),
    );
  });

  it("rechaza un objeto sin campos (registros incompletos)", () => {
    expect(Object.keys(errorsOf({})).length).toBe(5);
  });

  it("valida el formato del correo", () => {
    expect(errorsOf({ ...valid, email: "ana@" }).email).toBe(
      "Escribe un correo electrónico válido.",
    );
  });

  it("exige aceptar la política de privacidad (literal true)", () => {
    expect(errorsOf({ ...valid, privacyAccepted: false }).privacyAccepted).toBeDefined();
    expect(errorsOf({ ...valid, privacyAccepted: "true" }).privacyAccepted).toBeDefined();
  });

  it("solo acepta programas del catálogo", () => {
    expect(errorsOf({ ...valid, program: "hm-yoga" }).program).toBe("Elige un programa.");
  });

  it("no acepta campos extra como país (DECISIONS A1): se descartan", () => {
    const parsed = applicationSchema.parse({ ...valid, country: "MX" });
    expect(parsed).not.toHaveProperty("country");
  });
});

describe("whatsappInputSchema (DECISIONS A11, B13)", () => {
  it.each([
    ["MX", "5512345678", "+525512345678"],
    ["MX", "55-1234-5678", "+525512345678"],
    ["MX", "(55) 1234 5678", "+525512345678"],
    ["MX", "+52 55 1234 5678", "+525512345678"],
    ["US", "(415) 555-2671", "+14155552671"],
    ["ES", "612 34 56 78", "+34612345678"],
    ["AR", "11 2345 6789", "+541123456789"],
    ["CO", "321 123 4567", "+573211234567"],
    // Si el número trae su lada, esa manda sobre el país elegido.
    ["MX", "+1 415 555 2671", "+14155552671"],
  ])("%s %s → %s", (country, number, expected) => {
    expect(whatsappInputSchema.parse({ country, number })).toBe(expected);
  });

  it.each([
    ["MX", "12345"],
    ["MX", "55 1234 567"],
    ["MX", "55 1234 567a"],
    ["MX", "abc"],
    ["ES", "55 1234 5678"],
    ["MX", ""],
  ])("rechaza %s %s", (country, number) => {
    const result = whatsappInputSchema.safeParse({ country, number });
    expect(result.success).toBe(false);
  });

  it("rechaza un país desconocido", () => {
    expect(whatsappInputSchema.safeParse({ country: "XX", number: "5512345678" }).success).toBe(
      false,
    );
  });

  it("el error de número inválido apunta al número", () => {
    const result = whatsappInputSchema.safeParse({ country: "MX", number: "123" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["number"],
      message: "Ese número no es válido para el país elegido.",
    });
  });
});

describe("customerDataSchema (lo que se guarda en Customer)", () => {
  const data = { fullName: "Ana López", email: "ana@example.com", whatsapp: "+525512345678" };

  it("acepta el WhatsApp en E.164", () => {
    expect(customerDataSchema.parse(data).whatsapp).toBe("+525512345678");
  });

  it.each(["5512345678", "+52 55 1234 5678", "+5255123", "+520445512345678"])(
    "rechaza %s (no es E.164 válido)",
    (whatsapp) => {
      expect(customerDataSchema.safeParse({ ...data, whatsapp }).success).toBe(false);
    },
  );
});
