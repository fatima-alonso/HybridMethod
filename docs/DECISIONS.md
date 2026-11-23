# Decisiones — THE HYBRID METHOD

Registro de decisiones y temas pendientes. Las decisiones A1–A8 ya están integradas en
**SRS v1.4** y **SDD v1.3**; A9 en **SDD v1.4**; A11 y A12 en **SRS v1.5** y **SDD v1.5**; A14 en **SDD v1.6**; este archivo conserva el porqué de cada una. Cuando se tome una
decisión nueva, se anota aquí y se actualizan el SRS/SDD en el mismo cambio.

## A. Decisiones tomadas (2026-11-23)

### A1. Se elimina el campo `country`
`POST /api/customers` no recibe `country`. No existe en el modelo, ni en el formulario, ni en la API.

### A2. Relación Contract → Program: N:1
Un programa tiene muchos contratos (`Contract.programId` es una FK a `Program`). Corrige el 1:1 de SDD §5.2.
Lo mismo aplica a `Subscription.programId`.

### A3. Estados del contrato: se elimina `paid`
El servicio empieza en el momento en que se confirma el pago, así que no hace falta un estado intermedio.
Estados finales de `Contract.status`:

| Estado | Significado |
|---|---|
| `pending_payment` | Creado y esperando el pago (transferencia sin aprobar, o Checkout sin completar). |
| `active` | Pago confirmado. Tiene `serviceStartDate` y `serviceEndDate`. |
| `completed` | Terminó el periodo pagado sin renovación (pago único o transferencia). |
| `payment_failed` | Falló el cobro (suscripción `past_due`/`unpaid`, o pago asíncrono fallido). |
| `cancelled` | Suscripción cancelada; nunca se recorta un periodo ya pagado. |

Transiciones permitidas (solo dentro de `services/`):
`pending_payment → active`, `active → completed`, `active → payment_failed`,
`payment_failed → active` (si se paga el reintento), `active | payment_failed → cancelled`.
"Pagado" se registra en `Payment.status = succeeded`, no en el contrato.
`active → completed` lo calcula el sistema al leer el contrato (`serviceEndDate < now`), o lo hace
un cron diario de Vercel. En suscripciones, el periodo se extiende con cada `invoice.paid`.

### A4. Verificar el correo siempre, antes de crear el contrato
Al enviar el formulario, **siempre** se manda un OTP de 6 dígitos al correo, sea nuevo o ya registrado,
y el contrato se crea solo después de verificarlo.
- Así nadie puede averiguar si un correo ya está registrado (la respuesta es igual en ambos casos)
  y se confirma que el correo es real antes de mandarle confirmaciones (RF-15, SDD §7.1).
- Si el correo ya existe, después de verificarlo la contratación se asocia a ese Customer
  (se actualizan el nombre y el WhatsApp si cambiaron). Si no existe, se crea.
- OTP: se guarda el hash, expira en 10 minutos, permite 5 intentos, es de un solo uso,
  tiene un botón para reenviar con espera de 60 s y rate limit por correo e IP.
- Flujo: formulario → "te enviamos un código" → código → método de pago → (Stripe | pantalla de transferencia).
- Esto adelanta parte de la Fase 7 a la Fase 3.

### A5. Se elimina `reject`
"No, regresar" no envía nada al servidor: solo cierra o regresa, y el contrato sigue en `pending_payment`.
`POST /api/transfers/confirm` acepta solo `{ token, pin }` y significa aprobar.
El contrato queda en `pending_payment` mientras Ferro no lo apruebe con el enlace que recibe por correo.

### A6. Una sola fuente de verdad por flujo en los webhooks
- Pago único: `checkout.session.completed` (si `payment_status = paid`) y
  `checkout.session.async_payment_succeeded` / `async_payment_failed`.
