# Decisiones — THE HYBRID METHOD

Registro de decisiones y temas pendientes. Las decisiones A1–A8 ya están integradas en
**SRS v1.4** y **SDD v1.3**; A9 en **SDD v1.4**; A11 y A12 en **SRS v1.5** y **SDD v1.5**; A14 en **SDD v1.6**; A15 (que reemplaza a A11) en **SRS v1.6** y **SDD v1.6**; A16 en **SDD v1.7**; A17–A22 en **SRS v1.7** y **SDD v1.8**; A23 en **SDD v1.9**; A25 en **SDD v1.10**; A26 en **SDD v1.11**; A27 en **SDD v1.12**; A28 en **SRS v1.8** y **SDD v1.13**; A29 en **SDD v1.14**; A30 en **SDD v1.15**; A31 en **SDD v1.16**; A32 en **SRS v1.9** y **SDD v1.17**; A33 en **SRS v1.10** y **SDD v1.18**; A34 en **SRS v1.11** y **SDD v1.19**; A35 en **SDD v1.19**; este archivo conserva el porqué de cada una. Cuando se tome una
decisión nueva, se anota aquí y se actualizan el SRS/SDD en el mismo cambio.

## A. Decisiones tomadas (2026-11-23)

### A1. Se elimina el campo `country`
`POST /api/customers` no recibe `country`. No existe en el modelo, ni en el formulario, ni en la API.

### A2. Relación Contract → Program: N:1
Un programa tiene muchos contratos (`Contract.programId` es una FK a `Program`). Corrige el 1:1 de SDD §5.2.
Lo mismo aplica a `Subscription.programId`.

### A3. Estados del contrato: se elimina `paid` — ampliada por A20 (estados `expired` y `scheduled`)
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

### A8. Mismo precio para el pago único y la suscripción — reemplazada por A18
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

### A11. Formato permitido del WhatsApp del cliente (Fase 1, 2026-11-23) — reemplazada por A15
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
existe (A4), de forma atómica. El WhatsApp llega ya en E.164 (A15).

**Auditoría.** `recordAudit` rechaza metadatos con claves como `token`, `pin`, `otp`, `code`, `secret` o
`hash` (SDD §9.6).

**Dependencias.** Prisma 7.10.1 (CLI) trae `effect@3.20.0`, con una vulnerabilidad ReDoS
(GHSA-7589-6fvf-x4pw) que `npm audit` marca como alta. Solo afecta a la CLI de Prisma al leer
`prisma.config.ts`, no a la app. Se fuerza `effect@3.22.4` con `overrides` en `package.json` en lugar de
`npm audit fix --force`, que bajaría Prisma a la v6. Quitar el override cuando Prisma traiga una
versión corregida.

**Pruebas.** Las pruebas de integración (`*.db.test.ts`) usan una BD real en `TEST_DATABASE_URL`
(cuyo nombre debe contener "test", porque se borra) y se omiten si no está definida. La CI levanta
PostgreSQL 16 y además comprueba que las migraciones coinciden con `schema.prisma`.

### A15. WhatsApp de cualquier país, guardado en E.164 (Fase 2, 2026-11-23)
Resuelve B13 y reemplaza a A11. Ferro quiere aceptar números de cualquier país, y el SDD §5.3 pide
guardarlos en E.164 (lo que también necesitan los enlaces `wa.me`).
- El formulario tiene un **selector de país** para la lada, con **México (+52)** preseleccionado, y el
  campo del número local. Las opciones muestran la lada primero ("+52 México") y el resto de países en
  orden alfabético en español.
- Se valida con `libphonenumber-js` según las reglas del país elegido y se guarda en E.164
  (`+525512345678`). Si el número escrito empieza con "+", su lada manda sobre el país elegido.
- No se asume `+52` para números de 10 dígitos sin selector: Estados Unidos y Canadá también usan
  10 dígitos (p. ej. `415 555 2671` es válido en ambos países), y Ferro le escribiría a un número
  equivocado.
- El país del selector solo sirve para leer el número: no se guarda ni es el campo `country` que
  eliminó A1.
- El servicio de clientes solo acepta E.164 (`customerDataSchema`) y la BD lo refuerza con un CHECK
  (`customers_whatsapp_e164_check`).
- La validación usa los metadatos "min" de la librería (longitudes y prefijos válidos por país, sin
  distinguir móvil de fijo), para no cargar de más la página. El formato antiguo de móviles de México
  con "1" (`+52 1 55…`) se rechaza: hoy se marca sin ese "1".
- Código en `src/lib/phone.ts` y `src/lib/validations.ts` (`whatsappInputSchema`, compartido entre
  cliente y servidor). Para restringir países, se filtra la lista de `getPhoneCountryOptions()` y se
  valida el país en ese esquema.

### A16. Verificación de correo, rate limit y transferencias (Fase 3, 2026-11-24)
Puntos que el SDD no definía y que se resolvieron así al implementar la Fase 3. Todos son reversibles.

**Endpoints.** Siguiendo el plan, `POST /api/transfers` crea o asocia el cliente y crea el contrato en una
sola llamada (recibe nombre, WhatsApp, programa y la aceptación de privacidad; el correo sale de la sesión).
`POST /api/customers` y `POST /api/contracts` (SDD §7.2, §7.3) no se exponen todavía: la lógica vive en
`customer.service` y `contract.service`, y el pago con Stripe (Fase 5) la reutilizará igual.

**Enlace de aprobación en la Fase 3.** El token de `TransferApproval` se genera al crear la transferencia
(SDD §7.6), porque el correo Transfer Pending de esta fase debe llevar el enlace (RF-09). La pantalla del
enlace, la confirmación con PIN y la regeneración siguen en la Fase 4; hasta entonces el enlace da 404.

**OTP.**
- Hash del código: HMAC-SHA256 de `correo + código` con una clave derivada de `OTP_SESSION_SECRET`
  (un SHA-256 simple de 6 dígitos se invierte en segundos si se filtra la BD).
- Solo vale el código más reciente de cada correo. Cada intento cuenta, también el correcto, y se registra
  con un compare-and-set antes de comparar. Responder igual exista o no el correo incluye el error de un
  correo sin código pedido (`code_expired`).
- Si el correo con el código no se puede enviar, la ruta responde 502 (el cliente puede reintentar a los 60 s).

**Rate limit (PostgreSQL, tabla `rate_limit_buckets`).** En Vercel la memoria no se comparte entre
instancias, así que los contadores viven en la BD (ventana fija, un `INSERT … ON CONFLICT` atómico). La IP o
el correo se guardan como HMAC, nunca en claro. Límites iniciales (`RATE_LIMITS` en `src/lib/rate-limit.ts`):

| Operación | Límite |
|---|---|
| Pedir código, por IP | 20 por hora |
| Pedir código, por correo | 1 cada 60 s y 5 por hora |
| Confirmar código | 30 por IP y 15 por correo cada 15 min (además de 5 intentos por código) |
| Crear transferencia, por IP | 10 por hora |

La IP sale del primer valor de `x-forwarded-for` (lo pone el proxy de Vercel). Al exceder un límite se
responde 429 con `Retry-After`. `purgeRateLimitBuckets()` queda lista para el cron diario (Fase 8).

**Sesión de verificación.** Cookie `hm_verification` (en producción `__Host-hm_verification`), firmada con
HMAC-SHA256, `httpOnly`, `SameSite=Lax`, `Secure` en producción, 30 minutos. No es de un solo uso: dentro de
la sesión, un doble envío del mismo cliente, programa y modalidad devuelve el contrato ya creado (se
serializa con un `pg_advisory_xact_lock` por cliente). Otra contratación distinta en la misma sesión sí se
crea; las reglas de contrataciones sobre un periodo vigente siguen pendientes (B9). Si falta
`OTP_SESSION_SECRET` en desarrollo, se usa un secreto aleatorio por proceso.

