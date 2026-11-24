# Plan de desarrollo — THE HYBRID METHOD (MVP)

Basado en SRS v1.7 y SDD v1.8 (ya incluyen las decisiones A1–A12 y A14–A22). Una fase por sesión de Claude Code → un PR por fase.
Estado: ⬜ pendiente · 🟡 en curso · ✅ terminada

Desde el 2026-11-24 ninguna fase está bloqueada por una decisión: Ferro respondió B1–B12 (DECISIONS A17–A22).
Para el lanzamiento (Fase 8) faltan la compra del dominio, los datos del responsable en el aviso de privacidad y
confirmar con Ferro la regla del pago tardío de un contrato vencido (A20).

---

## Fase 0 — Base del proyecto ✅
- Next.js + TypeScript estricto + Tailwind + ESLint + Prettier + Vitest.
- Estructura de carpetas del SDD §4. `src/lib/config.ts` que lee y valida variables de entorno con Zod.
- `.env.example` del SDD §9.1, más `FERRO_APPROVAL_PIN_HASH` y `OTP_SESSION_SECRET` (DECISIONS A4, A7). Scripts: `dev`, `build`, `lint`, `typecheck`, `test`.
- Tema de Tailwind con los colores y tipografía de marca. README con instrucciones de arranque.
- GitHub Action que corre lint, typecheck y pruebas en cada PR.

**Listo cuando:** `npm run build` pasa y la CI está en verde.

**Resultado (2026-11-23):** Next.js 16 (App Router) + React 19 + TypeScript estricto + Tailwind v4 + ESLint + Prettier + Vitest.
`src/lib/config.ts` con pruebas (política por entorno en DECISIONS A9) y validación al arrancar en `src/instrumentation.ts`.
Tema de marca en `src/app/globals.css` (`ink`, `bone`, `volt`, `font-display`; tipografía en DECISIONS A10).
CI en `.github/workflows/ci.yml` (formato, lint, typecheck, pruebas y build). La página `/` es un placeholder hasta la Fase 1.

## Fase 1 — Landing page ✅ (RF-01, RF-02, RF-03, RNF-02, RNF-04, RNF-05)
- Secciones del SRS §4.2: Hero, About Me, Our Programs, How It Works, Pricing,
  Athlete Application (solo la UI por ahora), FAQ & Contact, footer.
- Los tres programas (HM RUN, HM STRENGTH, HM COMPLETE) desde un solo archivo de datos,
  sin duplicar precios en el código.
- El CTA de cada programa lleva al formulario con ese programa preseleccionado (RF-03).
- Botón flotante/enlace de WhatsApp con el número de `FERRO_WHATSAPP_NUMBER`.
- Textos e imágenes de relleno marcados claramente para que la marca los reemplace.
- Responsive, accesible (contraste, alt, foco) y buen Lighthouse en móvil.

**Resultado (2026-11-23):** secciones del SRS §4.2 + footer en `src/components/{landing,programs,forms,layout}`.
Programas desde `src/content/programs.ts` y textos en `src/content/landing.ts` (DECISIONS A12). Formulario con
validación Zod compartida (`src/lib/validations.ts`, formato de WhatsApp en A11) y preselección por `?programa=`.
El envío del formulario aún no llama al servidor (Fase 3). Páginas provisionales `/privacidad` y `/condiciones`.
Logo oficial en el header (horizontal) y el footer (apilado), y favicon con el símbolo HM (originales en `docs/brand/`).
Lighthouse móvil (build local): rendimiento 96, accesibilidad 100, buenas prácticas 100, SEO 100.

## Fase 2 — Base de datos y servicios ✅ (RF-16, RNF-07, SDD §5)
- `schema.prisma` con Customer, Program, Contract, Payment, Subscription, TransferApproval,
  OTPVerification, WebhookEvent, y un AuditLog para operaciones sensibles (SRS §10).
  **Aplicar DECISIONS A1–A3 y A8:** sin `country`; Contract N:1 Program; estados de Contract sin `paid`;
  Program con `stripePriceIdOneTime` y `stripePriceIdRecurring`; TransferApproval con `pinAttempts`.
- Restricciones UNIQUE (email normalizado, `Contract.reference`, `stripeEventId`), FKs, Decimal.
- Máquina de estados del contrato en `contract.service` con pruebas de transiciones válidas e inválidas.
- Seed con los tres programas. La landing lee los programas de la BD.
- Servicios base (`customer`, `contract`) con transiciones de estado controladas y pruebas.
- Generador de referencias `HM-AAAA-NNNNNN` seguro ante concurrencia.

