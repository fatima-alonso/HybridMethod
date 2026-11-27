# Plan de desarrollo — THE HYBRID METHOD (MVP)

Basado en SRS v1.10 y SDD v1.18 (ya incluyen las decisiones A1–A12 y A14–A33). Una fase por sesión de Claude Code → un PR por fase.
Estado: ⬜ pendiente · 🟡 en curso · ✅ terminada

Desde el 2026-11-24 ninguna fase está bloqueada por una decisión: Ferro respondió B1–B12 (DECISIONS A17–A22).
Para el lanzamiento (Fase 8) faltan la compra del dominio y los datos del responsable en el aviso de privacidad.

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

## Fase 4 — Ajustes de modelo, confirmación de transferencias y entrega del plan ✅ (RF-11, RF-12, RF-20, RF-22, RF-23, RN-02, RN-04, RN-05, RN-07, RN-13)
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
  `GET /plan/entrega/[token]` (solo lectura) y `POST /api/plan-delivery/confirm` (guarda la fecha elegida, hoy por defecto, y
  muestra "Fecha de entrega del plan confirmada"). Sin PIN; cada botón vence a los 7 días.
- `GET /api/cron/daily` con `CRON_SECRET`: vencimientos, `scheduled → active`, `active → completed`,
  recordatorios de entrega de lunes a viernes (uno por cliente, cada uno con botón nuevo) y purga del rate limit.
- Manejo de enlace expirado, enlace usado y contrato ya pagado. Forma de regenerar el enlace, también para un
  contrato vencido (pago tardío, DECISIONS A20).
- Pruebas de seguridad del SDD §12.3 relacionadas con tokens.

**Avance (2026-11-24), PR de la confirmación de transferencias.** Hecho: `npm run hash-pin` (bcrypt, PIN de 6 a 12
dígitos, hash escapado para `.env`); `GET /transfer/confirm/[token]` (solo lectura, `noindex`/`no-referrer`);
`POST /api/transfers/confirm` (cada intento de PIN se cuenta antes de compararlo; al quinto error se invalida el
enlace; en una transacción: enlace usado, Payment, contrato `active` con un mes desde la confirmación y auditoría
con IP y user-agent; después Transfer Confirmed, Welcome y Payment Received); `POST /api/transfers/regenerate`,
ofrecida en la misma página; Welcome con el aviso de entrega en 3 a 5 días hábiles; formulario de inscripción y de Ferro sin envío nativo (nada en la URL). Decisiones en
DECISIONS A23. Pruebas unitarias, de servicio y de rutas (SDD §12.3).

**Resultado parte 2 (2026-11-25).** Migración (dos archivos) con `subscriptionPrice`, ServicePeriod, PlanDeliveryLink,
estados `scheduled` y `expired`, `lastActivityAt` e índice único de un pendiente por cliente; catálogo y seed con el
precio de suscripción (prueba de −10 %). Reglas de contratación en `contract-request.service` (vencer pendientes,
suscripción activa, reutilizar / "¿continuar o cambiar?", un mes por adelantado) y `GET /api/contracts/pending`.
La confirmación de transferencias crea el ServicePeriod y su botón de entrega, acepta pagos tardíos y deja
`scheduled` los meses pagados por adelantado. Entrega del plan: `GET /plan/entrega/[token]` (solo lectura) y
`POST /api/plan-delivery/confirm`. `GET /api/cron/daily` con `CRON_SECRET` y `vercel.json`: vencimientos,
`scheduled → active`, `active → completed`, recordatorios en días hábiles (sin festivos de la LFT) y purga del rate
limit. La landing y el paso de pago muestran el precio con suscripción. Decisiones en DECISIONS A25. Pruebas
unitarias (calendario, estados, catálogo, correos, interfaz) y con PostgreSQL (reglas A20, periodos, entrega,
recordatorios, cron y rutas).

## Fase 5 — Pago único con Stripe ✅ (RF-07, RN-10, RN-11)
- `POST /api/checkout` en modo `payment` (exige la sesión verificada), con el precio tomado de la BD
  (`stripePriceIdOneTime`) y una comprobación de que el importe en Stripe coincide con `monthlyPrice`.
- `POST /api/webhooks/stripe` con verificación de firma, registro en WebhookEvent e idempotencia.
  Solo se escuchan los eventos de DECISIONS A6.
- Payment + ServicePeriod + contrato `active`; correos Purchase Confirmation y Welcome (cliente) y Payment
  Received con el botón de entrega (Ferro), construido en la Fase 4.
- Páginas de éxito y cancelación que solo informan, sin confirmar nada.
- Pruebas con Stripe CLI (`stripe listen`) y webhooks duplicados o con firma inválida.