**Protección de las rutas.** Las rutas POST exigen `Content-Type: application/json` (un formulario HTML de
otro sitio no puede enviarlo sin CORS) y la cookie es `SameSite=Lax`. Las respuestas llevan
`Cache-Control: no-store`.

**Interfaz.** El flujo vive en la sección Athlete Application (formulario → código → método de pago →
transferencia pendiente), sin páginas nuevas: la pantalla de transferencia pendiente muestra los datos que
devuelve `POST /api/transfers` y no existe una URL pública que muestre un contrato por su referencia (las
referencias son consecutivas). Los pagos con Stripe se muestran deshabilitados hasta las Fases 5 y 6.

**Correo.** Con `RESEND_API_KEY` se envía con Resend (SDK `resend`); sin ella (solo desarrollo y pruebas) se
registra en la consola, incluido el código OTP para poder probar el flujo. En desarrollo, si falta
`RESEND_FROM_EMAIL`, se usa el remitente de prueba de Resend.

### Respuestas de Ferro a las decisiones pendientes (2026-11-24)

Ferro respondió las decisiones B1–B12. A17–A22 las integran en **SRS v1.7** y **SDD v1.8**.

### A17. Proveedor, dominio, correos y WhatsApp (B1, B3, B4, B5, B10)
- **B1:** Neon, como proponía el SDD. Basta el plan gratuito para arrancar.
- **B3, B5 y B10:** Ferro ya tiene el correo de notificaciones, el remitente y el número de WhatsApp. Se cargan
  directamente en las variables de entorno de Vercel (`FERRO_NOTIFICATION_EMAIL`, `RESEND_FROM_EMAIL`,
  `FERRO_WHATSAPP_NUMBER`) y no se suben al repositorio.
- **B4:** el dominio se compra en GoDaddy. En la Fase 8 se apuntan sus DNS a Vercel y se agregan los registros
  de Resend para verificar el remitente.

### A18. Precios finales y 10 % de descuento en suscripción (B2) — reemplaza a A8 y RN-13
- Los precios del SRS §5 son **finales**: lo que paga el cliente, sin cargos adicionales.
- La **suscripción mensual tiene 10 % de descuento** en todos los programas. El pago único y la transferencia
  pagan el precio completo.

| Programa | Pago único / transferencia | Suscripción mensual |
|---|---|---|
| HM RUN | $1,200 | $1,080 |
| HM STRENGTH | $1,500 | $1,350 |
| HM COMPLETE | $1,800 | $1,620 |

- `Program` guarda los dos importes: `monthlyPrice` (pago único y transferencia) y `subscriptionPrice` (ya con
  descuento, redondeado a centavos). Ambos son `Decimal` y salen del catálogo (`src/content/programs.ts`) con el
  seed. El catálogo tiene una prueba que exige `subscriptionPrice = monthlyPrice × 0.90`. Guardar el importe ya
  calculado, en vez de calcularlo al cobrar, evita redondeos distintos entre la BD, la landing y Stripe.
- En Stripe, el Price `one_time` vale `monthlyPrice` y el `recurring` vale `subscriptionPrice`. El servidor
  comprueba cada uno contra su importe antes de crear un Checkout.
- `Contract.amount` copia el importe de la modalidad elegida.
- La landing muestra los dos precios ("$1,200 al mes · $1,080 con suscripción").

### A19. Cobro mes con mes desde la fecha de pago; la entrega del plan es solo referencia (B6, B7)
*Revisada el mismo día.* La primera versión hacía empezar el mes con la entrega del plan y recorría los cobros de
Stripe con `trial_end`. Ferro prefirió algo más simple: el pago marca el mes, y la entrega solo se registra.

**Periodos.** Cada pago confirmado da un mes que **empieza en la fecha de pago** y termina el mismo día del mes
siguiente. Si ese día no existe, termina el último día del mes (31 ene → 28/29 feb). Esto aplica a todos los
métodos:
- **Suscripción:** Stripe cobra mes con mes desde el primer pago (su comportamiento normal). El periodo es el de
  la factura pagada.
- **Pago único y transferencia:** el mes va desde el pago (en la transferencia, desde que Ferro la confirma). El
  siguiente mes se paga cuando se cumple un mes.
- Si el cliente pagó por adelantado con un periodo vigente (A20), el mes nuevo empieza cuando termina el vigente.
- Vuelve la regla original de A3: el servicio se activa al confirmarse el pago.

**Datos.** Una entidad `ServicePeriod` por cada mes pagado guarda la fecha de pago, el inicio, el fin y, como
referencia, la fecha de entrega del plan (`planDeliveredOn`). La fecha de entrega no cambia ningún estado,
periodo ni cobro.

**Correo de compra con botón.** Después de cada pago confirmado (pago único, transferencia, primer pago y cada
renovación de la suscripción), Ferro recibe un correo con todos los datos del cliente y de la compra (nombre,
correo, WhatsApp, programa, modalidad, importe, referencia, fecha de pago y periodo) y un botón **"Registrar
entrega del plan"**.
- El botón abre `/plan/entrega/[token]`, una pantalla de **solo lectura** con los datos del plan, un campo de
  fecha y un botón "Confirmar entrega". La fecha es **hoy por defecto** (`America/Mexico_City`) y Ferro puede
  cambiarla "por cualquier cosa" (p. ej. si registra días después). No puede ser futura ni anterior al día del
  pago. Al presionar el botón (POST), se guarda esa fecha y se muestra **"Fecha de entrega del plan
  confirmada"**.
- La pantalla intermedia es necesaria: los filtros de correo (Outlook, Gmail, antivirus) abren los enlaces
  automáticamente. Si el GET registrara la fecha, quedaría la fecha de llegada del correo y no la de entrega.
- **Sin PIN.** El botón solo guarda un dato de referencia y no mueve dinero ni estados. Un enlace filtrado, en el
  peor caso, registra una fecha equivocada que se corrige a mano.
- Token de 32 bytes guardado solo como hash. Cada botón vence a los 7 días (`TRANSFER_LINK_TTL_DAYS`), y deja de
  servir en cuanto se registra la entrega con cualquiera de los botones de ese mes. Un mes puede tener varios
  botones vigentes a la vez (el del correo de compra y los de los recordatorios), y ninguno invalida a los otros.
  Si se abre después de registrar la entrega, muestra la fecha ya registrada.

**Recordatorios.** Mientras un mes no tenga fecha de entrega, el cron diario le manda a Ferro, **cada día hábil**
(lunes a viernes, sin festivos), **un correo por cliente**: "Está pendiente el plan de [cliente] · [programa] ·
[referencia] · pagado el [fecha]". Empiezan el siguiente día hábil después del pago
(`PLAN_DELIVERY_REMINDER_BUSINESS_DAYS`, 1 por defecto) y se detienen en cuanto se registra la fecha. El
recordatorio **trae su propio botón "Registrar entrega del plan"** (un token nuevo), así Ferro puede registrar
la fecha desde el correo más reciente aunque haya borrado el de compra. Por eso los botones pueden vencer sin
riesgo: mientras falte la fecha, cada día hábil llega uno nuevo.

**Correos al cliente.** Como siempre: confirmación de compra y bienvenida al confirmarse el pago. La bienvenida
avisa que Ferro entregará el plan en 3 a 5 días hábiles.

**Pagos fallidos (B7).** Stripe reintenta con Smart Retries (configuración por defecto). **El servicio se
suspende** mientras haya un pago vencido: el contrato pasa a `payment_failed`. Si un reintento se paga, vuelve a
`active` con el periodo de esa factura. Si se agotan los reintentos, Stripe cancela la suscripción (configurarlo
así en Stripe) y el contrato pasa a `cancelled`.

