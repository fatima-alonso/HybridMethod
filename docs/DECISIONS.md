# Decisiones — THE HYBRID METHOD

Registro de decisiones y temas pendientes. Las decisiones A1–A8 ya están integradas en
**SRS v1.4** y **SDD v1.3**; A9 en **SDD v1.4**; A11 y A12 en **SRS v1.5** y **SDD v1.5**; A14 en **SDD v1.6**; A15 (que reemplaza a A11) en **SRS v1.6** y **SDD v1.6**; A16 en **SDD v1.7**; A17–A22 en **SRS v1.7** y **SDD v1.8**; este archivo conserva el porqué de cada una. Cuando se tome una
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

### A20. Contratos pendientes, vencimiento y pagos por adelantado (B9)
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

## B. Decisiones pendientes (de SRS §13.2 / SDD §13)

| # | Decisión | Bloquea | Estado |
|---|---|---|---|
| 1 | Proveedor PostgreSQL | — | Resuelto en A17: Neon |
| 2 | Importe final e impuestos (IVA) | — | Resuelto en A18: precios finales; 10 % de descuento en suscripción |
| 3 | Correo de notificaciones de Ferro | — | Resuelto en A17: se carga en Vercel |
| 4 | Dominio | Fase 8 | Resuelto en A17: se compra en GoDaddy |
| 5 | Remitente de Resend | — | Resuelto en A17: se carga en Vercel; se verifica con el dominio (Fase 8) |
| 6 | Fechas exactas del periodo de un mes | — | Resuelto en A19: un mes desde la fecha de pago; la entrega del plan es solo referencia |
| 7 | Reintentos y suspensión por pagos fallidos | — | Resuelto en A19: Smart Retries; el servicio se suspende mientras haya un pago vencido |
| 8 | Mecanismo de cancelación | — | Resuelto en A21: Stripe Customer Portal con OTP, al final del periodo |
| 9 | Nuevas contrataciones con un periodo vigente o un contrato pendiente | — | Resuelto en A20 |
| 10 | WhatsApp oficial de Ferro | — | Resuelto en A17: se carga en Vercel |
| 11 | Expiración del enlace de transferencia | — | Resuelto en A7: 7 días, regenerable |
| 12 | Política de privacidad y condiciones | Fase 8 | Borrador en A22; faltan los datos del responsable y la revisión legal |
| 13 | Formato del WhatsApp guardado (E.164 vs. 10 dígitos sin lada) | — | Resuelto en A15: selector de país (México por defecto), cualquier país, E.164 |
