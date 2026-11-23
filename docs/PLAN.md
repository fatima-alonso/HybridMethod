# Plan de desarrollo — THE HYBRID METHOD (MVP)

Basado en SRS v1.5 y SDD v1.5 (ya incluyen las decisiones A1–A12). Una fase por sesión de Claude Code → un PR por fase.
Estado: ⬜ pendiente · 🟡 en curso · ✅ terminada

Las fases 0–4 se pueden construir completas sin ninguna decisión pendiente.
Las decisiones que bloquean cada fase están en `docs/DECISIONS.md`.

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

## Fase 2 — Base de datos y servicios ⬜ (RF-16, RNF-07, SDD §5)
- `schema.prisma` con Customer, Program, Contract, Payment, Subscription, TransferApproval,
  OTPVerification, WebhookEvent, y un AuditLog para operaciones sensibles (SRS §10).
  **Aplicar DECISIONS A1–A3 y A8:** sin `country`; Contract N:1 Program; estados de Contract sin `paid`;
  Program con `stripePriceIdOneTime` y `stripePriceIdRecurring`; TransferApproval con `pinAttempts`.
- Restricciones UNIQUE (email normalizado, `Contract.reference`, `stripeEventId`), FKs, Decimal.
- Máquina de estados del contrato en `contract.service` con pruebas de transiciones válidas e inválidas.
- Seed con los tres programas. La landing lee los programas de la BD.
- Servicios base (`customer`, `contract`) con transiciones de estado controladas y pruebas.
- Generador de referencias `HM-AAAA-NNNNNN` seguro ante concurrencia.

## Fase 3 — Formulario, verificación de correo y transferencia ⬜ (RF-04, RF-05, RF-06, RF-09, RF-10, RF-15, RF-13 parcial)
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

## Fase 4 — Confirmación manual de transferencias ⬜ (RF-11, RF-12, RF-20, RN-04, RN-05)
- Generar el token (solo se guarda el hash), con expiración configurable (propuesta: 7 días) y un solo uso.
- **Aplicar DECISIONS A5 y A7.** Script `npm run hash-pin` para generar `FERRO_APPROVAL_PIN_HASH`.
- `GET /transfer/confirm/[token]`: pantalla de solo lectura (`noindex`, `no-referrer`) con los datos del
  contrato, un campo de PIN y los botones "Sí, confirmar pago" / "No, regresar" (este último no hace POST).
- `POST /api/transfers/confirm` con `{ token, pin }`: valida el token, el PIN y que el contrato siga
  en `pending_payment`; en una sola transacción marca el token como usado, crea el Payment, activa el contrato
  (fechas de inicio y fin) y escribe la auditoría (IP, user-agent). Después envía los correos
  Transfer Confirmed + Welcome. Con 5 PIN incorrectos, el token se invalida.
- Manejo de enlace expirado, enlace usado y contrato ya pagado. Forma de regenerar el enlace.
- Pruebas de seguridad del SDD §12.3 relacionadas con tokens.

## Fase 5 — Pago único con Stripe ⬜ (RF-07, RN-10, RN-11)
- `POST /api/checkout` en modo `payment` (exige la sesión verificada), con el precio tomado de la BD
  (`stripePriceIdOneTime`) y una comprobación de que el importe en Stripe coincide (DECISIONS A8).
- `POST /api/webhooks/stripe` con verificación de firma, registro en WebhookEvent e idempotencia.
  Solo se escuchan los eventos de DECISIONS A6.
- Activación del contrato, registro del Payment y correos Purchase Confirmation, Welcome y Payment Received.
- Páginas de éxito y cancelación que solo informan, sin confirmar nada.
- Pruebas con Stripe CLI (`stripe listen`) y webhooks duplicados o con firma inválida.

## Fase 6 — Suscripciones y renovaciones ⬜ (RF-08, RF-17, RF-18, RN-03)
- Checkout en modo `subscription` con `stripePriceIdRecurring`. `customer.subscription.*` solo sincroniza el estado.
- `invoice.paid` es la única fuente de los Payment (el primer pago y las renovaciones): se actualiza el periodo
  del contrato y se avisa a Ferro (Renewal Successful en las renovaciones).
- `invoice.payment_failed` → registrar el fallo, actualizar el estado y enviar Payment Failed.
- Pruebas con Stripe test clocks para simular renovaciones.

## Fase 7 — Clientes recurrentes y cancelación ⬜ (RF-14, RF-15, RF-19, RF-21)
- (El OTP ya existe desde la Fase 3.) Reutilizarlo para que el cliente acceda a la cancelación.
- Cancelación según la decisión que se tome (recomendado: Stripe Customer Portal), con correos de
  Subscription Cancelled.
- Reglas para nuevas contrataciones sobre un periodo vigente (requiere decisión).

## Fase 8 — Lanzamiento ⬜ (RNF-01, RNF-03, RNF-08, SDD §11)
- Páginas de política de privacidad y condiciones de contratación, enlazadas desde el formulario y el footer.
- Metadatos SEO, Open Graph, favicon, sitemap y página 404.
- Vercel (staging y producción), Neon, Prisma Migrate en el deploy, webhook de producción en Stripe,
  dominio y remitente verificados en Resend.
- Prueba de punta a punta de los tres flujos en staging.