### A20. Contratos pendientes, vencimiento y pagos por adelantado (B9) — el pago por adelantado lo reemplaza A28
**Un solo pendiente por cliente.** Un cliente tiene como máximo un contrato `pending_payment` (índice único
parcial). Al pedir una contratación con el correo ya verificado:
- Si tiene un pendiente con el **mismo programa y modalidad**, se reutiliza: misma referencia, sin crear otro.
  Si era por transferencia y su enlace ya no sirve, se genera uno nuevo y se avisa a Ferro.
- Si el pendiente es de **otro programa o modalidad**, la página le avisa: "Encontramos un registro pendiente:
  HM RUN · Transferencia · HM-2026-000123. ¿Quieres continuar con él o cambiarlo a HM STRENGTH · Pago único?".
  - *Continuar* retoma el pendiente tal cual.
  - *Cambiar* actualiza **el mismo contrato**: conserva la referencia y cambia el programa, la modalidad y el
    importe, que toma de la BD. Si había un enlace de transferencia, se invalida y se le manda a Ferro uno
    nuevo. Si había un Checkout abierto, se expira en Stripe. Se registra `contract.pending_changed` en
    AuditLog.
- Solo se muestran los datos del pendiente al dueño del correo verificado (RF-15).

**Vencimiento.** Un contrato `pending_payment` vence después de **7 días sin actividad** (configurable con
`PENDING_CONTRACT_TTL_DAYS`) y pasa a `expired`. Cuenta como actividad crearlo, retomarlo, cambiarlo o
regenerar su enlace (`Contract.lastActivityAt`). Se vence al leer (antes de buscar pendientes) y con el cron
diario. Un contrato vencido ya no se reutiliza: si el cliente vuelve, se crea otro.
- **Pago tardío** (confirmado por Ferro el 2026-11-24): si llega un pago real para un contrato ya vencido, se
  respeta y el contrato se activa. Se registra `contract.paid_after_expiry`. Así nunca se pierde un pago real.
  Aplica a los dos caminos:
  - **Transferencia:** el cliente transfiere después de los 7 días. Ferro regenera el enlace de confirmación
    (también funciona con contratos vencidos), confirma con su PIN y el contrato se activa con la misma
    referencia.
  - **Stripe:** el cliente pagó en Checkout, pero el aviso de Stripe llega cuando el contrato ya venció (por
    ejemplo, un pago que Stripe tarda en confirmar). El webhook activa el contrato igual.

**Pago por adelantado con un periodo vigente.** Un cliente con un contrato de pago único o transferencia
vigente o por empezar puede pagar su **siguiente mes** por adelantado, del mismo programa o de otro. Se paga
como cualquier contratación. El mes nuevo empieza cuando termina el vigente (estado `scheduled` hasta entonces),
y Ferro registra su entrega igual que siempre. Se permite **un solo mes por adelantado**: "su siguiente mes", tal como lo dijo Ferro.

**Con una suscripción activa** (incluye `past_due`), el cliente **no** puede
crear otra contratación. La página lo manda al portal de Stripe (A21), donde cambia de plan, y el cambio aplica
en la siguiente renovación. Para eso `ServicePeriod` guarda el programa de cada mes.

### A21. Cancelación y cambio de plan con el Stripe Customer Portal (B8)
Se acepta la propuesta. El cliente verifica su correo con un OTP y el servidor le crea una sesión del Stripe
Customer Portal (`POST /api/portal`) para su `stripeCustomerId`. En el portal puede:
- Cancelar la suscripción. La cancelación se aplica **al final del periodo**, sin quitarle días ya pagados.
- Cambiar de plan entre los tres Price recurrentes, sin prorrateo. El cambio se cobra en la siguiente renovación.
- Actualizar su tarjeta, que es como se paga un cobro vencido.

Los cambios llegan por los webhooks `customer.subscription.updated/deleted`.

### A22. Borrador de privacidad y condiciones (B12)
Se publica un borrador breve en `/privacidad` y `/condiciones`, y se usa mientras no haya una versión
validada. Está marcado como borrador. Cubre: responsable, datos que se piden y para qué, encargados (Stripe,
Resend, Vercel, Neon), derechos ARCO, contratación, precios, periodo de un mes desde el pago, entrega del plan, renovación
y cancelación, pagos fallidos y reembolsos manuales. Antes del lanzamiento se completan los datos del
responsable (nombre o razón social, domicilio, correo de contacto) y conviene que lo revise un abogado.

### A23. Confirmación manual de transferencias (Fase 4, 2026-11-24)
Puntos que el SDD no definía y que se resolvieron así al implementar la confirmación de transferencias de la
Fase 4. Todos son reversibles. (Se registró primero como A17 en la rama de la Fase 4; se renumeró al fusionar
`main`, que ya usaba A17–A22 para las respuestas de Ferro.)

**Periodo de servicio (DECISIONS A19).** El mes empieza en el momento de la confirmación y termina el mismo
día del mes siguiente a la misma hora de America/Mexico_City; si ese día no existe (31 de enero), el último
día del mes siguiente. La regla vive en `src/utils/service-period.ts` (`addOneBusinessMonth`,
`oneMonthServicePeriod`) para reutilizarla en el pago único y en los ServicePeriod. Por ahora el periodo se
guarda en `Contract.serviceStartDate/serviceEndDate`; la entidad ServicePeriod (A19) llega con la migración
de la Fase 4.

**PIN.**
- De 6 a 12 dígitos. `npm run hash-pin` pide el PIN dos veces sin mostrarlo (no como argumento, para
  que no quede en el historial) y rechaza un dígito repetido o una secuencia (123456, 654321).
- Solo **bcrypt** (`bcryptjs`, costo 12): la configuración ya no acepta hashes argon2, porque la app
  no podría verificarlos. Sin `FERRO_APPROVAL_PIN_HASH` (solo posible en desarrollo) la confirmación
  responde 503: no hay PIN por defecto.
- Next.js expande `$` en los archivos `.env`, así que el script imprime el hash escapado (`\$2b\$…`)
  para `.env.local` y sin escapar para Vercel.

**Intentos de PIN sobre un enlace.** Cada intento se cuenta con un compare-and-set **antes** de comparar
el PIN (igual que los OTP en A16), así que con solicitudes simultáneas nunca se prueban más de 5 PIN por
enlace. Si el PIN es correcto, ese intento se descuenta al aprobar: `pinAttempts` sigue siendo el número
de PIN incorrectos. Al quinto error se marca `invalidatedAt`.

**Concurrencia.** La confirmación y la regeneración bloquean primero la fila del contrato
(`SELECT … FOR UPDATE`) y después tocan los enlaces, en el mismo orden, para no provocar deadlocks. Dos
confirmaciones simultáneas con el PIN correcto crean un solo Payment.

**Regeneración (`POST /api/transfers/regenerate` con `{ reference, pin }`).**
- Se ofrece en la propia página del enlace cuando está vencido o invalidado (con la referencia ya
  puesta) y cuando el token no existe (Ferro escribe la referencia). No hay otra página.
- Con un PIN incorrecto la respuesta es igual exista o no la referencia. Aquí no hay un enlace que
  cuente los intentos, así que el rate limit es por IP (10 por hora) y además **global** (30 por hora):
  limita la adivinación del PIN aunque venga de muchas IP, a costa de que un ataque pueda bloquear la
  regeneración durante una hora (no afecta a la confirmación con un enlace vigente).
- El enlace nuevo solo viaja en el correo de Ferro; si ese correo falla, la ruta responde 502.

**Confirmación.** Rate limit de 20 por IP cada 15 minutos, además de los 5 PIN por enlace. Respuestas:
403 `invalid_pin` con `remainingAttempts`; 404/410 `link_unavailable` con `reason`
(`not_found`, `expired`, `used`, `invalidated`); 409 `contract_not_pending`.

