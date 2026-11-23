import { describe, expect, it } from "vitest";

import { buildWhatsAppLink } from "./whatsapp";

describe("buildWhatsAppLink", () => {
  it("genera un enlace wa.me sin mensaje", () => {
    expect(buildWhatsAppLink("5215512345678")).toBe("https://wa.me/5215512345678");
  });

  it("codifica el mensaje prellenado", () => {
    const link = buildWhatsAppLink("5215512345678", "Hola Ferro, ¿cómo estás? & más");
    expect(link).toBe(
      "https://wa.me/5215512345678?text=Hola%20Ferro%2C%20%C2%BFc%C3%B3mo%20est%C3%A1s%3F%20%26%20m%C3%A1s",
    );
    expect(decodeURIComponent(new URL(link).searchParams.get("text") ?? "")).toBe(
      "Hola Ferro, ¿cómo estás? & más",
    );
  });

  it("rechaza números con formato inválido", () => {
    expect(() => buildWhatsAppLink("+52 55 1234 5678")).toThrow();
    expect(() => buildWhatsAppLink("123")).toThrow();
  });
});