**Resultado (2026-11-23):** Prisma 7 (`prisma-client` + `@prisma/adapter-pg`) con las nueve entidades del SDD §5
en `prisma/schema.prisma` y una migración inicial con la secuencia de referencias y restricciones CHECK.
Servicios en `src/services/`: `contract` (máquina de estados compare-and-set, referencias, vencimiento),
`customer` (alta o actualización atómica por correo normalizado), `program` (lectura para la landing y seed)
y `audit`. La landing lee los programas de la BD con caché de 5 minutos y usa el catálogo si no hay BD.
Pruebas unitarias y de integración con PostgreSQL real (`TEST_DATABASE_URL`, también en la CI), incluidas
creaciones y activaciones simultáneas. Decisiones de implementación en DECISIONS A14.
WhatsApp de cualquier país con selector de lada (México por defecto), validado con `libphonenumber-js` y guardado
en E.164 (DECISIONS A15, resuelve B13).

## Fase 3 — Formulario, verificación de correo y transferencia ✅ (RF-04, RF-05, RF-06, RF-09, RF-10, RF-15, RF-13 parcial)
- `email.service` con Resend (o registro en consola en desarrollo).
- Formulario con validación en cliente y servidor (Zod compartido): nombre, correo,
  WhatsApp, programa y aceptación de la política de privacidad.
- **Verificación OTP siempre, antes de crear el contrato (DECISIONS A4):**
  `POST /api/verification/request` y `/confirm`, con respuesta idéntica exista o no el correo, hash,
  10 min, 5 intentos, reenvío cada 60 s y rate limit. Tras verificar se emite una sesión de verificación
  de corta duración (cookie httpOnly firmada) que autoriza crear el contrato.
- Selección de método de pago (los de Stripe se muestran deshabilitados hasta la Fase 5).
- `POST /api/transfers`: exige la sesión verificada, crea o asocia el cliente, crea el contrato
  `pending_payment` y la referencia.
- Pantalla de transferencia pendiente con la referencia y un botón `wa.me` con mensaje prellenado.
- Plantillas de correo: código OTP para el cliente y Transfer Pending para Ferro.

**Resultado (2026-11-24):** `POST /api/verification/request`, `/confirm` y `POST /api/transfers` en `src/app/api/`,
con la lógica en `verification.service`, `transfer.service` y `email.service` (Resend o consola, plantillas en
`src/services/email/`). Sesión de verificación firmada en `src/lib/verification-session.ts`, criptografía en
`src/lib/crypto.ts` y rate limit en PostgreSQL (`src/lib/rate-limit.ts`, tabla `rate_limit_buckets`).
Flujo en la landing (`src/components/checkout/`): formulario → código (reenvío a los 60 s) → método de pago
(Stripe deshabilitado) → transferencia pendiente con referencia y botón `wa.me`. El enlace privado de Ferro se
genera en esta fase porque va en el correo Transfer Pending; su pantalla y la confirmación con PIN son de la
Fase 4. Decisiones de implementación en DECISIONS A16. Se corrigió el desbordamiento horizontal del campo de
WhatsApp en celulares. Pruebas: unitarias, de BD (servicios, rate limit y rutas, incluidas las de seguridad del
SDD §12.3 que aplican: sin sesión, cookie falsificada, enumeración de correos, precio manipulado) y de interfaz
del flujo.

## Fase 4 — Ajustes de modelo, confirmación de transferencias y entrega del plan ⬜ (RF-11, RF-12, RF-20, RF-22, RF-23, RN-02, RN-04, RN-05, RN-07, RN-13)
- **Migración (DECISIONS A18–A20, SDD §5.3):** `Program.subscriptionPrice`; entidades ServicePeriod y
  PlanDeliveryLink; estados `scheduled` y `expired` con sus transiciones; `Contract.lastActivityAt`; índice único
  parcial de un pendiente por cliente.
- Catálogo y seed con `subscriptionPrice` (prueba de −10 %). La landing muestra los dos precios y deja de decir
  "el mismo precio en cualquier modalidad"; se quita la nota "[Pendiente] Confirmar si el precio incluye IVA".
- (El token ya se genera en la Fase 3: `createTransferApproval` en `transfer.service`, solo hash, 7 días.)
- **Aplicar DECISIONS A5 y A7.** Script `npm run hash-pin` para generar `FERRO_APPROVAL_PIN_HASH`.
- `GET /transfer/confirm/[token]`: pantalla de solo lectura (`noindex`, `no-referrer`) con los datos del
  contrato, un campo de PIN y los botones "Sí, confirmar pago" / "No, regresar" (este último no hace POST).