**Página del enlace.** Muestra los datos del cliente solo con un enlace válido; con uno vencido,
invalidado o usado muestra solo la referencia. Además de los encabezados de `next.config.ts`
(`Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`), lleva
las metaetiquetas `robots` y `referrer`. Los formularios usan `method="post"` y el botón se habilita al
hidratar, para que un envío temprano nunca ponga el PIN en la URL. "No, regresar" solo navega
(atrás o al inicio).
Lo mismo se aplicó al formulario de inscripción de la landing (`ApplicationForm`, que también se
renderiza en el servidor): antes, un envío previo a la hidratación ponía el nombre, el correo y el
WhatsApp en la URL. Los pasos de código y de método de pago también usan `method="post"`.

**Correos tras confirmar.** Transfer Confirmed y Welcome al cliente, y Payment Received a Ferro (RF-13
pide avisarle de la confirmación manual; le sirve como comprobante). Un fallo se registra en la
auditoría (`transfer.notification_failed`) y nunca revierte el pago.

**Código.** `transfer-approval.service.ts` (vista, confirmación y regeneración) y `payment.service.ts`
(`recordSucceededPayment`, que reutilizará la Fase 5). `activateContract` acepta `from` para exigir el
estado de origen (`pending_payment` en las transferencias).

### A24. About Me y logo del header (contenido de la marca, 2026-11-25)
- **About Me** con el texto de Ferro (`ABOUT` en `src/content/landing.ts`). Por decisión de la marca, el
  kicker ("Experience beyond the trend."), la firma ("Founder & Head Coach") y los títulos de los cuatro
  indicadores de autoridad van en inglés, como el hero (A13). El resto del texto sigue en español.
- **Indicadores de autoridad** debajo de la fotografía: 15+ Years of Experience, 2 Training Studios,
  100% Individualized Approach y 360° Athletic Development, cada uno con su descripción. En celular van en
  dos columnas y en escritorio en cuatro. Reemplazan las cifras de relleno.
- **Logo del header**: nueva versión horizontal (H blanca y M naranja, "BY FERRO FITS" entre líneas). El
  original está en `docs/brand/logo-original-horizontal-v2.jpg`; `public/logos/hm-logo-horizontal-v2.png` se
  generó con fondo transparente (el negro del JPG se convierte en transparencia conservando el antialias).
  Está pensado para fondo oscuro. El logo apilado del footer no cambia.

### A25. Fase 4, parte 2: modelo, reglas de contratación, entrega del plan y cron (2026-11-25)
Puntos que el SDD no definía y que se resolvieron así al implementar A18–A20. Todos son reversibles.

**Migración.**
- Va en dos archivos: el primero solo agrega `expired` y `scheduled` al enum, porque PostgreSQL no deja usar un
  valor de enum en la misma transacción en que se crea (el segundo lo usa en un CHECK).
- `subscriptionPrice` se llena con `round(monthlyPrice × 0.90, 2)` y el seed lo vuelve a escribir desde el
  catálogo. CHECK `0 < subscriptionPrice ≤ monthlyPrice`.
- Antes de crear el índice único de un pendiente por cliente, si una BD ya tenía varios pendientes del mismo
  cliente (antes no había esta regla), se deja el más reciente y los demás pasan a `expired`.
- A los contratos ya pagados (transferencias confirmadas en la parte 1) se les crea su ServicePeriod con el
  periodo del contrato. `lastActivityAt` de los existentes = `createdAt`.
- CHECK en ServicePeriod: `endDate > startDate`, `sequence ≥ 1` y entrega no anterior al día del pago (en la
  zona del negocio).

**Reglas de contratación (`contract-request.service`).**
- Un pendiente del mismo programa y modalidad se reutiliza (200, `outcome: "reused"`); si su enlace de
  transferencia ya no sirve, se genera otro y se avisa a Ferro (`transfer.link_regenerated`). Con un enlace
  vigente no se reenvía nada: así un doble envío tampoco duplica correos (reemplaza la regla por sesión de A16).
- Un pendiente de otro programa o modalidad responde `409 pending_contract_exists` con su resumen; la página
  pregunta "¿continuar o cambiar?" y reenvía la elección (`pendingAction`). "Cambiar" conserva la referencia,
  toma el importe de la BD, invalida el enlace anterior y manda uno nuevo a Ferro.
- Si el cliente elige "continuar" con un pendiente de pago con tarjeta desde el flujo de transferencia, se
  responde 409 y se le pide elegir "cambiar" (Fase 5 podrá retomarlo con Stripe).
- Límite de pago por adelantado: si el cliente ya tiene un contrato `scheduled` que todavía no empieza,
  `409 prepaid_limit`. Con una suscripción `incomplete`, `active`, `past_due` o `unpaid`,
  `409 subscription_active`.
- `POST /api/transfers` responde 201 al crear y 200 al reutilizar, retomar o cambiar, con `outcome`.

**Pago de una transferencia.**
- El mes empieza al confirmar, o al terminar el último mes pagado del cliente (pago único o transferencia,
  `active` o `scheduled`) si aún no termina; en ese caso el contrato queda `scheduled`.
- Es pago tardío (`contract.paid_after_expiry`) si el contrato está `expired` o si sigue `pending_payment` en la
  BD pero ya lleva 7 días sin actividad. Regenerar el enlace cuenta como actividad de un pendiente.
- Payment Received lleva cliente, correo, WhatsApp, programa, modalidad, importe, referencia, fecha de pago,
  periodo y el botón "Registrar entrega del plan".

**Entrega del plan.**
- La fecha se elige entre el día del pago y hoy (zona del negocio); hoy por defecto. Si la entrega ya estaba
  registrada, la página la muestra aunque el botón haya vencido, y el POST devuelve esa fecha sin cambiar nada.
  Dos botones del mismo mes al mismo tiempo: gana el primero (compare-and-set). Rate limit 30 por IP cada 15 min.

**Recordatorios y cron.**
- **Festivos:** los días de descanso obligatorio de la Ley Federal del Trabajo (art. 74): 1 de enero, primer
  lunes de febrero, tercer lunes de marzo, 1 de mayo, 16 de septiembre, tercer lunes de noviembre, 1 de
  octubre cada seis años (2030, 2036…) y 25 de diciembre. No se incluyen las jornadas electorales. Están en
  `src/utils/business-calendar.ts`; si Ferro descansa otros días, se agregan ahí.
- `PLAN_DELIVERY_REMINDER_BUSINESS_DAYS` cuenta días hábiles completos después del día del pago (con 1, quien
  paga el viernes recibe el primer recordatorio el lunes).
- Antes de enviar se marca `lastReminderAt` con un compare-and-set: dos ejecuciones el mismo día no duplican
  correos. Si el correo falla, se audita `plan.reminder_failed` y se reintenta el siguiente día hábil.
- Los recordatorios siguen mientras el mes no tenga fecha de entrega, aunque el mes ya haya terminado.
- `vercel.json` programa el cron a las 14:05 UTC (8:05 en Ciudad de México). `CRON_SECRET` es obligatorio en
  producción y tiene al menos 16 caracteres; sin él, el endpoint responde 401 siempre.

**Interfaz.** La sección Pricing y las tarjetas de los programas muestran "$1,080 MXN con suscripción" debajo del
precio completo; el paso "Elige cómo pagar" muestra el importe de cada modalidad. Se quitaron los textos de
"mismo precio" y la nota pendiente sobre el IVA.

### A26. Fase 5: pago único con Stripe (2026-11-25)
Puntos que el SDD no definía y que se resolvieron así al implementar el pago único. Todos son reversibles.