**Resultado (2026-11-25).** `npm run stripe:sync` crea en Stripe un Product y dos Prices por programa (por
`lookup_key`) y guarda sus IDs en la BD. `POST /api/checkout` (modo `payment`) con la sesión verificada: comprueba el
Price contra Stripe antes de crear el contrato, aplica las reglas de A20, reutiliza la sesión abierta, expira la
anterior al cambiar el pendiente y crea el cliente de Stripe una sola vez. `POST /api/webhooks/stripe`: firma con el
body crudo, WebhookEvent con bloqueo de fila (entregas repetidas o simultáneas sin efectos, reintento tras un error),
Payment + ServicePeriod + botón de entrega + contrato `active`/`scheduled` (pago tardío incluido), cobro adicional
con aviso a Ferro y pago asíncrono fallido (el contrato sigue pendiente, B15 resuelta). Correos Purchase Confirmation, Welcome y
Payment Received (compartidos con la transferencia). El formulario de pago de Stripe va incrustado en la landing
(Embedded Checkout) y regresa a `/pago/exito`, que solo informa. Por decisión de Ferro se cobra mes con mes: con un mes
vigente no se puede contratar otro (`409 active_period`). Después del PR se cambió al formulario de Checkout Studio
(`ui_mode: form`, tema oscuro, sin pedir el nombre, tarjeta guardada en Stripe). Decisiones en DECISIONS A26–A29. Pruebas: unitarias (importes en
centavos, Prices, plantillas, interfaz) y con PostgreSQL + un Stripe en memoria + firmas reales del SDK (checkout,
reglas, firma inválida, duplicados, simultáneos, fuera de orden, pago asíncrono, pago tardío, mes vigente, error y
reintento). La prueba con la Stripe CLI contra la cuenta de prueba queda documentada en el README (necesita las
claves de la cuenta).

## Fase 6 — Suscripciones y renovaciones ✅ (RF-08, RF-17, RF-18, RN-03, RN-14)
- Checkout en modo `subscription` con `stripePriceIdRecurring` (importe = `subscriptionPrice`).
  `customer.subscription.*` solo sincroniza el estado.
- `invoice.paid` es la única fuente de los Payment (el primer pago y las renovaciones): crea un ServicePeriod en
  y su botón de entrega con el periodo de la factura, extiende el contrato y avisa a Ferro (Renewal Successful
  con botón en las renovaciones). Stripe cobra mes con mes desde el primer pago.
- `invoice.payment_failed` → registrar el fallo, suspender (`payment_failed`) y enviar Payment Failed.
  Tres intentos en días seguidos y cancelación si ninguno pasa (DECISIONS A32; configuración de Stripe en el README).
- Pruebas con Stripe test clocks para simular renovaciones y pagos fallidos.

**Resultado (2026-11-26).** `POST /api/checkout` con `mode: "subscription"` (Price `recurring` comprobado contra
Stripe, `subscriptionPrice`, metadata del contrato en la suscripción) y la opción "Suscripción mensual con tarjeta"
habilitada en la landing, con el mismo formulario incrustado. Webhooks nuevos (`invoice.paid`, `invoice.payment_failed`,
`customer.subscription.created/updated/deleted`) en `stripe-subscription-webhook.service`; cada evento vuelve a leer la
suscripción en Stripe (`subscription.service`), así que tolera duplicados y desorden. `invoice.paid` crea Payment +
ServicePeriod (periodo de la línea de la factura, programa del Price cobrado) + botón de entrega y activa, extiende o
reactiva el contrato; en las renovaciones, Renewal Successful (Ferro) y "Tu suscripción se renovó" (cliente). Cada
intento fallido es un Payment `failed` (índices únicos parciales solo para pagos exitosos); el primer fallo de una
renovación suspende (`payment_failed`) y avisa una vez al cliente y a Ferro. Tres intentos en días seguidos (A32): con el
tercer fallo la app cancela la suscripción en Stripe y el contrato pasa a `cancelled` (los correos de cancelación son de
la Fase 7). Configuración de los reintentos y prueba con
test clocks en el README. Decisiones en DECISIONS A31. Pruebas: unitarias (plantillas, estados de Stripe, periodo de la
factura, interfaz) y con PostgreSQL + un Stripe en memoria que hace de test clock (alta, desorden, duplicados,
renovaciones, cambio de plan, importe 0, fallos y reintentos, cancelación, suscripción duplicada, Stripe caído).

## Fase 7 — Clientes recurrentes, portal y cancelación ✅ (RF-14, RF-15, RF-19, RF-21, RN-08, RN-15)
- Reglas de SDD §7.3 (DECISIONS A20): un solo pendiente por cliente, reutilizar la referencia, aviso
  "¿continuar o cambiar?", vencimiento a los 7 días sin actividad, pago tardío, mes con mes sin pagos por adelantado (A28) y bloqueo
  con suscripción activa. `GET /api/contracts/pending`. (Se puede adelantar.)
