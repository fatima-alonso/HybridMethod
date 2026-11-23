import { describe, expect, it } from "vitest";

import { applicationSchema, normalizePhone, phoneSchema } from "./validations";

const valid = {
  fullName: "  Ana López  ",
  email: " Ana@Example.COM ",
  whatsapp: "55 1234 5678",
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
      whatsapp: "5512345678",
      program: "hm-run",
      privacyAccepted: true,
    });
  });

  it("exige todos los campos", () => {
    const errors = errorsOf({
      fullName: "",
      email: "",
      whatsapp: "",
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

describe("phoneSchema", () => {
  it.each([
    ["5512345678", "5512345678"],
    ["55-1234-5678", "5512345678"],
    ["(55) 1234 5678", "5512345678"],
    ["+52 55 1234 5678", "+525512345678"],
    ["+1 (415) 555-0100", "+14155550100"],
  ])("acepta %s → %s", (input, expected) => {
    expect(phoneSchema.parse(input)).toBe(expected);
  });

  it.each(["12345", "55 1234 567a", "+52 55 1234 5678 9012 3", "abc", "++525512345678"])(
    "rechaza %s",
    (input) => {
      expect(phoneSchema.safeParse(input).success).toBe(false);
    },
  );

  it("normalizePhone conserva solo el + inicial y los dígitos", () => {
    expect(normalizePhone(" +52 (55) 1234-5678 ")).toBe("+525512345678");
  });
});