**Precios en Stripe (`npm run stripe:sync`).** Cada programa tiene en Stripe un Product con el mismo id que su slug
(`hm-run`, …) y dos Prices identificados por `lookup_key`: `<slug>_one_time` (`monthlyPrice`) y `<slug>_recurring`
(`subscriptionPrice`, mensual; se crea ya para la Fase 6). El script los crea o reutiliza y guarda sus IDs en
`programs`. Si un precio del catálogo cambia, crea un Price nuevo (transfiere la `lookup_key`) y archiva el anterior,
porque en Stripe un Price no se puede editar. Los Prices se crean con `tax_behavior: inclusive` (precios finales, A18).
Con una clave live exige `--live`. Antes de cada Checkout el servidor lee el Price en Stripe y comprueba que esté
activo, sea del programa, en MXN, del tipo correcto y por el importe de la BD; si no, no crea el contrato ni el
Checkout, registra el error y responde `503 payments_unavailable` (el cliente puede pagar por transferencia).

**`POST /api/checkout`.** Igual que `POST /api/transfers` (A16), recibe el formulario completo más `mode`
(solo `payment` en esta fase) y crea o asocia el cliente en la misma llamada; `customerId` y `programId` del SDD §7.4
no se exponen. Aplica las reglas de A20/A25 con `paymentType = one_time`:
- Un pendiente igual se reutiliza con **la misma sesión** de Checkout si sigue abierta y cobra el mismo Price; si
  venció, se abre otra con la misma referencia. Si la sesión guardada ya se completó (p. ej. un pago en OXXO que
  todavía no se acredita), responde `409 payment_in_progress` y no abre otra, para no cobrar dos veces.
- "Cambiar" desde una transferencia invalida el enlace de Ferro; "cambiar" desde otro pago con tarjeta (o de tarjeta
  a transferencia en `POST /api/transfers`) expira la sesión anterior en Stripe. "Continuar" con un pendiente de otra
  modalidad responde 409 y pide elegir "cambiar" (como en A25).
- El cliente de Stripe se crea una vez por cliente (clave de idempotencia `customer-<id>`) y se guarda en
  `Customer.stripeCustomerId`. La sesión se guarda en el contrato con un compare-and-set: con dos solicitudes
  simultáneas gana una y la otra sesión se expira. Sin `STRIPE_SECRET_KEY` (desarrollo) responde 503.
- Checkout en `es-419`, con `metadata.contractId`, `client_reference_id` y la referencia en la descripción del pago.
  Regresa a `/pago/exito`, página estática que solo informa (no lee la sesión). El formulario va incrustado en la
  landing (A27). Rate limit:
  10 por IP por hora.

**Webhook.** La firma se verifica con el body crudo y `STRIPE_WEBHOOK_SECRET` (sin él, 503). El evento se inserta en
WebhookEvent y se procesa en una transacción que bloquea su fila (`FOR UPDATE`): una entrega repetida o simultánea
responde 200 sin volver a aplicarse. Si el procesamiento falla, todo se revierte, el evento queda `failed` y se
responde 500 para que Stripe reintente; el reintento sí se procesa. Un evento sin contrato propio se marca `failed` y
responde 200 (reintentarlo no ayudaría). Los eventos que no son de A6 se marcan `ignored`.
- El pago (`stripe_one_time`) se registra con el importe que cobró Stripe y su Payment Intent (UNIQUE). Si no coincide
  con el contrato, se respeta y se audita `stripe.amount_mismatch`. `paidAt` es la fecha del evento; el mes empieza
  ahí o al terminar el mes vigente (pago por adelantado, `scheduled`). Un contrato vencido se activa igual
  (`contract.paid_after_expiry`, A20).
- Un cobro para un contrato **ya pagado** (p. ej. dos pestañas de Checkout) se registra como Payment, no abre otro
  mes, se audita `stripe.extra_payment` y Ferro recibe "Revisa un pago adicional" para reembolsarlo desde Stripe si
  corresponde (los reembolsos son manuales).
- Correos después de confirmar la transacción: Purchase Confirmation y Welcome (cliente) y Payment Received con el
  botón de entrega (Ferro), con el mismo código que la transferencia (`payment-notifications.service`).

**Configuración de la cuenta de Stripe (2026-11-26).** THE HYBRID METHOD usa una cuenta de Stripe propia, separada
del otro negocio de Ferro. No se acepta OXXO (se desactiva en el Dashboard; el código no fija métodos de pago). Se
activan los recibos de Stripe para pagos exitosos, así que el correo Purchase Confirmation puede decir que Stripe
también envía su recibo.

**Pago asíncrono fallido (`checkout.session.async_payment_failed`).** El SDD §7.5 decía "pasar el contrato a
`payment_failed`", pero la máquina de estados (§5.3) no permite `pending_payment → payment_failed` y ese estado
significa "servicio suspendido", que no aplica a un contrato que nunca se activó. Se implementó así: se registra el
Payment `failed`, el contrato **sigue `pending_payment`** (vence a los 7 días como cualquier pendiente), se suelta su
sesión para que el siguiente intento abra otra, se audita `stripe.async_payment_failed` y el cliente recibe "Tu pago
no se completó" con un botón para intentarlo de nuevo. Confirmado el 2026-11-25 (B15): no se usa `payment_failed`
para contratos que nunca se activaron; ese estado queda solo para suscripciones con un cobro vencido.

### A27. Formulario de pago incrustado (Embedded Checkout) (2026-11-25) — la variante la reemplaza A29
Decisión de la dueña del proyecto: el pago con tarjeta se hace **dentro de la landing**, con el formulario de Stripe
incrustado (Embedded Checkout), en lugar de mandar al cliente a la página de Stripe. Reemplaza lo que A26 decía de
`/pago/cancelado`.
- La sesión se crea con `ui_mode: "embedded_page"` y `return_url = /pago/exito`. `POST /api/checkout` responde el
  `client_secret` de la sesión y la clave publicable (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) en lugar de una URL. El
  servidor exige que la clave publicable exista y sea del mismo modo (test o live) que la secreta; si no, `503
  payments_unavailable`.
- La sección Athlete Application monta el formulario con `@stripe/react-stripe-js` (`EmbeddedCheckoutProvider`) en
  el paso "Paga con tarjeta", con el programa, el importe y la referencia. Los datos de la tarjeta los captura Stripe en
  su iframe (RN-10). "Elegir otra forma de pago" regresa al paso anterior; la sesión sigue abierta y se reutiliza.
- Ya no hay página de cancelación: el cliente se queda en la landing. `/pago/exito` sigue siendo la única página de
  regreso y solo informa; el servicio se activa solo con el webhook.
- Todo lo demás de A26 (precios, reglas, reutilización de la sesión, webhook) no cambia.

### A28. Mes con mes, sin pagos por adelantado (2026-11-26)
Respuesta de Ferro: para no complicarlo, **no se paga ningún mes por adelantado**; se cobra mes con mes. Reemplaza el
"pago por adelantado con un periodo vigente" de A20 (y el límite de un mes de A25).
- Si el cliente tiene un mes de pago único o transferencia que todavía no termina (`active` o `scheduled` con
  `serviceEndDate > now`), no puede crear otra contratación: `409 active_period` con `activeUntil`, y la página le
  dice "Ya tienes un mes pagado hasta el [fecha]. Podrás pagar tu siguiente mes a partir de ese día." Aplica a
  `POST /api/transfers` y `POST /api/checkout`, y se revisa antes que el pendiente.
- El día en que termina su mes ya puede pagar el siguiente, del mismo programa o de otro (así se cambia de programa
  con pago único o transferencia, RN-08). Como siempre (A19), el mes nuevo empieza el día del pago.
- Se conservan el estado `scheduled` y el cálculo "empieza cuando termina el vigente" solo para un **pago tardío**
  real (A20) de un contrato que ya existía, que se sigue respetando: p. ej. Ferro confirma una transferencia vencida, o
  Stripe confirma tarde un pago, cuando el cliente ya pagó otro mes por otro camino.
- Con esto tampoco hace falta cambiar cuándo empiezan los recordatorios de entrega (se habló de esperar al inicio de
  cada mes adelantado): en el flujo normal cada mes empieza el día del pago.