- Suscripción: `invoice.paid` es la **única** fuente que crea Payments (el primer pago y las renovaciones);
  `invoice.payment_failed` registra los fallos; `customer.subscription.created/updated/deleted`
  solo sincroniza el estado de Subscription.
- No se escucha `payment_intent.succeeded` ni `payment_intent.payment_failed`.

### A7. Confirmación de transferencia: enlace + PIN de Ferro
Para aprobar hacen falta dos cosas: el **enlace** que llega al correo de Ferro (lo que tiene) y un **PIN**
que solo él conoce (lo que sabe). Si el enlace se reenvía, se filtra o un escáner lo abre,
no basta para aprobar.
- El PIN (6 dígitos o más) se guarda solo como hash en la variable `FERRO_APPROVAL_PIN_HASH`
  (bcrypt/argon2). Hay un script `npm run hash-pin` para generarlo.
- GET del enlace: solo lectura (datos del contrato, campo de PIN, botones).
- POST: valida el token (hash, vigencia, sin usar), el PIN y que el contrato siga en `pending_payment`.
  Todo en una sola transacción: marca el token como usado, crea el Payment, activa el contrato
  y escribe la auditoría.
- Con 5 PIN incorrectos sobre el mismo token, el token se invalida y hay que regenerar el enlace.
- `approvedBy = "ferro"`. En AuditLog se guardan la IP, el user-agent y la fecha y hora.
- Encabezados `Referrer-Policy: no-referrer` y `noindex` en la página del enlace.
- Vigencia del enlace: 7 días, configurable. Si expira, el contrato no cambia y se puede regenerar.

### A8. Mismo precio para el pago único y la suscripción
`Program.monthlyPrice` es el único precio. En Stripe, cada programa tiene **dos** Prices con el mismo importe:
uno `one_time` y uno `recurring` mensual. El modelo Program cambia `stripePriceId` por
`stripePriceIdOneTime` y `stripePriceIdRecurring`. Al iniciar, el backend verifica que el importe
de cada Price en Stripe coincida con `monthlyPrice` y registra un error si no coincide.

### A9. Validación de variables de entorno por entorno (Fase 0, 2026-11-23)
SDD §9.1 pide validar "las variables obligatorias" sin decir cuáles lo son en cada entorno, y CLAUDE.md exige
que sin claves reales los servicios funcionen en modo desarrollo. Se implementa así (`src/lib/config.ts`):
- **Producción** (`NODE_ENV=production`, incluye los previews de Vercel): todas las variables de SDD §9.1 son
  obligatorias, salvo `TRANSFER_LINK_TTL_DAYS` (7 por defecto, rango 1–30). Si falta alguna, el servidor
  no arranca (`src/instrumentation.ts`).
- **Desarrollo y pruebas**: todas son opcionales; `APP_URL` vale `http://localhost:3000` por defecto.
  Cada servicio decide su modo de desarrollo cuando falta su clave.
- En cualquier entorno, una variable definida se valida siempre (prefijos `sk_`/`whsec_`/`pk_`/`re_`,
  URL de PostgreSQL, correo, WhatsApp solo dígitos en formato `wa.me`, hash bcrypt/argon2,
  `OTP_SESSION_SECRET` de 32+ caracteres). Las cadenas vacías cuentan como no definidas.
- La validación es perezosa para que `next build` (y la CI) no necesiten secretos.
- Los errores solo nombran la variable y el motivo; nunca incluyen su valor.

### A10. Tipografía de marca (Fase 0, 2026-11-23)
SRS §4 pide "sans-serif con encabezados fuertes y condensados" sin nombrar fuentes. Se usan
**Barlow Condensed** (600–800) para encabezados y **Inter** para el cuerpo, vía `next/font/google`.
Es reversible: si la marca tiene fuentes propias, se reemplazan en `src/app/layout.tsx` y `public/fonts/`.

