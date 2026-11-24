import {
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

/**
 * Números de WhatsApp (RF-05, DECISIONS A11, B13).
 *
 * El cliente elige el país (México por defecto) y escribe su número local; se valida con las reglas
 * de ese país (`libphonenumber-js`) y se guarda en formato E.164 (`+525512345678`), que es el que
 * piden el SDD §5.3 y los enlaces `wa.me`. Si el número escrito empieza con "+", su lada manda sobre
 * el país elegido.
 */

export type { CountryCode };

export const DEFAULT_PHONE_COUNTRY: CountryCode = "MX";

export function isPhoneCountry(value: unknown): value is CountryCode {
  return typeof value === "string" && isSupportedCountry(value);
}

/** Convierte un número escrito por el cliente a E.164, o `null` si no es válido para ese país. */
export function toE164(number: string, country: CountryCode): string | null {
  const parsed = parsePhoneNumberFromString(number, country);
  return parsed?.isValid() ? parsed.number : null;
}

/** `true` si el valor ya es un número E.164 válido (p. ej. el que se guarda en Customer). */
export function isE164(value: string): boolean {
  if (!/^\+[1-9]\d{6,14}$/.test(value)) return false;
  const parsed = parsePhoneNumberFromString(value);
  return Boolean(parsed?.isValid() && parsed.number === value);
}

export type PhoneCountryOption = { code: CountryCode; label: string };

/**
 * Países para el selector del formulario ("+52 México"): México primero y el resto en orden
 * alfabético por nombre en español. Se calcula en el servidor y se pasa como prop al formulario para que el
 * HTML prerenderizado y el del navegador coincidan (los nombres de `Intl` pueden variar).
 */
export function getPhoneCountryOptions(): PhoneCountryOption[] {
  const names = new Intl.DisplayNames(["es"], { type: "region" });
  const collator = new Intl.Collator("es");
  return (
    getCountries()
      .map((code) => ({ code, name: names.of(code) ?? code }))
      .sort((a, b) =>
        a.code === DEFAULT_PHONE_COUNTRY
          ? -1
          : b.code === DEFAULT_PHONE_COUNTRY
            ? 1
            : collator.compare(a.name, b.name),
      )
      // La lada va primero para que se vea aunque el selector recorte el nombre en móvil.
      .map(({ code, name }) => ({ code, label: `+${getCountryCallingCode(code)} ${name}` }))
  );
}