- Idea para el futuro, sin implementar: una promoción tipo "paga 3 meses y el 4.º es gratis", como **un solo pago**
  que active varios meses seguidos. Ver B16.

### A29. Formulario de pago de Checkout Studio (`ui_mode: form`) (2026-11-26)
La dueña del proyecto configuró en Checkout Studio de Stripe un "embedded form". Reemplaza la variante de A27
(`embedded_page`, la página de Stripe completa en un recuadro blanco) por el formulario de pago incrustado, que se
integra al diseño de la landing. Se aplicaron solo los parámetros de la configuración; las partes genéricas de las
instrucciones de Stripe (servidor nuevo, webhook nuevo, `STRIPE_INTEGRATION_TODO.md`) no aplican porque ya existen.
- **Servidor:** `ui_mode: "form"`, `integration_identifier: "custom_embedded_web_0002"`,
  `billing_address_collection: "auto"`, sin teléfono, sin impuestos automáticos y `submit_type: "auto"`. **Sin
  `name_collection`**: el nombre ya está en el registro. **Se puede guardar la tarjeta**
  (`saved_payment_method_options.payment_method_save: "enabled"`): queda en Stripe, ligada al cliente de Stripe,
  nunca en la app. Ya no se manda `return_url` a Stripe: la respuesta de `POST /api/checkout` incluye `returnUrl`
  (`/pago/exito`) y el navegador lo usa al confirmar. Una sesión abierta de la variante anterior no se reutiliza: se
  expira y se abre otra. La versión de la API del SDK (`2026-10-28.endive`) ya es posterior a la mínima que pide
  Stripe (`2026-03-25.dahlia`).
- **Navegador:** `stripe.initCheckoutFormSdk` (Stripe.js cargado desde js.stripe.com con `@stripe/stripe-js`) con
  `createForm({ layout: "expanded" })`; el evento `confirm` llama a `actions.confirm({ formConfirmEvent, returnUrl })`
  y, si Stripe rechaza el pago, se muestra el motivo sin salir de la página. Apariencia: la de Checkout Studio
  (tema `night`, campos separados) con los colores de la marca: fondo `#111111`, texto `#F5F3EE`, principal `#FF6A00`
  y la fuente Inter. Se quita `@stripe/react-stripe-js`.

### A30. Webhooks en local con `npm run stripe:listen` (2026-11-26)
En las pruebas con la cuenta de Stripe el webhook respondía `[400]` una y otra vez: con `--api-key`, cada ejecución de
`stripe listen` puede dar un `whsec_` distinto, y había que copiarlo a `.env.local` y reiniciar `npm run dev` en el
orden correcto. Para evitarlo:
- `npm run stripe:listen` (`scripts/stripe-listen.ts`) arranca `stripe listen` con la clave de `.env.local`, reenvía a
  `127.0.0.1:<puerto>/api/webhooks/stripe` (3000 o `--port`; `127.0.0.1` evita el problema de `localhost` → IPv6) solo
  los eventos de `STRIPE_WEBHOOK_EVENTS` (`src/lib/stripe-constants.ts`, la misma lista que usa el webhook) y escribe el
  `whsec_` de esa ejecución en `STRIPE_WEBHOOK_SECRET`. Nunca imprime el secreto completo y rechaza claves live.
- En desarrollo `getConfig()` ya no guarda la configuración en memoria: `next dev` recarga `.env.local` solo y el
  secreto nuevo aplica sin reiniciar. En producción y pruebas se sigue guardando.

### A31. Fase 6: suscripciones y renovaciones (2026-11-26)
Puntos que el SDD no definía y que se resolvieron así al implementar la suscripción mensual. Todos son reversibles.

**Checkout en modo `subscription`.** `POST /api/checkout` acepta `mode: "subscription"`: contrato `subscription` por
`subscriptionPrice`, Price `recurring` comprobado contra Stripe (mensual, MXN, del programa, por el importe de la BD) y las
mismas reglas de contratación de A20/A25/A28. La sesión usa el mismo formulario incrustado (A29) y pone
`metadata.contractId` también en la suscripción (`subscription_data.metadata`): Stripe la copia a cada factura, así que
`invoice.paid` encuentra el contrato aunque llegue antes que `checkout.session.completed`. No lleva
`payment_intent_data` ni `saved_payment_method_options` (son del modo `payment`): la tarjeta queda en la suscripción, en
Stripe. Una sesión abierta se reutiliza solo si es del mismo modo y Price. La respuesta incluye `mode`, y el paso de
pago dice "Suscríbete con tarjeta", "$1,080 MXN / mes" y que el siguiente cobro es en la misma fecha cada mes.

**Estado de la suscripción leído de Stripe.** Cada evento de suscripción (`checkout.session.completed` en modo
subscription, `customer.subscription.*`, `invoice.*`) bloquea el contrato y **vuelve a leer la suscripción en Stripe**
(`subscriptions.retrieve`) para copiar su estado, periodo, `cancelAtPeriodEnd` (también con `cancel_at`) y programa. Así
una entrega repetida o fuera de orden (p. ej. `created` con `incomplete` después de `updated` con `active`, que pueden
llevar el mismo segundo) nunca deja un estado viejo. Si Stripe no responde, el evento falla con 500 y Stripe lo
reintenta. Estados de Stripe sin equivalente: `trialing` → `active`; `paused` → `unpaid`; `incomplete_expired` →
`canceled`.

**`invoice.paid` (única fuente de pagos).**
- El periodo del mes es el de la **línea** de la suscripción en la factura (el encabezado de la factura de alta trae
  inicio = fin). El programa del mes es el del Price cobrado (o el de su Product, que tiene el slug como id, si el Price
  ya se archivó con `stripe:sync`).
- Primer pago (`pending_payment` o `expired`): Payment `stripe_subscription` con factura, Payment Intent y suscripción,
  ServicePeriod + botón de entrega y contrato `active` con el periodo de la factura. Si el contrato estaba vencido se
  audita `contract.paid_after_expiry`. Si mientras pagaba el cliente cambió el pendiente a otra modalidad, el pago real
  manda: el contrato vuelve a ser de suscripción, se invalida el enlace de transferencia y se audita
  `stripe.payment_type_changed`. A diferencia del pago único, el mes **no** se recorre si el cliente tiene otro mes
  vigente: en la suscripción el periodo lo decide Stripe (A19).
- Renovación (`active`): Payment y ServicePeriod nuevos (secuencia 2, 3, …) y el contrato toma el periodo nuevo (si la
  factura es de un periodo anterior, no lo retrocede). Desde `payment_failed`, vuelve a `active`. Correos: al cliente,
  "Tu suscripción se renovó" (RF-08 pide correos de renovación al cliente; Stripe además manda su recibo) y a Ferro,
  Renewal Successful con los datos y su botón de entrega. Los recordatorios de entrega funcionan igual para cada mes.
- Importe 0: no abre un mes. Importe distinto del `subscriptionPrice` del programa cobrado: se respeta y se audita.
- Una segunda suscripción del mismo contrato (dos pestañas pagadas) no se guarda (Subscription es 1:1 con el contrato):
  su cobro se registra sin abrir un mes y Ferro recibe "Revisa un pago adicional" con el ID de la suscripción duplicada
  para cancelarla en Stripe. Un cobro para un contrato `cancelled` se trata igual.