### A11. Formato permitido del WhatsApp del cliente (Fase 1, 2026-11-23)
RF-05 pide validar que el número tenga "un formato permitido" sin definirlo. Se acepta un "+" opcional y
de 10 a 15 dígitos (10 = número nacional de México; con lada internacional hasta 15, como E.164). Se
permiten espacios, guiones, puntos y paréntesis como separadores; el valor se normaliza a `+` y dígitos
(`src/lib/validations.ts`, esquema compartido entre cliente y servidor). Si Ferro quiere restringirlo
(p. ej. solo México), se cambia en ese esquema.

### A12. Contenido de la landing y WhatsApp en la página prerenderizada (Fase 1, 2026-11-23)
- El catálogo de programas (`src/content/programs.ts`) es la única fuente de nombres, descripciones y
  precios en el código, con precios como decimales en texto. En la Fase 2 alimenta el seed y la landing
  pasa a leer de la BD. Los textos de la landing viven en `src/content/landing.ts`; lo que es relleno
  está marcado como PLACEHOLDER y las imágenes como "Imagen pendiente".
- La landing es estática (se prerenderiza en `next build`). Para no exigir los secretos de producción en
  el build (A9), lee solo `FERRO_WHATSAPP_NUMBER` con `getWhatsAppNumber()`. Si falta, se ocultan el botón
  flotante y el enlace de contacto. Cambiar el número requiere volver a desplegar.
- El CTA de cada programa enlaza a `/?programa=<slug>#athlete-application` (RF-03).
- `/privacidad` y `/condiciones` existen como páginas provisionales para que funcionen los enlaces del
  formulario y del footer; su texto definitivo llega en la Fase 8 (B12).

### A13. Titular y subtítulo del hero en inglés (Fase 1, 2026-11-23)
Por decisión de la marca, el titular ("Run. Lift. Hybrid.") y el subtítulo del hero van en inglés.
Es una excepción acotada a la regla de textos en español (CLAUDE.md); el resto de la interfaz sigue en
español salvo los nombres de sección del SRS §4.2. Están en `HERO` de `src/content/landing.ts`.

### A14. Base de datos y servicios (Fase 2, 2026-11-23)
Puntos que el SDD no definía y que se resolvieron así al implementar la Fase 2. Todos son reversibles.

**Programas: BD y catálogo.**
- La BD es la fuente de los datos comerciales de cada programa: nombre, descripción, `monthlyPrice`,
  moneda, `active`, orden y Price IDs de Stripe. La landing, el formulario y (desde la Fase 3) el servidor
  los leen de ahí.
- `src/content/programs.ts` sigue siendo la única fuente en el **código**: alimenta el seed
  (`npm run db:seed`, idempotente) y aporta los textos editoriales de la landing (`summary`,
  `highlights`, `featured`), que no están en el modelo del SDD. Sin panel admin (fuera de alcance), para
  cambiar un precio se edita el catálogo y se vuelve a ejecutar el seed. El seed nunca toca los Price IDs.
- Se agregan a Program `displayOrder` (orden en la landing) y `updatedAt`.
- Si no hay `DATABASE_URL` (desarrollo sin BD, pruebas, `next build` en la CI), la landing usa el catálogo
  directamente. Si hay BD y falla, la página falla: es preferible a mostrar precios distintos a los que
  se cobran. En producción el servidor no arranca sin `DATABASE_URL` (A9).
- La landing sigue siendo estática con caché de Next.js (`"use cache"` + `cacheLife`): se regenera con la
  BD como máximo cada 5 minutos. El importe que se cobra siempre lo lee el servidor de la BD.
- El build lee la BD, así que el cliente de Prisma valida solo `DATABASE_URL` (`getDatabaseUrl()`), sin
  exigir los demás secretos de producción (igual que `getWhatsAppNumber()` en A12).

**Referencias `HM-AAAA-NNNNNN`.**
- `NNNNNN` sale de la secuencia de PostgreSQL `contract_reference_seq` (`nextval` es atómico; puede
  haber huecos si una creación falla). No se reinicia cada año. Si pasa de 999999 usa más dígitos.