- `POST /api/transfers/confirm` con `{ token, pin }`: valida el token, el PIN y que el contrato siga
  en `pending_payment`; en una sola transacción marca el token como usado, crea el Payment, el ServicePeriod (un
  mes desde la confirmación) y su botón de entrega, activa el contrato y escribe la auditoría (IP, user-agent).
  Después envía Transfer Confirmed + Welcome (cliente) y Payment Received con todos los datos del cliente y el
  botón "Registrar entrega del plan" (Ferro). Con 5 PIN incorrectos, el token se invalida.
- **Entrega del plan, solo referencia (SDD §7.8, DECISIONS A19):** `delivery.service`,
  `GET /plan/entrega/[token]` (solo lectura) y `POST /api/plan-delivery/confirm` (guarda la fecha de hoy y
  muestra "Fecha de entrega del plan confirmada"). Sin PIN ni expiración.
- `GET /api/cron/daily` con `CRON_SECRET`: vencimientos, `scheduled → active`, `active → completed`,
  recordatorios de entrega de lunes a viernes (uno por cliente, sin botón) y purga del rate limit.
- Manejo de enlace expirado, enlace usado y contrato ya pagado. Forma de regenerar el enlace.
- Pruebas de seguridad del SDD §12.3 relacionadas con tokens.

## Fase 5 — Pago único con Stripe ⬜ (RF-07, RN-10, RN-11)
- `POST /api/checkout` en modo `payment` (exige la sesión verificada), con el precio tomado de la BD
  (`stripePriceIdOneTime`) y una comprobación de que el importe en Stripe coincide con `monthlyPrice`.
- `POST /api/webhooks/stripe` con verificación de firma, registro en WebhookEvent e idempotencia.
  Solo se escuchan los eventos de DECISIONS A6.
- Payment + ServicePeriod + contrato `active`; correos Purchase Confirmation y Welcome (cliente) y Payment
  Received con el botón de entrega (Ferro), construido en la Fase 4.
- Páginas de éxito y cancelación que solo informan, sin confirmar nada.
- Pruebas con Stripe CLI (`stripe listen`) y webhooks duplicados o con firma inválida.

## Fase 6 — Suscripciones y renovaciones ⬜ (RF-08, RF-17, RF-18, RN-03, RN-14)
- Checkout en modo `subscription` con `stripePriceIdRecurring` (importe = `subscriptionPrice`).
  `customer.subscription.*` solo sincroniza el estado.
- `invoice.paid` es la única fuente de los Payment (el primer pago y las renovaciones): crea un ServicePeriod en
  y su botón de entrega con el periodo de la factura, extiende el contrato y avisa a Ferro (Renewal Successful
  con botón en las renovaciones). Stripe cobra mes con mes desde el primer pago.
- `invoice.payment_failed` → registrar el fallo, suspender (`payment_failed`) y enviar Payment Failed.
  Smart Retries y cancelación al agotarse (configuración de Stripe documentada en el README).
- Pruebas con Stripe test clocks para simular renovaciones y pagos fallidos.

## Fase 7 — Clientes recurrentes, portal y cancelación ⬜ (RF-14, RF-15, RF-19, RF-21, RN-08, RN-15)
- Reglas de SDD §7.3 (DECISIONS A20): un solo pendiente por cliente, reutilizar la referencia, aviso
  "¿continuar o cambiar?", vencimiento a los 7 días sin actividad, pago tardío, un mes por adelantado y bloqueo
  con suscripción activa. `GET /api/contracts/pending`. (Se puede adelantar.)
- `POST /api/portal` con OTP y Stripe Customer Portal (cancelar al final del periodo, cambiar de plan,
  actualizar tarjeta); webhooks y correos de Subscription Cancelled.

## Fase 8 — Lanzamiento ⬜ (RNF-01, RNF-03, RNF-08, SDD §11)
- Versión final de privacidad y condiciones (hay un borrador desde el 2026-11-24, DECISIONS A22): datos del
  responsable y revisión legal.
- Metadatos SEO, Open Graph, favicon, sitemap y página 404.
- Vercel (staging y producción) con el cron diario, Neon, Prisma Migrate en el deploy, webhook de producción en
  Stripe, Customer Portal configurado, dominio de GoDaddy apuntado a Vercel y remitente verificado en Resend.
- Prueba de punta a punta de los tres flujos en staging, incluida la entrega del plan.