**`invoice.payment_failed`.** Cada intento fallido es un Payment `failed` (RF-18). Por eso la unicidad de
`stripeInvoiceId` y `stripePaymentIntentId` aplica **solo a los pagos `succeeded`** (índices únicos parciales): Smart
Retries reintenta la misma factura con el mismo Payment Intent. En una renovación de un contrato `active`, el primer
fallo lo pasa a `payment_failed` (servicio suspendido, RN-14) y avisa una vez al cliente (con el enlace de Stripe para
pagar la factura con otra tarjeta) y a Ferro; los reintentos siguientes solo se registran y auditan. Un aviso de fallo
que llega después de que la factura ya se pagó no suspende nada. Si falla el **primer** pago, el contrato sigue
pendiente (como en B15) y no se manda correo: el formulario de Stripe ya muestra el error. Si Stripe da la suscripción
por terminada (`incomplete_expired`), se suelta la sesión del contrato para que el cliente pueda reintentar.

**Cancelación.** Cuando Stripe cancela la suscripción (al fallar los tres intentos, A32, o al
final del periodo desde el portal), el contrato `active` o `payment_failed` pasa a `cancelled` y se audita
`subscription.cancelled`, sin recortar el periodo pagado. Los correos Subscription Cancelled y el portal son de la
Fase 7.

**Pruebas.** Sin claves de Stripe aquí, las renovaciones, fallos y cancelaciones se prueban con un Stripe en memoria
que funciona como test clock (crea la suscripción, factura mes a mes, reintenta y cancela) y con firmas reales del SDK.
La prueba con test clocks reales en la cuenta de prueba queda documentada en el README.

### A32. Pagos fallidos de la suscripción: tres días seguidos y se cancela (2026-11-26)
Decisión de la dueña del proyecto. Reemplaza "Smart Retries con la configuración por defecto" de A19 (B7), RF-18 y
SDD §6.1.
- Si falla el cobro de una renovación, se intenta **una vez al día durante tres días seguidos**: el día de la
  renovación y los dos siguientes (tres intentos en total). Mientras tanto el servicio sigue suspendido
  (`payment_failed`); si un intento pasa, se reactiva.
- Si ninguno de los tres pasa, **se da por terminada la programación del cliente**: la suscripción se cancela y el
  contrato pasa a `cancelled`.
- En Stripe (Dashboard → Billing → Revenue recovery → Retries): programación personalizada, sin Smart Retries,
  **2 reintentos, 1 día después del intento anterior**, y al fallar todos, **cancelar la suscripción**.
- La app no depende solo de esa configuración: cuando llega `invoice.payment_failed` sin otro reintento programado
  (`next_payment_attempt = null`) para una renovación, cancela la suscripción en Stripe si sigue viva y pasa el contrato
  a `cancelled` en la misma transacción (`subscription.cancelled` con `reason: payment_attempts_exhausted`). El
  `customer.subscription.deleted` que llega después ya no cambia nada.
- El aviso al cliente y a Ferro del primer fallo dice que se volverá a intentar una vez al día durante los próximos 2
  días; después del último intento no se manda ese aviso (la cancelación la avisa la Fase 7, Subscription Cancelled).
  El número de intentos está en `SUBSCRIPTION_PAYMENT_ATTEMPTS` (`src/lib/stripe-constants.ts`), solo para los textos;
  si cambia, se cambia también en Stripe y en las condiciones (`src/content/legal.ts`).

### A33. Fase 7: portal de la suscripción y avisos de cancelación (2026-11-27)
Decisiones de la dueña del proyecto (acceso, momento de los correos y a quién se avisa) y puntos que el SDD no
definía, resueltos así al implementar el portal (A21). Todos son reversibles.

**Acceso a "Administrar mi suscripción".**
- Página `/suscripcion` (sin indexar): correo → código OTP (el mismo `POST /api/verification/request` y `/confirm` de
  la contratación) → `POST /api/portal` → Stripe Customer Portal. El correo del código ya no dice "inscripción":
  "Escribe este código en la página para continuar".
- Se enlaza desde el **pie de página**, como primer enlace de la columna de los documentos legales (la variante
  discreta, sin título propio), y desde los correos de la suscripción (Purchase Confirmation de una suscripción,
  Subscription Renewed y los avisos de cambios).
- Si un cliente con suscripción intenta contratar otra cosa (`409 subscription_active`), la página muestra "Ya tienes
  una suscripción" con un botón **"Administrar mi suscripción"** que abre el portal directamente: su correo ya está
  verificado en esa sesión.

**`POST /api/portal`.** Sin body: el correo sale de la sesión de verificación. Abre el portal si el cliente tiene
`stripeCustomerId` y una suscripción `active`, `past_due` o `unpaid` (vigente, también con la cancelación programada
para poder deshacerla, o con un cobro pendiente para actualizar la tarjeta). Si no (correo desconocido, sin
suscripción, `incomplete` o `canceled`), `404 subscription_not_found` con el mismo mensaje en todos los casos. Sin
Stripe o si Stripe falla, `503 portal_unavailable`. Rate limit: 10 por IP por hora. `return_url` = la landing,
`locale: es-419`, con la configuración predeterminada del portal en el Dashboard (README). Se audita
`portal.session_created`.

**Correos de la cancelación y de los cambios (al cliente y a Ferro).**
- **Al pedir la cancelación** (`cancel_at_period_end` o `cancel_at`): "Tu suscripción terminará el …: tu servicio
  sigue hasta ese día y no habrá otro cobro" (cliente) y "Cancelación programada" (Ferro). El contrato sigue `active`.
- **Al terminar** (la suscripción pasa a `canceled` y el contrato a `cancelled`): "Tu suscripción terminó" con un botón
  para volver a inscribirse (cliente) y "Suscripción terminada" (Ferro). Si Stripe la canceló por cobros fallidos
  (`cancellation_details.reason = payment_failed`) o la app la canceló al agotarse los intentos (A32), el texto lo dice
  ("Suscripción cancelada por pagos fallidos"). Una cancelación inmediata (p. ej. Ferro desde el Dashboard) manda
  solo este aviso.
- **Cancelación deshecha**: "Tu suscripción sigue activa" con la fecha del siguiente cobro, y "Cancelación deshecha"
  (Ferro).
- **Cambio de programa**: "Cambiaste a …" con el importe mensual y la fecha de la siguiente renovación (hasta entonces
  sigue con el programa ya pagado), y "Cambio de programa" (Ferro), para que prepare el plan del programa nuevo.

**Cómo se detectan.** Cada evento de la suscripción ya copia el estado actual de Stripe (A31); ahora además compara la
fila Subscription de antes y de después: programa, `cancelAtPeriodEnd` y estado. El primer evento que ve un cambio lo
avisa y los siguientes ya no encuentran diferencia, así que un evento repetido o fuera de orden no repite el correo.
El alta (primera sincronización) no avisa nada, y solo se avisan los cambios de contratos `active` o `payment_failed`.
Los correos se envían después de confirmar la transacción; un fallo se registra (`payment.notification_failed`) y no
revierte nada.

### A34. Fase 7B: cupones de descuento y cortesías (2026-11-27)
Decisiones de la dueña del proyecto (B17, B18) y puntos que el SDD no definía, resueltos así al implementar. Todos son
reversibles.

**Alcance.** Cupones de Stripe en el **pago único y la suscripción con tarjeta**, incluido el 100 % (cortesía). La
transferencia no lleva cupones. Ferro crea los cupones y los códigos promocionales en el Dashboard de Stripe (no hay
panel propio). En la suscripción el cupón **se acumula con el 10 %** (B18): Stripe lo aplica sobre el precio del Price
recurrente.

