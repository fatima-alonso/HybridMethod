/**
 * Se ejecuta una vez al arrancar el servidor de Next.js.
 * Valida las variables de entorno para fallar pronto si falta alguna (SDD §9.1).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getConfig } = await import("@/lib/config");
    getConfig();
  }
}