- `AAAA` es el año de creación en la zona horaria del negocio, `America/Mexico_City`.

**Contratos.**
- Cada transición es un compare-and-set (`UPDATE … WHERE status IN (orígenes permitidos)`): con dos
  intentos simultáneos (p. ej. un webhook duplicado) solo uno gana.
- Las fechas del periodo las recibe `activateContract` de quien confirma el pago; la regla para
  transferencia y pago único sigue pendiente (B6, Fase 4).
- `active → completed` solo aplica a pago único y transferencia: se calcula al leer
  (`effectiveContractStatus`) y `completeExpiredContracts()` queda lista para el cron diario
  (que se configura en el despliegue, Fase 8).

**Integridad en la BD (además de UNIQUE y FK).** CHECK de correo normalizado, importes positivos, moneda
de 3 letras, formato de la referencia, periodo de servicio coherente (un contrato fuera de
`pending_payment` siempre tiene fechas) y `pinAttempts`/`attempts` entre 0 y 5. Las FK son `RESTRICT`
(no se borra un cliente o programa con contratos), salvo `OTPVerification.customerId` (`SET NULL`).

**Clientes.** `upsertVerifiedCustomer` crea el cliente o actualiza nombre y WhatsApp si el correo ya
existe (A4), de forma atómica. El WhatsApp se guarda normalizado según A11 (no se le agrega lada; ver B13).

**Auditoría.** `recordAudit` rechaza metadatos con claves como `token`, `pin`, `otp`, `code`, `secret` o
`hash` (SDD §9.6).

**Pruebas.** Las pruebas de integración (`*.db.test.ts`) usan una BD real en `TEST_DATABASE_URL`
(cuyo nombre debe contener "test", porque se borra) y se omiten si no está definida. La CI levanta
PostgreSQL 16 y además comprueba que las migraciones coinciden con `schema.prisma`.

## B. Decisiones pendientes (de SRS §13.2 / SDD §13)

| # | Decisión | Bloquea | Estado |
|---|---|---|---|
| 1 | Proveedor PostgreSQL (Neon) | Fase 8 | Pendiente |
| 2 | Importe final e impuestos (IVA) | Fase 8 (en modo test no bloquea) | Validar con el contador |
| 3 | Correo de notificaciones de Ferro | — | Disponible, falta ponerlo en la variable de entorno |
| 4 | Dominio | Fase 8 | Pendiente |
| 5 | Remitente de Resend | Fase 8 | Pendiente (depende del dominio) |
| 6 | Fechas exactas del periodo de un mes | Fase 4 | Propuesta: el periodo de Stripe para suscripciones; el mismo día del mes siguiente para pago único y transferencia |
| 7 | Reintentos y suspensión por pagos fallidos | Fase 6 | Propuesta: Smart Retries de Stripe con la configuración por defecto; el servicio sigue mientras esté `past_due` |
| 8 | Mecanismo de cancelación | Fase 7 | Propuesta: Stripe Customer Portal con acceso por OTP; cancelar al final del periodo |
| 9 | Nuevas contrataciones con un periodo vigente | Fase 7 | Pendiente |
| 10 | WhatsApp oficial de Ferro | Fase 1 (placeholder en la variable de entorno) | Pendiente |
| 11 | Expiración del enlace de transferencia | — | Resuelto en A7: 7 días, regenerable |
| 12 | Política de privacidad y condiciones | Fase 8 | Borrador existente |
| 13 | Formato del WhatsApp guardado: el SDD §5.3 dice E.164, pero A11 acepta 10 dígitos sin lada. ¿Se agrega `+52` a los números de 10 dígitos? | Fase 3 (correos y enlaces `wa.me` a Ferro) | Pendiente. Por ahora se guarda tal cual lo normaliza A11 |