**Checkout.** `allow_promotion_codes: true` en los dos modos: el formulario de Checkout Studio (`ui_mode: form`) muestra
el campo de código por sí solo (`features.promotionCodeCollection`, por defecto `auto`), así que no hay un campo
propio. La página escucha el evento `change` del SDK y muestra el descuento, el código y "Hoy pagas" (o "Sin costo
(cortesía)"), y en la suscripción cuánto dura. La suscripción lleva `payment_method_collection: "always"`: **siempre se
pide la tarjeta**, también con un 100 %; con `if_required`, un cupón de "primer mes gratis" no la pediría y el segundo
mes fallaría (A32).

**Cortesías.** Suscripción con un cupón del **100 % "para siempre"** y un **código de un solo uso por persona**. Se
renueva sola en $0 cada mes, con sus correos y el botón de entrega para Ferro; la tarjeta no se cobra. **Ferro la termina
a mano** en el Dashboard: cancela la suscripción (aviso de fin, sin cobro) o le quita el cupón (aviso de descuento
terminado; la siguiente renovación cobra el precio normal). Para cortesías no se usan cupones de duración fija, para que
nunca haya un cobro sorpresa. Quien no quiera dar su tarjeta: pago único con un código del 100 % (un mes a la vez).

**Pagos de $0.**
- Pago único: `checkout.session.completed` con `payment_status = no_payment_required` se procesa igual que `paid`
  (Payment de $0 sin Payment Intent, ServicePeriod y botón de entrega).
- Suscripción: una factura de $0 **por un descuento** (`total_discount_amounts`) abre su mes como cualquier pago; una de
  $0 sin descuento (ajustes de Stripe) sigue sin abrirlo (SDD §7.5).
- En la BD, `payments_amount_positive_check` admite `amount = 0` solo con `discountAmount > 0`.

**Registro.** El Payment guarda lo cobrado (`amount`), el descuento (`discountAmount`) y el código (`promotionCode`). El
contrato conserva el precio de lista. Se audita `stripe.discount_applied` y `stripe.amount_mismatch` compara el precio
antes del descuento. El texto del código se lee de Stripe (`promotionCodes.retrieve`) solo para mostrarlo: si Stripe no
responde, se registra el descuento sin el código en lugar de fallar el pago. La Subscription guarda si tiene un cupón
vigente (`hasDiscount`, `promotionCode`; la app la lee con `expand: ["discounts"]`) y, cuando lo pierde (Ferro lo quita
o termina su duración), avisa al cliente y a Ferro el precio del siguiente cobro, salvo que la suscripción ya tenga la
cancelación programada.

**Correos.** Purchase Confirmation, Payment Received, Subscription Renewed y Renewal Successful muestran precio,
descuento con el código y lo cobrado, o "Cortesía (sin costo)".

**Cupón puesto a mano por Ferro** (decidido el 2026-11-27). Ferro puede ponerle un cupón a una suscripción que ya existe
en el Dashboard (en la suscripción, no en el cliente: si se quita del cliente, la app no avisa). **No hay un aviso al
ponerlo**: el mes en curso no cambia y el descuento aparece en los correos de la siguiente renovación (sin código, porque
nadie lo escribió). Si hace falta avisar antes, Ferro lo hace por WhatsApp. Al quitarlo sí se avisa (descuento
terminado). En el pago único no se puede poner a mano: siempre es con un código.

### A35. Cambiar el correo de un cliente con un script (2026-11-27)
Decisión de la dueña del proyecto. El correo es la identidad del cliente (RF-15): con él se inscribe, recibe los correos
y entra a "Administrar mi suscripción", y en el portal de Stripe no se puede editar (A33). Si un cliente necesita
cambiarlo, Ferro lo pide y quien mantiene el sistema corre `npm run customer:change-email -- <actual> <nuevo>`:
- Primero muestra lo que va a cambiar sin tocar nada; `--confirmar` lo aplica. Con una clave live exige `--live`.
- En una transacción (`customer.service.changeCustomerEmail`): valida y normaliza los dos correos, revisa que el nuevo no
  sea de otro cliente, lo cambia, audita `customer.email_changed` (sin los correos en la metadata) y actualiza el correo
  del cliente de Stripe; si Stripe falla, no cambia nada.
- Contratos, pagos y suscripción se conservan: están ligados al cliente, no al correo.
- No verifica el correo nuevo con un código: quien lo corre confirma antes con el cliente que es suyo.

No hay pantalla para que el cliente lo cambie solo; si se vuelve frecuente, sería una opción "Cambiar mi correo" en
`/suscripcion` con un código al correo actual y otro al nuevo.

## B. Decisiones pendientes (de SRS §13.2 / SDD §13)

| # | Decisión | Bloquea | Estado |
|---|---|---|---|
| 1 | Proveedor PostgreSQL | — | Resuelto en A17: Neon |
| 2 | Importe final e impuestos (IVA) | — | Resuelto en A18: precios finales; 10 % de descuento en suscripción |
| 3 | Correo de notificaciones de Ferro | — | Resuelto en A17: se carga en Vercel |
| 4 | Dominio | Fase 8 | Resuelto en A17: se compra en GoDaddy |
| 5 | Remitente de Resend | — | Resuelto en A17: se carga en Vercel; se verifica con el dominio (Fase 8) |
| 6 | Fechas exactas del periodo de un mes | — | Resuelto en A19: un mes desde la fecha de pago; la entrega del plan es solo referencia |
| 7 | Reintentos y suspensión por pagos fallidos | — | Resuelto en A19 y A32: tres intentos en días seguidos; el servicio se suspende mientras haya un pago vencido; si ninguno pasa, se cancela |
| 8 | Mecanismo de cancelación | — | Resuelto en A21: Stripe Customer Portal con OTP, al final del periodo |
| 9 | Nuevas contrataciones con un periodo vigente o un contrato pendiente | — | Resuelto en A20 |
| 10 | WhatsApp oficial de Ferro | — | Resuelto en A17: se carga en Vercel |
| 11 | Expiración del enlace de transferencia | — | Resuelto en A7: 7 días, regenerable |
| 12 | Política de privacidad y condiciones | Fase 8 | Borrador en A22; faltan los datos del responsable y la revisión legal |
| 13 | Formato del WhatsApp guardado (E.164 vs. 10 dígitos sin lada) | — | Resuelto en A15: selector de país (México por defecto), cualquier país, E.164 |
| 14 | ¿Los recordatorios de entrega paran cuando termina el mes aunque no se haya registrado la entrega? | — | Pendiente de Ferro. Hoy siguen hasta que se registra (A19, A25); se espera que Ferro siempre la registre. Si decide que paren, es un filtro en `sendPlanDeliveryReminders` |
| 15 | Pago asíncrono fallido (p. ej. OXXO sin pagar): ¿el contrato pasa a `payment_failed` o sigue pendiente? | — | Resuelto en A26 (2026-11-25): sigue `pending_payment`, el cliente recibe un aviso y puede reintentar con la misma referencia; vence a los 7 días sin actividad |
| 16 | Promoción de varios meses en un solo pago (p. ej. paga 3 y el 4.º gratis) | — | Idea de Ferro para el futuro (A28), sin fecha. Implicaría un Price de paquete en Stripe y que un Payment abra varios ServicePeriod seguidos (hoy `ServicePeriod.paymentId` es UNIQUE), con sus correos y recordatorios por mes |
| 17 | Cupones de descuento | — | Resuelto en A34 (Fase 7B). Alcance decidido (2026-11-27): pago único y suscripción mensual con tarjeta, incluido el 100 % (cortesía); la transferencia no. Cortesías: suscripción con cupón del 100 % "para siempre", código de un solo uso por persona, pidiendo la tarjeta, y Ferro la termina a mano (cancelar o quitar el cupón). El cupón se acumula con el 10 % de la suscripción (B18). Ferro los crea en el Dashboard de Stripe. Probado en modo de prueba con claves reales (2026-11-27): el formulario muestra el campo de código y lo valida; cupones del 100 % y del 20 % en el pago único y en la suscripción. Falta probar quitarle el cupón a una suscripción |
| 18 | ¿Un cupón en la suscripción se acumula con su 10 % de descuento? | — | Resuelto (2026-11-27): **sí se acumulan**. El cupón se aplica sobre el precio de la suscripción, que ya tiene el 10 % (p. ej. 20 % sobre $1,080 = $864 al mes en HM RUN). Integrado en A34 |
