# THE HYBRID METHOD — instrucciones para Claude

Landing page + plataforma básica de contratación y pagos para THE HYBRID METHOD (by Ferro Fits),
servicio de entrenamiento personalizado de fuerza, running y rendimiento híbrido.

## Documentos de referencia (fuente de verdad)
- `docs/SRS.md` — requisitos (RF-xx), reglas de negocio (RN-xx), no funcionales (RNF-xx). SRS v1.7.
- `docs/SDD.md` — arquitectura, modelo de datos, API, flujos, seguridad. SDD v1.10.
- `docs/PLAN.md` — fases de desarrollo y su estado.
- `docs/DECISIONS.md` — registro de decisiones (A1–A12 y A14–A25 ya están integradas en el SRS/SDD; A13 es de contenido) y pendientes.

Para el diseño técnico, el SDD es la referencia principal. Cuando se tome una decisión nueva,
se registra en DECISIONS.md y se actualizan el SRS/SDD en el mismo PR.
Si algo del código contradice los documentos, ganan los documentos. Si los documentos se contradicen
entre sí o algo no está definido, **no inventes la regla**: pregunta, o implementa detrás de una
configuración y regístralo en `docs/DECISIONS.md`.

## Stack
Next.js (App Router, Route Handlers) · TypeScript estricto · Tailwind CSS · PostgreSQL (Neon) ·
Prisma · Stripe Checkout + Billing + Webhooks · Resend · Vercel. Validación con Zod. Pruebas con Vitest.

## Estructura
Seguir la estructura de la sección 4 del SDD (`src/app`, `src/components`, `src/lib`,
`src/services`, `src/types`, `src/utils`, `prisma/`). Separar presentación, lógica de negocio
(`services/`), acceso a datos e integraciones externas (RNF-06). Los cambios de estado de
contratos, pagos y suscripciones solo ocurren dentro de `services/`.

## Reglas que nunca se rompen
- El navegador nunca decide importes ni Price IDs: el servidor los toma de la BD (SDD 6.1, 9.2).
- Dinero en `Decimal`, nunca `float`.
- Verificar la firma de todos los webhooks de Stripe; procesarlos de forma idempotente
  (`WebhookEvent.stripeEventId` UNIQUE). No confirmar pagos desde la página de éxito.
- El servicio solo se activa tras un pago confirmado (Stripe o confirmación manual de Ferro).
- Tokens y OTP: aleatorios criptográficamente seguros, guardar solo el hash, con expiración,
  un solo uso.
- Abrir el enlace de confirmación de transferencia es solo lectura; confirmar requiere un POST
  explícito con el PIN de Ferro. No existe la acción `reject`.
- No se crea ningún contrato sin una verificación OTP del correo en la sesión.
- Nunca exponer datos de un cliente solo por conocer su correo.
- No guardar datos de tarjeta. No subir secretos: usar variables de entorno y mantener
  `.env.example` actualizado.

## Fuera de alcance (no construir)
Dashboard de atletas, cuentas con contraseña, cuestionarios deportivos, PDFs de rutinas,
API de WhatsApp (solo enlaces `wa.me`), reembolsos automáticos, panel admin en el MVP.

## Identidad visual
Negro `#111111` (70%) · Off-white `#F5F3EE` (20%) · Volt Orange `#FF6A00` (10%).
Estilo premium, deportivo y editorial; sans-serif con encabezados fuertes y condensados.
Mobile-first. Textos de la interfaz en español salvo los nombres de sección definidos en el SRS 4.2
el titular y subtítulo del hero (DECISIONS A13) y los textos de marca de About Me (DECISIONS A24).

## Forma de trabajar
- Trabaja una fase de `docs/PLAN.md` a la vez; al terminar, marca su estado en el plan.
- Cada fase incluye pruebas de lo que toca e indica en el PR qué RF/RN cubre.
- Sin claves reales, los servicios externos deben funcionar en modo desarrollo
  (p. ej. el servicio de correo registra en consola si falta `RESEND_API_KEY`).
- Antes de terminar: `npm run lint`, `npm run typecheck` y `npm test` sin errores.
