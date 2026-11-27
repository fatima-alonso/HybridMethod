/**
 * Navegación del navegador a otra página (p. ej. el Stripe Customer Portal). Es un objeto para que
 * las pruebas puedan reemplazar `assign` (jsdom no navega).
 */
export const navigation = {
  assign: (url: string) => window.location.assign(url),
};