- `POST /api/portal` con OTP y Stripe Customer Portal (cancelar al final del periodo, cambiar de plan,
  actualizar tarjeta); webhooks y correos de Subscription Cancelled.

**Resultado (2026-11-27).** Las reglas de SDD §7.3 ya estaban desde las Fases 4–6; se revisaron contra el SDD y se
corrigió "Continuar con el pendiente": cuando el pendiente era de otra modalidad, la página pedía la que el cliente
acababa de elegir y el servidor le decía que eligiera "Cambiar". Ahora pide la modalidad y el programa del pendiente, y
el botón dice cuál ("Continuar con HM STRENGTH · Transferencia"). Portal (DECISIONS A33): página `/suscripcion`
(correo → código → Stripe Customer Portal), enlazada en el pie de página y en los correos de la suscripción, y botón
directo al portal en el aviso de `409 subscription_active`. `POST /api/portal` abre el portal con una suscripción
`active`, `past_due` o `unpaid` y responde igual (`404`) exista o no el correo. Los webhooks comparan la Subscription
antes y después de sincronizar y avisan al cliente y a Ferro, una sola vez: cancelación programada (sigue hasta el
final del periodo), cancelación deshecha, cambio de programa (aplica en la siguiente renovación) y fin de la suscripción
(contrato `cancelled`; texto propio si fue por cobros fallidos). Configuración del Customer Portal en el README.
Pruebas: plantillas, flujo de la página y del aviso de suscripción activa, y con PostgreSQL + el Stripe en memoria
(portal con y sin suscripción, otro correo, `past_due`, terminada, Stripe caído, rate limit; cancelar, deshacer, `cancel_at`,
fin del periodo, cobros fallidos, cambio de programa y eventos repetidos o fuera de orden).

## Fase 7B — Cupones de descuento en el pago único ⬜ (RF-07, RN-10, RN-11)
Ferro quiere dar descuentos o no cobrarle a algunas personas (2026-11-27). Alcance decidido por la dueña del proyecto:
**solo en el pago único con tarjeta** (Checkout en modo `payment`), incluido el 100 % (cortesía). Ni la suscripción ni la
transferencia llevan cupones. Va antes del lanzamiento. Se registra en DECISIONS (A34) y en el SRS/SDD al implementarla.
- Ferro crea los cupones y los códigos promocionales en el Dashboard de Stripe (porcentaje o monto fijo, vigencia,
  límite de usos, uno por cliente). No hay panel propio (fuera de alcance).
- **Primero, en modo de prueba:** comprobar que el formulario de Checkout Studio (`ui_mode: form`, DECISIONS A29)
  muestra el campo de código y que una sesión de pago único acepta un total de $0. Si no muestra el campo, un campo
  propio en el paso de pago que solo manda el código: el servidor lo valida contra Stripe y lo aplica a la sesión
  (`discounts`); el navegador nunca manda importes (SDD §9.2).
- `POST /api/checkout`: `allow_promotion_codes` solo en modo `payment`. Una sesión abierta se reutiliza como hoy.
- Webhook: con total $0 (`payment_status = no_payment_required`) el contrato se activa igual que con `paid`
  (Payment de importe 0, ServicePeriod y botón de entrega). Hoy esa sesión se ignoraría y el cliente se quedaría sin
  servicio.
- Registrar el descuento en el Payment (código, cupón y monto descontado; migración). Un cobro menor por un cupón ya no
  se audita como `stripe.amount_mismatch`, sino como `stripe.discount_applied`.
- Correos: Purchase Confirmation y Payment Received muestran precio, descuento (con el código) y total; con el 100 %,
  "Cortesía" en lugar del importe.
- Las reglas de contratación no cambian: mes con mes, un solo pendiente, vencimiento a los 7 días.
- Condiciones (`/condiciones`): mencionar los códigos de descuento en el pago único.
- Pruebas: descuento parcial y del 100 % con el Stripe en memoria, correos, que la suscripción no acepta códigos y
  que el navegador no puede mandar un importe ni un cupón que Stripe no aplicó.

## Fase 8 — Lanzamiento ⬜ (RNF-01, RNF-03, RNF-08, SDD §11)
- Versión final de privacidad y condiciones (hay un borrador desde el 2026-11-24, DECISIONS A22): datos del
  responsable y revisión legal.
- Metadatos SEO, Open Graph, favicon, sitemap y página 404.
- Vercel (staging y producción) con el cron diario, Neon, Prisma Migrate en el deploy, webhook de producción en
  Stripe, Customer Portal configurado, dominio de GoDaddy apuntado a Vercel y remitente verificado en Resend.
- Stripe en modo live: claves live en Vercel, `npm run stripe:sync -- --live`, endpoint de webhook de producción (su
  `whsec_` en Vercel), OXXO desactivado y recibos de Stripe activados (DECISIONS A26).
- Prueba de punta a punta de los tres flujos en staging, incluida la entrega del plan.
