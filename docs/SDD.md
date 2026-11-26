# THE HYBRID METHOD
## Software Design Document (SDD)

| | |
|---|---|
| **Versión** | 1.14 |
| **Estado** | Diseño técnico actualizado |
| **Relacionado con** | SRS v1.8 |
| **Producto** | THE HYBRID METHOD / by Ferro Fits |

### Historial de cambios
| Versión | Fecha | Cambios |
|---|---|---|
| 1.2 | — | Diseño técnico actualizado. |
| 1.3 | 2026-11-23 | Se incorporan las decisiones A1–A8 de `docs/DECISIONS.md`: sin `country`; relación Contract N:1 Program; estados de Contract sin `paid`; OTP obligatorio con sesión de verificación; confirmación de transferencia con enlace + PIN y sin `reject`; eventos de webhook con una sola fuente de verdad; dos Price IDs por programa; se agrega la entidad AuditLog. |
| 1.4 | 2026-11-23 | §9.1: política de validación de variables de entorno por entorno (DECISIONS A9). |
| 1.5 | 2026-11-23 | §4: carpeta `src/content/` para el catálogo de programas y los textos de la landing; §6.4: lectura del número de WhatsApp en la landing prerenderizada (DECISIONS A12). |
| 1.7 | 2026-11-24 | Fase 3 (DECISIONS A16): §5.3 entidad RateLimitBucket y hash HMAC de los OTP; §7.1 límites concretos y nombre de la cookie; §7.6 body de `POST /api/transfers` (crea o asocia el cliente) y protección ante doble envío; §9.4 rate limit en PostgreSQL. |
| 1.8 | 2026-11-24 | Respuestas de Ferro (DECISIONS A17–A22): `Program.subscriptionPrice` (10 % de descuento); entidades ServicePeriod y PlanDeliveryLink; estados `scheduled` y `expired`; `Contract.lastActivityAt` y un solo pendiente por cliente; periodos de un mes desde la fecha de pago; registro informativo de la entrega del plan con botón y recordatorios (§7.8); Customer Portal (§7.7); cron diario; Neon y GoDaddy. |
| 1.10 | 2026-11-25 | Fase 4, parte 2 (DECISIONS A25): §4 `contract-request`, `service-period`, `delivery` y `cron` services; §7.3 respuestas (`outcome`, 201/200, 409) y `pendingAction`; §7.8 festivos de la LFT, horario del cron y reintento de recordatorios. |
| 1.9 | 2026-11-24 | Fase 4, confirmación de transferencias (DECISIONS A23): §4 `transfer-approval.service`; §7.6 conteo de intentos antes de comparar el PIN, respuestas y rate limits de la confirmación y la regeneración; §9.3 PIN de 6 a 12 dígitos solo con bcrypt. |
| 1.14 | 2026-11-26 | Formulario de pago de Checkout Studio (DECISIONS A29): §6.1 y §7.4 `ui_mode: form`, `returnUrl` en la respuesta, tarjeta guardada en Stripe y sin pedir el nombre. |
| 1.13 | 2026-11-26 | Mes con mes, sin pagos por adelantado (DECISIONS A28): §7.3 regla 3 (`409 active_period`), §5.3 `scheduled` solo por un pago tardío, §10. |
| 1.12 | 2026-11-25 | Formulario de pago incrustado (DECISIONS A27): §6.1 y §7.4 Embedded Checkout (`client_secret` y clave publicable en la respuesta); se quita `/pago/cancelado`. |
| 1.11 | 2026-11-25 | Fase 5, pago único con Stripe (DECISIONS A26): §4 `checkout`, `stripe-webhook`, `stripe-catalog` y `payment-notifications` services, script `stripe-sync` y páginas `/pago/exito` y `/pago/cancelado`; §6.1 productos y Prices por `lookup_key`; §7.4 body, reutilización de la sesión y respuestas; §7.5 bloqueo del evento, reintentos, cobro adicional y pago asíncrono fallido: el contrato sigue pendiente (B15, confirmado). |
| 1.6 | 2026-11-23 | §4: `program.service`; §5.3: Program con `displayOrder` y `updatedAt`, origen de los datos de la landing, formato de la referencia; §5.4: restricciones CHECK y transiciones compare-and-set (DECISIONS A14); WhatsApp de cualquier país en E.164 (DECISIONS A15). |

---

## 1. Introducción

### 1.1 Propósito
Este documento describe el diseño técnico de THE HYBRID METHOD: arquitectura, componentes, base de datos, integraciones externas, endpoints, flujos de procesamiento y consideraciones de seguridad.

Su objetivo es servir de guía para implementar el sistema según los requisitos del SRS.

### 1.2 Objetivo técnico
Construir una aplicación web que presente los servicios de THE HYBRID METHOD y gestione contrataciones, pagos, suscripciones y notificaciones, sin desarrollar una plataforma de entrenamiento.

---

## 2. Arquitectura general

### 2.1 Arquitectura propuesta
Se usará una arquitectura web basada en Next.js (App Router), con el backend integrado mediante Route Handlers.

La aplicación se comunicará con PostgreSQL mediante Prisma y usará servicios externos para pagos, correo electrónico y hosting.

### 2.2 Diagrama de arquitectura
```
                         CLIENTE
                            |
                            v
                      LANDING PAGE
                         Next.js
                            |
                            v
                      BACKEND / API
                         Next.js
                            |
          +-----------------+------------------+
          |                 |                  |
          v                 v                  v
       PRISMA            STRIPE             RESEND
          |          Checkout/Billing       Emails
          v                 |
      POSTGRESQL            |
         NEON               |
          ^                 |
          |                 v
          +-------- STRIPE WEBHOOKS
```

### 2.3 Componentes principales

| Componente | Responsabilidad |
|---|---|
| Frontend | Presentación visual y formularios |
| Backend | Lógica de negocio y validaciones |
| Prisma | Acceso a datos |
| PostgreSQL | Persistencia |
| Stripe | Pagos y suscripciones |
| Webhooks | Recepción de eventos de Stripe |
| Resend | Notificaciones por correo |
| Vercel | Despliegue y hosting |

### 2.4 Infraestructura propuesta
- Aplicación: Vercel.
- Base de datos: Neon, pendiente de confirmación.
- Dominio: GoDaddy o Vercel, pendiente de elección.
- Repositorio: GitHub.
- Variables sensibles: configuración de entorno en Vercel.

---

## 3. Stack tecnológico

| Tecnología | Uso |
|---|---|
| Next.js | Framework de frontend y backend |
| TypeScript | Lenguaje principal |
| Tailwind CSS | Estilos y diseño responsive |
| Zod | Validación de esquemas compartida entre cliente y servidor |
| PostgreSQL | Base de datos relacional |
| Prisma ORM | Consultas y gestión de modelos |
| Stripe Checkout | Interfaz segura de pago |
| Stripe Billing | Suscripciones y renovaciones |
| Stripe Webhooks | Eventos de pagos |
| Resend | Envío de correos |
| Vercel | Hosting y despliegue |
| Neon | Hosting de PostgreSQL (propuesto) |
| Vitest | Pruebas unitarias y de integración |

---

## 4. Estructura de la aplicación
```
the-hybrid-method/
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts
│   └── migrations/
├── public/
│   ├── images/
│   ├── logos/
│   └── fonts/
├── scripts/
│   ├── hash-pin.ts
│   └── stripe-sync.ts
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── programs/
│   │   ├── checkout/
│   │   ├── verify/
│   │   ├── payment/
│   │   ├── transfer/
│   │   │   └── confirm/[token]/
│   │   ├── plan/
│   │   │   └── entrega/[token]/
│   │   ├── confirmation/
│   │   ├── pago/
│   │   │   └── exito/            # regreso de Stripe Checkout (solo informa)
│   │   └── api/
│   │       ├── customers/
│   │       ├── contracts/
│   │       ├── checkout/
│   │       ├── transfers/
│   │       ├── portal/
│   │       ├── plan-delivery/
│   │       ├── cron/
│   │       ├── verification/
│   │       └── webhooks/
│   ├── components/
│   │   ├── layout/
│   │   ├── landing/
│   │   ├── programs/
│   │   ├── forms/
│   │   ├── checkout/
│   │   └── shared/
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── stripe.ts
│   │   ├── resend.ts
│   │   ├── validations.ts
│   │   ├── crypto.ts
│   │   ├── rate-limit.ts
│   │   └── config.ts
│   ├── services/
│   │   ├── customer.service.ts
│   │   ├── contract.service.ts
│   │   ├── payment.service.ts
│   │   ├── payment-notifications.service.ts
│   │   ├── checkout.service.ts
│   │   ├── stripe-webhook.service.ts
│   │   ├── stripe-catalog.service.ts
│   │   ├── subscription.service.ts
│   │   ├── transfer.service.ts
│   │   ├── transfer-approval.service.ts
│   │   ├── contract-request.service.ts
│   │   ├── service-period.service.ts
│   │   ├── delivery.service.ts
│   │   ├── cron.service.ts
│   │   ├── delivery.service.ts       # periodos de servicio, entrega del plan y recordatorios
│   │   ├── verification.service.ts
│   │   ├── program.service.ts
│   │   ├── audit.service.ts
│   │   └── email.service.ts
│   ├── content/          # catálogo de programas y textos de la landing (DECISIONS A12)
│   ├── types/
│   └── utils/
├── .env.example
├── package.json
└── README.md
```

Esta estructura es una propuesta inicial y se puede ajustar durante la implementación sin cambiar las responsabilidades de los módulos.

---

## 5. Diseño de base de datos

### 5.1 Modelo conceptual
Entidades principales:
- Customer
- Program
- Contract
- Payment
- ServicePeriod
- Subscription
- TransferApproval
- PlanDeliveryLink
- OTPVerification
- WebhookEvent
- AuditLog

### 5.2 Relaciones principales
```
Customer ──1:N──> Contract
Customer ──1:N──> Subscription
Customer ──1:N──> OTPVerification   (customerId opcional: el correo puede ser nuevo)

Program  ──1:N──> Contract          (un programa tiene muchos contratos)
Program  ──1:N──> Subscription

Contract ──1:N──> Payment
Contract ──1:N──> ServicePeriod     (un periodo por cada mes pagado)
Contract ──1:0..1──> Subscription
Contract ──1:N──> TransferApproval  (un enlace vigente a la vez; los anteriores quedan invalidados)

Payment  ──1:0..1──> ServicePeriod  (cada pago exitoso abre un mes)
Program  ──1:N──> ServicePeriod     (programa de ese mes; en suscripciones puede cambiar)
ServicePeriod ──1:N──> PlanDeliveryLink (el botón del correo de compra y uno por recordatorio)

Subscription ──1:N──> Payment       (un Payment por cada factura pagada)

WebhookEvent                        registro independiente de eventos
AuditLog                            registro independiente de operaciones sensibles
```

### 5.3 Modelo de entidades

#### Customer
Guarda la información básica del cliente.

| Campo | Tipo | Descripción |
|---|---|---|
| id | String / UUID | Identificador |
| fullName | String | Nombre completo |
| email | String (UNIQUE) | Correo electrónico normalizado (minúsculas, sin espacios) |
| whatsapp | String | Número de contacto en formato E.164, de cualquier país (DECISIONS A15) |
| stripeCustomerId | String? (UNIQUE) | ID del cliente en Stripe |
| createdAt | DateTime | Fecha de registro |
| updatedAt | DateTime | Última actualización |

El correo se normaliza antes de guardarlo y de buscarlo, para evitar duplicados. No hay campo de país.

#### Program
Guarda los programas disponibles.

| Campo | Tipo | Descripción |
|---|---|---|
| id | String / UUID | Identificador |
| slug | String (UNIQUE) | Identificador legible (`hm-run`, `hm-strength`, `hm-complete`) |
| name | String | Nombre del programa |
| description | String | Descripción |
| monthlyPrice | Decimal | Precio mensual completo (pago único y transferencia) |
| subscriptionPrice | Decimal | Precio mensual con suscripción (`monthlyPrice` − 10 %, guardado ya redondeado; DECISIONS A18) |
| currency | String | Moneda (`MXN`) |
| stripePriceIdOneTime | String? | Price de Stripe de tipo `one_time` |
| stripePriceIdRecurring | String? | Price de Stripe de tipo `recurring` mensual |
| active | Boolean | Disponibilidad |
| displayOrder | Integer | Orden en la landing |
| createdAt | DateTime | Fecha de creación |
| updatedAt | DateTime | Última actualización |

La tabla se llena con el seed desde `src/content/programs.ts`; la landing lee de la BD los programas activos y toma del catálogo solo los textos editoriales (DECISIONS A14). El Price `one_time` debe valer `monthlyPrice` y el `recurring`, `subscriptionPrice`. El backend lo comprueba antes de crear un Checkout y registra un error si no coinciden. Los precios son finales (DECISIONS A18).

#### Contract
Representa una contratación específica.

| Campo | Tipo | Descripción |
|---|---|---|
| id | String / UUID | Identificador |
| reference | String (UNIQUE) | Referencia única `HM-AAAA-NNNNNN` |
| customerId | String (FK) | Cliente |
| programId | String (FK) | Programa (N:1) |
| paymentType | Enum | `transfer` / `one_time` / `subscription` |
| status | Enum | Estado del contrato |
| amount | Decimal | Importe de la modalidad elegida, copiado del programa (`monthlyPrice` o `subscriptionPrice`) |
| currency | String | Moneda |
| stripeCheckoutSessionId | String? (UNIQUE) | Sesión de Checkout asociada |
| serviceStartDate | DateTime? | Inicio del periodo vigente (copia del ServicePeriod vigente) |
| serviceEndDate | DateTime? | Fin del periodo vigente (copia del ServicePeriod vigente) |
| lastActivityAt | DateTime | Última actividad mientras está pendiente: creación, reanudación, cambio o regeneración del enlace (DECISIONS A20) |
| createdAt | DateTime | Fecha de creación |
| updatedAt | DateTime | Última actualización |

Un cliente tiene como máximo un contrato `pending_payment` (índice único parcial sobre `customerId` `WHERE status = 'pending_payment'`).

Estados:

| Estado | Significado |
|---|---|
| `pending_payment` | Creado y esperando el pago (transferencia sin aprobar o Checkout sin completar). |
| `expired` | Pendiente vencido tras 7 días sin actividad. Ya no se reutiliza (DECISIONS A20). |
| `scheduled` | Pagado, pero el mes empieza al terminar el periodo vigente del cliente. Ya no se paga por adelantado (DECISIONS A28): solo ocurre con un pago tardío confirmado mientras el cliente tiene un mes vigente (A20). |
| `active` | Pago confirmado y mes en curso: `serviceStartDate ≤ now < serviceEndDate`. |
| `completed` | Terminó el periodo pagado sin renovación (pago único o transferencia). |
| `payment_failed` | Suscripción con un cobro vencido (`past_due`/`unpaid`) o pago asíncrono fallido. El servicio está suspendido. |
| `cancelled` | Suscripción cancelada; no se recorta un periodo ya pagado. |

Transiciones permitidas (solo mediante `contract.service`):

```
pending_payment ──> active          (pago confirmado)
pending_payment ──> scheduled       (pago confirmado con un periodo vigente: pago tardío, A28)
pending_payment ──> expired         (7 días sin actividad)
expired         ──> active | scheduled  (pago tardío: se respeta y se audita)
scheduled       ──> active          (llega la fecha de inicio)
active          ──> completed       (pago único o transferencia: terminó el mes)
active          ──> payment_failed  (suscripción: falló la renovación)
payment_failed  ──> active          (se pagó el reintento)
active | payment_failed ──> cancelled  (suscripción)
```

Que el pago se hizo queda en `Payment.status = succeeded` y en `ServicePeriod.paidAt`. Cada mes va de la fecha de pago al mismo día del mes siguiente (DECISIONS A19); en suscripciones, es el periodo de la factura pagada, y cada `invoice.paid` crea un ServicePeriod y extiende `serviceEndDate`. `scheduled → active`, `active → completed` y `pending_payment → expired` se calculan al leer (`effectiveContractStatus`) y el cron diario los persiste. La fecha de entrega del plan no cambia ningún estado.

#### Payment
Guarda cada transacción.

| Campo | Tipo | Descripción |
|---|---|---|
| id | String / UUID | Identificador |
| contractId | String (FK) | Contrato asociado |
| subscriptionId | String? (FK) | Suscripción asociada |
| method | Enum | `transfer` / `stripe_one_time` / `stripe_subscription` |
| stripePaymentIntentId | String? (UNIQUE) | Payment Intent |
| stripeInvoiceId | String? (UNIQUE) | Factura de Stripe |
| amount | Decimal | Importe |
| currency | String | Moneda |
| status | Enum | Estado del pago |
| paidAt | DateTime? | Fecha de pago |
| createdAt | DateTime | Fecha de registro |

Estados: `pending`, `succeeded`, `failed`, `refunded`.

Cada renovación crea un Payment nuevo; los existentes nunca se sobrescriben. Las restricciones UNIQUE sobre `stripeInvoiceId` y `stripePaymentIntentId` son una segunda barrera contra duplicados.

#### ServicePeriod
Un mes pagado (DECISIONS A19). Guarda las tres fechas que pide Ferro.

| Campo | Tipo | Descripción |
|---|---|---|
| id | String / UUID | Identificador |
| contractId | String (FK) | Contrato |
| paymentId | String (FK, UNIQUE) | Pago que abrió el mes |
| programId | String (FK) | Programa de ese mes (en suscripciones puede cambiar desde el portal) |
| sequence | Integer | Número de mes dentro del contrato (1, 2, …); UNIQUE con `contractId` |
| paidAt | DateTime | Fecha de pago |
| planDeliveredOn | Date? | Día de entrega del plan, registrado por Ferro. Solo referencia |
| startDate | DateTime | Inicio del mes: la fecha de pago, o el fin del periodo vigente del cliente si el pago tardío llegó con un mes vigente (en suscripciones, el inicio del periodo de la factura) |
| endDate | DateTime | Mismo día del mes siguiente (último día del mes si no existe) |
| deliveryRecordedAt | DateTime? | Cuándo se registró la entrega |
| lastReminderAt | DateTime? | Último recordatorio enviado a Ferro |
| createdAt | DateTime | Creación |
| updatedAt | DateTime | Última actualización |

Restricciones: `endDate > startDate`; `planDeliveredOn` ≥ día de `paidAt`. Una vez registrada, la entrega no se cambia desde la web; una corrección es un cambio manual con AuditLog.

#### Subscription
Guarda la información de las suscripciones recurrentes.

| Campo | Tipo | Descripción |
|---|---|---|
| id | String / UUID | Identificador |
| customerId | String (FK) | Cliente |
| programId | String (FK) | Programa |
| contractId | String (FK, UNIQUE) | Contrato inicial |
| stripeSubscriptionId | String (UNIQUE) | ID de Stripe |
| status | Enum | Estado |
| currentPeriodStart | DateTime? | Inicio del periodo |
| currentPeriodEnd | DateTime? | Fin del periodo |
| cancelAtPeriodEnd | Boolean | Cancelación al final del periodo |
| createdAt | DateTime | Fecha de creación |
| updatedAt | DateTime | Última actualización |

Estados: `incomplete`, `active`, `past_due`, `canceled`, `unpaid`.

Stripe es la fuente principal del estado de facturación. La base de datos local mantiene una copia sincronizada mediante webhooks.

#### TransferApproval
Controla los enlaces privados para confirmar transferencias.

| Campo | Tipo | Descripción |
|---|---|---|
| id | String / UUID | Identificador |
| contractId | String (FK) | Contrato |
| tokenHash | String (UNIQUE) | Hash SHA-256 del token |
| expiresAt | DateTime | Expiración (por defecto, 7 días) |
| pinAttempts | Integer | Intentos con PIN incorrecto |
| usedAt | DateTime? | Fecha en que se usó para aprobar |
| invalidatedAt | DateTime? | Fecha de invalidación (regeneración o exceso de intentos) |
| approvedBy | String? | Identidad del aprobador (`"ferro"`) |
| createdAt | DateTime | Creación |

Un token es válido solo si `usedAt`, `invalidatedAt` son nulos, `expiresAt > now` y `pinAttempts < 5`. Al generar un enlace nuevo para un contrato, los anteriores se invalidan.

#### PlanDeliveryLink
Los botones "Registrar entrega del plan" (DECISIONS A19): uno en el correo de compra y uno en cada recordatorio.

| Campo | Tipo | Descripción |
|---|---|---|
| id | String / UUID | Identificador |
| servicePeriodId | String (FK) | Mes al que pertenece |
| tokenHash | String (UNIQUE) | Hash SHA-256 del token |
| expiresAt | DateTime | Expiración (7 días, `TRANSFER_LINK_TTL_DAYS`) |
| usedAt | DateTime? | Si con este botón se registró la entrega |
| createdAt | DateTime | Creación |

Un botón es válido si `expiresAt > now` y su ServicePeriod no tiene `planDeliveredOn`. Varios botones del mismo mes pueden estar vigentes a la vez; registrar la entrega con uno deja sin efecto a todos. No pide PIN: solo registra un dato de referencia.

#### OTPVerification
Permite verificar el correo electrónico.

| Campo | Tipo | Descripción |
|---|---|---|
| id | String / UUID | Identificador |
| customerId | String? (FK) | Cliente asociado, si ya existe |
| email | String | Correo normalizado |
| codeHash | String | HMAC-SHA256 del correo y el código, con una clave derivada de `OTP_SESSION_SECRET` (DECISIONS A16) |
| expiresAt | DateTime | Expiración (10 minutos) |
| attempts | Integer | Intentos (máximo 5) |
| verifiedAt | DateTime? | Fecha de verificación |
| createdAt | DateTime | Creación |

#### WebhookEvent
Registra los eventos recibidos de Stripe.

| Campo | Tipo | Descripción |
|---|---|---|
| id | String / UUID | Identificador |
| stripeEventId | String (UNIQUE) | ID único del evento |
| eventType | String | Tipo de evento |
| status | Enum | `received` / `processed` / `failed` / `ignored` |
| error | String? | Detalle del error, si lo hubo |
| processedAt | DateTime? | Fecha de procesamiento |
| createdAt | DateTime | Fecha de recepción |

La restricción UNIQUE de `stripeEventId` evita que un evento se procese dos veces.

#### AuditLog
Registra las operaciones sensibles (confirmación de transferencias, intentos fallidos de PIN, regeneración de enlaces, cancelaciones, cambios manuales).

| Campo | Tipo | Descripción |
|---|---|---|
| id | String / UUID | Identificador |
| action | String | Acción (`transfer.approved`, `transfer.pin_failed`, `transfer.link_regenerated`, …) |
| actor | String | Quién la hizo (`ferro`, `customer:<id>`, `system`, `stripe`) |
| entityType | String | Entidad afectada |
| entityId | String | ID de la entidad |
| ip | String? | IP de origen |
| userAgent | String? | User-agent |
| metadata | Json? | Datos adicionales, sin información sensible |
| createdAt | DateTime | Fecha |

#### RateLimitBucket
Contadores de rate limit de ventana fija (DECISIONS A16). Viven en la BD porque en Vercel cada instancia tiene su propia memoria.

| Campo | Tipo | Descripción |
|---|---|---|
| key | String (PK) | `<alcance>:<HMAC del identificador>`; la IP o el correo nunca se guardan en claro |
| count | Integer | Solicitudes en la ventana actual (≥ 1) |
| windowStart | DateTime | Inicio de la ventana actual |

Se actualiza con un único `INSERT … ON CONFLICT DO UPDATE` (atómico). Los contadores viejos se purgan con `purgeRateLimitBuckets()` (cron diario, Fase 8).

### 5.4 Consideraciones de integridad
- Los identificadores principales deben ser únicos.
- Las referencias de contratos tienen una restricción UNIQUE y se generan de forma segura ante concurrencia con la secuencia `contract_reference_seq`: `HM-<año en America/Mexico_City>-<consecutivo de 6 dígitos o más>`, sin reinicio anual (DECISIONS A14).
- Restricciones CHECK en la BD: correo normalizado, WhatsApp en E.164, importes positivos, moneda ISO de 3 letras, formato de la referencia, periodo de servicio coherente y límites de intentos (DECISIONS A14).
- Las transiciones de estado del contrato son compare-and-set (`UPDATE … WHERE status IN (…)`), así que dos procesos simultáneos no pueden aplicar la misma transición dos veces.
- Los importes se guardan como `Decimal`, nunca como `float`.
- Las relaciones usan claves foráneas.
- Los registros de pago nunca se sobrescriben cuando hay una renovación; cada renovación crea un Payment y un ServicePeriod.
- Un solo contrato `pending_payment` por cliente (índice único parcial). Al buscar pendientes, primero se vencen en la misma transacción los que llevan 7 días sin actividad.
- Los eventos de Stripe conservan una referencia única.
- Los estados solo cambian mediante operaciones controladas por los servicios de negocio, y los cambios relacionados (Payment + Contract + TransferApproval + AuditLog) se hacen en una sola transacción.

---

## 6. Diseño de integraciones

### 6.1 Stripe
Stripe procesa los pagos y administra las suscripciones. Se usarán:
- Stripe Checkout en modo `payment` para pagos únicos (`stripePriceIdOneTime`), con el formulario de pago incrustado en la landing (`ui_mode: form`, configurado en Checkout Studio; DECISIONS A27, A29).
- Stripe Checkout en modo `subscription` para suscripciones mensuales (`stripePriceIdRecurring`).
- Stripe Billing para los ciclos recurrentes.
- Stripe Webhooks para sincronizar los eventos con la aplicación.

Cada programa tiene en Stripe un Product con dos Prices: uno `one_time` por `monthlyPrice` y uno `recurring` mensual por `subscriptionPrice` (10 % menos; DECISIONS A18). El Product usa el slug como id y los Prices se identifican con `lookup_key` (`<slug>_one_time`, `<slug>_recurring`). `npm run stripe:sync` los crea o actualiza y guarda sus IDs en `programs`; un precio que cambia crea un Price nuevo y archiva el anterior (DECISIONS A26).

Las suscripciones cobran mes con mes desde el primer pago, el comportamiento normal de Stripe (DECISIONS A19).

**Configuración en el Dashboard de Stripe:**
- Smart Retries con la configuración por defecto. Al agotarse los reintentos, cancelar la suscripción.
- Customer Portal (§7.7): cancelación al final del periodo; cambio entre los tres Price recurrentes sin prorrateo; actualización del método de pago.

Solo el backend crea las sesiones de Checkout. El navegador nunca decide importes ni Price IDs. La sesión incluye `metadata.contractId` y `client_reference_id` para relacionar los eventos con el contrato.

### 6.2 Resend
Resend envía los correos electrónicos.

| Plantilla | Destinatario | Evento |
|---|---|---|
| Verification Code | Cliente | Solicitud de verificación de correo |
| Purchase Confirmation | Cliente | Pago inicial exitoso |
| Welcome Email | Cliente | Activación del servicio (incluye "Ferro te entregará tu plan en 3 a 5 días hábiles") |
| Plan Delivery Reminder | Entrenador | Cada día hábil, uno por cada mes sin fecha de entrega: "Está pendiente el plan de [cliente]", con su propio botón "Registrar entrega del plan" |
| Transfer Pending | Entrenador | Nueva transferencia pendiente (incluye el enlace privado) |
| Payment Received | Entrenador | Cada pago confirmado (pago único, transferencia, primer pago de suscripción): datos completos del cliente y de la compra, y botón "Registrar entrega del plan" |
| Renewal Successful | Entrenador | Renovación exitosa: los mismos datos y su propio botón de entrega |
| Payment Failed | Cliente y entrenador | Pago fallido |
| Subscription Cancelled | Cliente y entrenador | Cancelación |
| Transfer Confirmed | Cliente | Transferencia confirmada |

El remitente ya está definido; se verifica en Resend junto con el dominio (Fase 8). En desarrollo, si no hay `RESEND_API_KEY`, los correos se registran en la consola.

Un fallo al enviar un correo nunca revierte una operación de pago ya confirmada: se registra y se puede reintentar.

### 6.3 Neon y PostgreSQL
Neon aloja PostgreSQL (DECISIONS A17). La conexión se hace mediante:
```
DATABASE_URL=
```
Prisma usa esta conexión. La cuenta y el entorno de producción deben configurarse antes del despliegue final.

### 6.4 WhatsApp
No se implementará la integración con la WhatsApp Business API. Se usará un enlace `wa.me` con el número oficial de Ferro (`FERRO_WHATSAPP_NUMBER`) y un mensaje prellenado que incluya el nombre del programa, la referencia del contrato y un texto de contacto.

La landing se prerenderiza en el build, así que lee solo `FERRO_WHATSAPP_NUMBER` (`getWhatsAppNumber()` en `src/lib/config.ts`) sin exigir los demás secretos; si falta, oculta los enlaces de WhatsApp (DECISIONS A12).

El número oficial ya está disponible y se carga en la variable de entorno de Vercel.

---

## 7. Diseño de API
Los endpoints siguientes son la interfaz interna de la aplicación. Todos validan la entrada con Zod.

### 7.1 Verificación de correo
**`POST /api/verification/request`** — Solicita un código OTP.

Request:
```json
{
  "email": "cliente@email.com"
}
```
Response (siempre la misma, exista o no el correo):
```json
{
  "success": true,
  "message": "Si el correo es válido, recibirás un código."
}
```
- Genera un código de 6 dígitos, guarda su hash, expira en 10 minutos. Solo vale el código más reciente de cada correo.
- Reenvío limitado a uno cada 60 segundos; rate limit por correo (5 códigos por hora) y por IP (20 por hora). Al exceder un límite responde 429 con `retryAfterSeconds` (no revela si el correo existe).
- Si el correo no se puede enviar, responde 502 para que el cliente lo intente de nuevo.

**`POST /api/verification/confirm`** — Valida el código.

Request:
```json
{
  "email": "cliente@email.com",
  "code": "123456"
}
```
Response:
```json
{
  "success": true
}
```
- Máximo 5 intentos por código. Al verificarlo se marca `verifiedAt` y el código queda inutilizable.
- Si es incorrecto responde 400 con `invalid_code` y `remainingAttempts`; si venció, ya se usó o no existe, `code_expired`; con 5 intentos, `too_many_attempts`. Rate limit: 30 intentos por IP y 15 por correo cada 15 minutos.
- Si es correcto, el servidor emite una **sesión de verificación**: una cookie `httpOnly`, `Secure`, `SameSite=Lax`, firmada con `OTP_SESSION_SECRET` (HMAC-SHA256), que contiene el correo verificado y dura 30 minutos. En producción se llama `__Host-hm_verification`.
- Ningún endpoint que cree contratos o muestre datos privados funciona sin esta sesión.

### 7.2 Clientes
**`POST /api/customers`** — Crea al cliente o lo asocia a uno existente. **Requiere la sesión de verificación**; el correo se toma de la sesión, no del body.

Request:
```json
{
  "fullName": "Nombre del cliente",
  "whatsapp": "+52XXXXXXXXXX"
}
```
Response:
```json
{
  "success": true,
  "customerId": "customer_id"
}
```
Si el correo ya existe, se reutiliza el Customer y se actualizan `fullName` y `whatsapp`. No se acepta el campo `country`.

### 7.3 Contratos
**`POST /api/contracts`** — Crea una contratación. Requiere la sesión de verificación, y el `customerId` debe corresponder al correo de la sesión.

Request:
```json
{
  "customerId": "customer_id",
  "programId": "program_id",
  "paymentType": "transfer"
}
```
Response:
```json
{
  "success": true,
  "contractId": "contract_id",
  "reference": "HM-2026-000001",
  "status": "pending_payment"
}
```
El servidor determina el importe a partir del programa guardado y de la modalidad.

**Reglas antes de crear cualquier contrato** (también en `/api/checkout` y `/api/transfers`; DECISIONS A20), dentro de una transacción con el `pg_advisory_xact_lock` del cliente:
1. Vencer los pendientes del cliente con más de 7 días sin actividad.
2. Si el cliente tiene una suscripción en `incomplete`, `active`, `past_due` o `unpaid`, responder `409 subscription_active` (la página ofrece el portal).
3. Si tiene un contrato `pending_payment`:
   - Del mismo programa y modalidad: reutilizarlo (misma referencia), actualizar `lastActivityAt` y, si es transferencia sin enlace vigente, generar uno nuevo y avisar a Ferro.
   - De otro programa o modalidad: responder `409 pending_contract_exists` con el resumen del pendiente (programa, modalidad, importe, referencia) para que la página pregunte "¿continuar o cambiar?". La elección vuelve en el mismo endpoint con `pendingAction: "continue" | "change"`.
   - Con `change`: actualizar ese contrato (programa, modalidad, importe de la BD), invalidar su enlace de transferencia o expirar su Checkout en Stripe, y escribir `contract.pending_changed` en AuditLog.
4. Mes con mes, sin pagos por adelantado (DECISIONS A28): si tiene un mes pagado sin terminar (`scheduled` o `active`, de pago único o transferencia, con `serviceEndDate > now`), responder `409 active_period` con `activeUntil` (fin de ese mes). Se revisa antes que el pendiente. El siguiente mes se paga a partir del día en que termina.

`POST /api/transfers` (y en la Fase 5 `/api/checkout`) responde 201 al crear un contrato y 200 al reutilizar, retomar o cambiar el pendiente, con `outcome` (`created`, `reused`, `continued`, `changed`). Implementado en `contract-request.service` (DECISIONS A25).

**`GET /api/contracts/pending`**: requiere la sesión de verificación. Devuelve el resumen del pendiente del cliente de esa sesión, si existe. Nunca recibe un correo ni una referencia como parámetro.

### 7.4 Checkout
**`POST /api/checkout`** — Crea una sesión de Stripe Checkout. Requiere la sesión de verificación.

Request (igual que `POST /api/transfers` más `mode`; el correo sale de la sesión y el Price y el importe, de la BD; DECISIONS A26):
```json
{
  "fullName": "Nombre del cliente",
  "whatsapp": { "country": "MX", "number": "55 1234 5678" },
  "program": "hm-run",
  "privacyAccepted": true,
  "mode": "payment",
  "pendingAction": "continue"
}
```
Valores permitidos para `mode`: `payment` (Fase 5) y `subscription` (Fase 6). `pendingAction` es opcional.

Response (201 al crear el contrato; 200 al reutilizar, retomar o cambiar el pendiente):
```json
{
  "success": true,
  "clientSecret": "cs_..._secret_...",
  "publishableKey": "pk_...",
  "returnUrl": "https://<dominio>/pago/exito",
  "reference": "HM-2026-000001",
  "status": "pending_payment",
  "outcome": "created"
}
```
El backend valida el programa, su disponibilidad, el Price correspondiente y que su importe coincida con `monthlyPrice` (`payment`) o `subscriptionPrice` (`subscription`), antes de crear el contrato. Aplica las reglas de §7.3, crea o reutiliza el contrato `pending_payment` y guarda `stripeCheckoutSessionId`.
- Un pendiente reutilizado conserva su sesión si sigue abierta y cobra el mismo Price; si venció, se abre otra con la misma referencia. Si ya se completó y Stripe todavía no avisa (pago asíncrono), responde `409 payment_in_progress`.
- "Cambiar" invalida el enlace de transferencia o expira la sesión anterior en Stripe.
- El cliente de Stripe se crea una sola vez y se guarda en `Customer.stripeCustomerId`.
- Respuestas de error: `401` sin sesión; `400` datos inválidos; `409` reglas de §7.3 o `payment_in_progress`; `422 program_unavailable`; `503 payments_unavailable` (sin Stripe, Price ausente o distinto, o error de Stripe). Rate limit: 10 por IP por hora.
- La sesión usa el formulario de pago incrustado (`ui_mode: form`, DECISIONS A29): el navegador lo monta con `stripe.initCheckoutFormSdk` usando `clientSecret` y `publishableKey` (del mismo modo que la clave secreta; si no, 503) y confirma el pago con `returnUrl`. Al pagar, lleva al cliente a `/pago/exito`, que solo informa. No pide el nombre (ya está en el registro) y permite guardar la tarjeta en Stripe.

### 7.5 Webhooks de Stripe
**`POST /api/webhooks/stripe`** — Recibe los eventos de Stripe.

Eventos que se escuchan (una sola fuente de verdad por flujo):

| Flujo | Evento | Acción |
|---|---|---|
| Pago único | `checkout.session.completed` | Si `payment_status = paid`: crear el Payment y el ServicePeriod, y activar el contrato (o `scheduled` si es un pago tardío con un mes vigente). Si es `unpaid` (pago asíncrono), esperar. |
| Pago único | `checkout.session.async_payment_succeeded` | Igual que el anterior con `paid`. |
| Pago único | `checkout.session.async_payment_failed` | Registrar el Payment fallido. El contrato sigue `pending_payment` (nunca se activó) y el cliente puede reintentar; se le avisa (DECISIONS A26, B15). |
| Suscripción | `checkout.session.completed` (modo subscription) | Solo relacionar `stripeSubscriptionId` con el contrato; **no** crea el Payment. |
| Suscripción | `invoice.paid` | **Única fuente de Payments** (primer pago y renovaciones). Crea el Payment y el ServicePeriod con el periodo de la factura y el programa del Price facturado; activa o extiende el contrato. En renovaciones, avisa a Ferro. Una factura de importe 0 no abre un mes. |
| Suscripción | `invoice.payment_failed` | Registrar el Payment fallido, pasar el contrato a `payment_failed` (servicio suspendido) y avisar. |
| Suscripción | `customer.subscription.created` / `updated` / `deleted` | Solo sincronizar Subscription (estado, periodo, `cancelAtPeriodEnd`). |

No se escuchan `payment_intent.succeeded` ni `payment_intent.payment_failed`.

Pasos del procesamiento:
1. Verificar la firma del webhook con `STRIPE_WEBHOOK_SECRET` usando el body crudo (400 si falla; 503 si falta el secreto).
2. Insertar el evento en WebhookEvent (`ON CONFLICT DO NOTHING`) y, en una transacción, bloquear su fila (`FOR UPDATE`); si ya está `processed` o `ignored`, responder 200 sin procesarlo.
3. Recuperar y bloquear el contrato o la suscripción asociada.
4. Actualizar los registros en la misma transacción.
5. Marcar el evento como `processed` (o `ignored` si no es de esta tabla). Si algo falla, se revierte todo, el evento queda `failed` y se responde 500 para que Stripe lo reintente.
6. Después de confirmar, enviar las notificaciones: al cliente, Purchase Confirmation y Welcome (primer pago); a Ferro, Payment Received o Renewal Successful con el botón de entrega.

El Payment guarda el importe que cobró Stripe; si no coincide con el contrato, se respeta y se audita. Un cobro para un contrato que ya estaba pagado se registra sin abrir otro mes y se avisa a Ferro para que lo revise en Stripe (DECISIONS A26).

Si el contrato estaba `expired`, el pago se respeta igual y se audita `contract.paid_after_expiry` (DECISIONS A20).

Los eventos se procesan de forma idempotente y toleran entregas repetidas o fuera de orden. El pago nunca se confirma desde la página de éxito del navegador.

### 7.6 Transferencias
**`POST /api/transfers`** — Crea una transferencia pendiente. Requiere la sesión de verificación.

Request (el correo se toma de la sesión, no del body; el importe sale del programa en la BD):
```json
{
  "fullName": "Nombre del cliente",
  "whatsapp": { "country": "MX", "number": "55 1234 5678" },
  "program": "hm-run",
  "privacyAccepted": true
}
```

Response:
```json
{
  "success": true,
  "reference": "HM-2026-000001",
  "status": "pending_payment"
}
```
En una transacción crea o asocia el Customer (como `POST /api/customers`), crea el contrato `pending_payment`, genera el token de aprobación (solo se guarda su hash) y escribe AuditLog (`transfer.requested`). Después envía el correo Transfer Pending a Ferro con el enlace `${APP_URL}/transfer/confirm/<token>`; si falla, el contrato se conserva y se registra `transfer.notification_failed`. La respuesta también incluye el programa, el importe y el enlace `wa.me` prellenado (RF-10).

Aplica las reglas de §7.3 (un solo pendiente por cliente, vencimiento, suscripción activa, mes vigente). Un doble envío dentro de la misma sesión devuelve el mismo contrato sin reenviar el correo (DECISIONS A16). Rate limit: 10 por IP por hora.

**`GET /transfer/confirm/[token]`** — Página privada para que Ferro revise la transferencia.

- **Solo lectura**: no modifica el contrato ni el token.
- Muestra: cliente, correo, programa, importe, método de pago, referencia y estado actual.
- Incluye un campo de PIN y los botones "Sí, confirmar pago" y "No, regresar". "No, regresar" no envía nada al servidor.
- Encabezados: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`.
- Si el token expiró, ya se usó o fue invalidado, muestra el mensaje correspondiente y la opción de regenerar el enlace.

**`POST /api/transfers/confirm`** — Confirma la transferencia. Es la única acción posible: no existe `reject`.

Request:
```json
{
  "token": "secure_random_token",
  "pin": "******"
}
```
Comportamiento:
1. Calcula el hash del token y busca un TransferApproval válido.
2. Verifica el PIN contra `FERRO_APPROVAL_PIN_HASH`. Si es incorrecto, incrementa `pinAttempts`, escribe la auditoría y responde con error; con 5 errores, invalida el token.
3. Verifica que el contrato siga en `pending_payment` o en `expired` (pago tardío: se respeta y se audita `contract.paid_after_expiry`, DECISIONS A20).
4. En una sola transacción: marca `usedAt` y `approvedBy = "ferro"`, crea el Payment (`method = transfer`, `succeeded`), el ServicePeriod (un mes desde la confirmación) y su PlanDeliveryLink, pasa el contrato a `active` (o `scheduled`) y escribe AuditLog (IP, user-agent).
5. Después de la transacción, envía Transfer Confirmed y Welcome al cliente y Payment Received (con el botón de entrega) a Ferro.

Está protegido contra reenvíos y solicitudes duplicadas: un token usado o un contrato ya activo se rechazan sin efectos.

Cada intento se cuenta (compare-and-set sobre `pinAttempts`) antes de comparar el PIN, así que con solicitudes simultáneas no se prueban más de 5 PIN por enlace; si el PIN es correcto, ese intento se descuenta al aprobar. Rate limit: 20 por IP cada 15 minutos (DECISIONS A23).

Respuestas: `200` con `reference`, `status`, `serviceStartDate` y `serviceEndDate`; `400` datos inválidos (sin token o sin PIN); `403 invalid_pin` con `remainingAttempts`; `404 link_unavailable` (token inexistente); `410 link_unavailable` con `reason` `expired`, `used` o `invalidated` (también al quinto PIN incorrecto); `409 contract_not_pending`; `503` si falta `FERRO_APPROVAL_PIN_HASH`.

**`POST /api/transfers/regenerate`** — Genera un enlace nuevo para un contrato que sigue en `pending_payment` o que venció (`expired`). Requiere el PIN de Ferro y la referencia del contrato (`{ reference, pin }`). Invalida los enlaces anteriores y envía uno nuevo al correo de Ferro; el token nunca viaja en la respuesta. Con un PIN incorrecto responde `403` igual exista o no la referencia. Rate limit: 10 por IP y 30 en total por hora (no hay un enlace que cuente los intentos). Respuestas: `200`, `403 invalid_pin`, `404 not_found`, `409 contract_not_pending`, `502 email_failed` (el enlace se generó pero el correo falló). Se ofrece en la página del enlace cuando está vencido, invalidado o no existe.

### 7.7 Suscripciones y Customer Portal
**`POST /api/portal`**: requiere la sesión de verificación. Busca el `stripeCustomerId` del cliente de esa sesión y responde con la URL de una sesión del Stripe Customer Portal (`return_url` = la landing). Si el cliente no tiene una suscripción, responde lo mismo que si no existiera, sin revelar nada.

En el portal (DECISIONS A21), el cliente puede:
- Cancelar, con efecto al final del periodo.
- Cambiar de programa entre los tres Price recurrentes, sin prorrateo. Aplica en la siguiente renovación.
- Actualizar su tarjeta.

El sistema se entera por `customer.subscription.updated/deleted`: sincroniza Subscription y, al cancelarse, pasa el contrato a `cancelled` y envía Subscription Cancelled al cliente y a Ferro. No hay endpoints propios de cancelación ni de consulta de suscripciones.

### 7.8 Entrega del plan
Solo registra un dato de referencia (DECISIONS A19). Cada ServicePeriod crea su primer PlanDeliveryLink en la misma transacción del pago, y el botón va en el correo Payment Received o Renewal Successful. Cada recordatorio crea otro.

**`GET /plan/entrega/[token]`**: página de **solo lectura**, con los mismos encabezados que `/transfer/confirm/[token]`.
- Muestra el cliente, el programa, la referencia, la fecha de pago y el periodo, un campo de fecha (hoy por defecto) y un botón "Confirmar entrega".
- Si la entrega ya se registró, muestra la fecha registrada.
- Si el token no existe o venció, muestra "Enlace no válido o vencido" y que el siguiente recordatorio traerá un botón nuevo.

**`POST /api/plan-delivery/confirm`**
```json
{ "token": "secure_random_token", "deliveredOn": "2026-11-27" }
```
1. Calcula el hash del token y busca un PlanDeliveryLink vigente.
2. Valida `deliveredOn`: no puede ser futuro (en `America/Mexico_City`) ni anterior al día de `paidAt`.
3. En una transacción con compare-and-set sobre el ServicePeriod (`WHERE planDeliveredOn IS NULL`): guarda `planDeliveredOn` y `deliveryRecordedAt`, marca `usedAt` en el botón usado y escribe `plan.delivered` en AuditLog (IP, user-agent).
4. Responde con la fecha. La página muestra "Fecha de entrega del plan confirmada".

No cambia estados, periodos ni cobros, y no envía correos. Si la entrega ya estaba registrada, responde con la fecha existente sin cambiar nada. Rate limit por IP.

**`GET /api/cron/daily`**: lo llama Vercel Cron una vez al día. Exige `Authorization: Bearer ${CRON_SECRET}`. Ejecuta tareas idempotentes:
- Vencer los pendientes (`pending_payment → expired`).
- Persistir `scheduled → active` y `active → completed`.
- De lunes a viernes: por cada ServicePeriod sin `planDeliveredOn` que tenga `PLAN_DELIVERY_REMINDER_BUSINESS_DAYS` días hábiles o más desde `paidAt` (1 por defecto) y no tenga recordatorio hoy, crear un PlanDeliveryLink nuevo, enviar Plan Delivery Reminder con su botón y actualizar `lastReminderAt`.
- Purgar `rate_limit_buckets`.

Los días hábiles excluyen sábados, domingos y los días de descanso obligatorio de la LFT (art. 74), en `src/utils/business-calendar.ts`. `lastReminderAt` se marca con compare-and-set antes de enviar; si el correo falla, se audita `plan.reminder_failed` y se reintenta el siguiente día hábil. `vercel.json` lo programa a las 14:05 UTC (8:05 en Ciudad de México) (DECISIONS A25).

---

## 8. Flujos técnicos

### 8.1 Verificación de correo (común a todos los flujos)
```
Formulario (nombre, correo, WhatsApp, programa, privacidad)
  |
  v
POST /api/verification/request  -> respuesta idéntica exista o no el correo
  |
  v
Cliente escribe el código
  |
  v
POST /api/verification/confirm  -> cookie de sesión de verificación (30 min)
  |
  v
POST /api/customers             -> crea o asocia el Customer
  |
  v
Selección de método de pago
```

### 8.2 Pago único
```
Sesión verificada
  |
  v
POST /api/checkout (mode=payment)
  |--> Contract (pending_payment)
  v
Stripe Embedded Checkout (payment, en la landing)
  |
  v
Cliente paga
  |
  v
Webhook checkout.session.completed / async_payment_succeeded
  |
  v
Validar firma + idempotencia
  |
  v
[Transacción] Payment(succeeded) + ServicePeriod (1 mes desde el pago) + PlanDeliveryLink + Contract -> active
  |
  +--> Purchase Confirmation + Welcome (cliente)
  +--> Payment Received con botón de entrega (Ferro) -> §8.6
```

### 8.3 Suscripción mensual
```
Sesión verificada
  |
  v
POST /api/checkout (mode=subscription)
  |--> Contract (pending_payment)
  v
Stripe Checkout (subscription)
  |
  +--> checkout.session.completed -> vincular stripeSubscriptionId
  +--> customer.subscription.*    -> sincronizar Subscription
  |
  v
invoice.paid (primera factura)
  |--> Payment(succeeded) + ServicePeriod + PlanDeliveryLink + Contract -> active
  |--> Purchase Confirmation + Welcome (cliente), Payment Received con botón de entrega (Ferro)
  |
Al cumplirse un mes del pago: renovación automática
  |
  +--> invoice.paid
  |       +--> Payment nuevo + ServicePeriod nuevo + PlanDeliveryLink
  |       +--> Extender serviceEndDate
  |       +--> Renewal Successful con botón de entrega (Ferro)
  |
  +--> invoice.payment_failed
          +--> Payment(failed)
          +--> Contract -> payment_failed (servicio suspendido)
          +--> Payment Failed (cliente y Ferro)
          +--> Smart Retries: si se paga -> invoice.paid (arriba)
                              si se agotan -> subscription.deleted -> Contract cancelled
```

### 8.4 Transferencia bancaria y aprobación
```
Sesión verificada
  |
  v
POST /api/transfers
  |--> Contract (pending_payment) + referencia
  |--> Token -> TransferApproval (hash, 7 días)
  |--> Transfer Pending (Ferro, con enlace)
  v
Pantalla de transferencia pendiente
  |--> Botón WhatsApp (programa + referencia)
  v
Cliente transfiere -> Ferro verifica en su banco
  |
  v
Ferro abre el enlace (GET, solo lectura)
  |
  +--> "No, regresar" -> no se envía nada; sigue pending_payment
  |
  +--> PIN + "Sí, confirmar pago"
          |
          v
       POST /api/transfers/confirm { token, pin }
          |
          +--> PIN incorrecto -> pinAttempts++ ; a los 5, se invalida el token
          |
          v
       [Transacción] token usado + Payment + ServicePeriod + PlanDeliveryLink + Contract -> active + AuditLog
          |
          +--> Transfer Confirmed + Welcome (cliente)
          +--> Payment Received con botón de entrega (Ferro)
```

### 8.5 Cancelación de suscripción
```
Cliente -> verificación OTP -> POST /api/portal -> Stripe Customer Portal
  -> cancela (al final del periodo) / cambia de plan / actualiza tarjeta
  -> customer.subscription.updated|deleted -> sincronizar Subscription y Contract
  -> Subscription Cancelled (cliente y Ferro)
```

### 8.6 Entrega del plan (solo referencia)
```
Pago confirmado (cualquier método) -> ServicePeriod + PlanDeliveryLink
  |--> Payment Received / Renewal Successful (Ferro): datos del cliente + botón "Registrar entrega del plan"
  v
Ferro entrega el plan por WhatsApp (3 a 5 días hábiles)
  |
  v
Botón del correo -> GET /plan/entrega/[token] (solo lectura) -> fecha (hoy por defecto) + "Confirmar entrega"
  |
  v
POST /api/plan-delivery/confirm { token, deliveredOn } -> "Fecha de entrega del plan confirmada"

Mientras no se registre: cron de días hábiles -> Plan Delivery Reminder (uno por cliente, con botón nuevo).
Se detiene al registrar la fecha. Nada de esto cambia periodos ni cobros.
```

---

## 9. Seguridad

### 9.1 Variables de entorno
`.env.example`:
```
DATABASE_URL=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

RESEND_API_KEY=
RESEND_FROM_EMAIL=
FERRO_NOTIFICATION_EMAIL=
FERRO_WHATSAPP_NUMBER=

APP_URL=
FERRO_APPROVAL_PIN_HASH=
OTP_SESSION_SECRET=
TRANSFER_LINK_TTL_DAYS=7
PENDING_CONTRACT_TTL_DAYS=7
PLAN_DELIVERY_REMINDER_BUSINESS_DAYS=1
CRON_SECRET=
```
Los valores reales nunca se suben al repositorio. `src/lib/config.ts` valida al iniciar que existan las variables obligatorias.
En producción todas las variables son obligatorias salvo `TRANSFER_LINK_TTL_DAYS` (7 por defecto), `PENDING_CONTRACT_TTL_DAYS` (7 por defecto) y `PLAN_DELIVERY_REMINDER_BUSINESS_DAYS` (1 por defecto); en desarrollo y pruebas son opcionales para poder trabajar sin claves reales (modo desarrollo de cada servicio). Una variable definida siempre se valida en formato. La validación se ejecuta al arrancar el servidor (`src/instrumentation.ts`), no durante `next build` (DECISIONS A9).

### 9.2 Stripe
- Verificar la firma de todos los webhooks.
- No confiar en importes enviados por el frontend.
- Crear las sesiones de Checkout solo desde el backend.
- Usar idempotencia (WebhookEvent y claves de idempotencia en las llamadas a Stripe).
- No guardar información completa de tarjetas.
- Comprobar el estado del pago antes de activar el servicio.

### 9.3 Enlaces privados y PIN de aprobación
El token del enlace de transferencia (TransferApproval):
- Se genera con 32 bytes aleatorios criptográficamente seguros.
- Es único y se guarda solo como hash SHA-256.
- Expira en 7 días (configurable).
- Es de un solo uso y se invalida al confirmar, al regenerar el enlace o tras 5 PIN incorrectos.

El PIN de aprobación:
- Lo conoce solo Ferro: de 6 a 12 dígitos, sin dígitos repetidos ni secuencias. Se guarda solo como hash bcrypt (costo 12) en `FERRO_APPROVAL_PIN_HASH`, generado con `npm run hash-pin` (en los archivos `.env` los `$` van escapados, DECISIONS A23).
- Se compara en tiempo constante (la función de verificación de bcrypt).
- Es un segundo factor: el enlace es lo que Ferro *tiene* (su correo) y el PIN lo que *sabe*. Un enlace reenviado, filtrado o abierto por un escáner de correo no basta para aprobar.

Abrir el enlace es solo lectura; confirmar requiere un POST explícito con el PIN. Los escáneres automáticos de enlaces no pueden aprobar transferencias. Si el enlace expira, el contrato sigue pendiente y se puede regenerar.

El botón de entrega del plan (PlanDeliveryLink) usa el mismo tipo de token (32 bytes, solo el hash, 7 días de vigencia) y deja de servir al registrarse la entrega, pero no pide PIN: solo guarda un dato de referencia. También es solo lectura en el GET y escribe únicamente con un POST explícito, para que los escáneres de correo no registren una fecha falsa.

### 9.4 Verificación de correo
- Códigos de 6 dígitos guardados como hash, 10 minutos de vigencia, máximo 5 intentos, un solo uso.
- La respuesta al pedir un código no revela si el correo existe.
- Rate limit por correo y por IP en la solicitud y en la confirmación, guardado en PostgreSQL (`rate_limit_buckets`, DECISIONS A16).
- El hash del código es un HMAC con una clave del servidor: con solo un millón de códigos posibles, un SHA-256 simple se podría invertir si se filtrara la BD.
- La sesión de verificación es una cookie firmada, `httpOnly`, `Secure`, `SameSite=Lax`, de 30 minutos.

### 9.5 Protección de endpoints
Los endpoints deben validar:
- Los datos de entrada (Zod).
- La identidad y la autorización (sesión de verificación o token + PIN).
- El estado actual del contrato o la suscripción.
- Los límites de intentos en operaciones sensibles.
- Las reglas de negocio antes de modificar registros.

### 9.6 Protección de datos
Se pide y guarda solo la información necesaria para prestar el servicio y procesar la contratación. La política de privacidad y las condiciones de contratación deben estar accesibles desde el formulario y desde el footer. Los registros de auditoría y de errores no deben incluir códigos, tokens ni PIN.

---

## 10. Manejo de errores

| Situación | Comportamiento esperado |
|---|---|
| Datos inválidos | Rechazar la solicitud y devolver los errores de validación |
| Sin sesión de verificación | Rechazar (401) y pedir que se verifique el correo |
| Código OTP incorrecto o expirado | Rechazar, indicar los intentos restantes, permitir reenvío |
| Programa inexistente o inactivo | Rechazar la contratación |
| Importe de Stripe distinto de `monthlyPrice` o `subscriptionPrice` | No crear el Checkout, registrar el error y avisar al usuario |
| Error al crear el Checkout | Informar al usuario y registrar el error |
| Pago fallido | Registrar el fallo y actualizar el estado |
| Webhook duplicado | Ignorar el procesamiento repetido (responder 200) |
| Firma de webhook inválida | Rechazar el evento (400) |
| Token expirado o invalidado | Mostrar que el enlace no es válido, conservar el contrato pendiente y ofrecer regenerarlo |
| Token ya usado | Rechazar una nueva confirmación |
| PIN incorrecto | Rechazar, registrar en auditoría e incrementar intentos; con 5, invalidar el token |
| Contrato ya activo | Evitar una nueva activación |
| Entrega ya registrada | Mostrar la fecha registrada, sin cambios |
| Cliente con suscripción activa intenta contratar | `409 subscription_active`; ofrecer el portal |
| Cliente con otro pendiente | `409 pending_contract_exists`; preguntar si continúa o cambia |
| Cliente con un mes pagado que todavía no termina | `409 active_period` con la fecha en que termina (DECISIONS A28) |
| Pago confirmado de un contrato vencido | Respetar el pago y auditar `contract.paid_after_expiry` |
| Error de correo | Registrar el fallo y permitir un reintento controlado, sin revertir el pago |
| Error de base de datos | Registrar el error sin exponer información sensible |

---

## 11. Despliegue

### 11.1 Entornos
- Desarrollo local.
- Pruebas / staging.
- Producción.

Cada entorno tiene sus propias variables y credenciales (Stripe en modo test fuera de producción).

### 11.2 Despliegue en Vercel
La aplicación se despliega en Vercel conectando el repositorio de GitHub. Se configuran:
- Variables de entorno.
- Dominio.
- Configuración de producción.
- Integración con PostgreSQL.
- Endpoints de webhook de Stripe.
- Cron diario `GET /api/cron/daily` (§7.8), protegido con `CRON_SECRET`.

### 11.3 Migraciones
Prisma Migrate administra los cambios del esquema. Las migraciones se prueban antes de aplicarlas a producción.

### 11.4 Dominio y correo
El dominio se compra en GoDaddy (DECISIONS A17). Sus DNS se apuntan a Vercel y se agregan los registros de Resend (SPF, DKIM) para verificar el remitente.

---

## 12. Pruebas

### 12.1 Pruebas funcionales
- Registro de cliente nuevo y asociación de cliente existente.
- Verificación de correo (código correcto, incorrecto, expirado, reenvío).
- Selección de programa.
- Validación del formulario.
- Creación de pago único.
- Creación de suscripción.
- Renovación automática.
- Registro de pagos exitosos.
- Registro de pagos fallidos.
- Creación de transferencia pendiente.
- Generación de referencia.
- Confirmación manual de transferencia con PIN.
- "No, regresar" no cambia el contrato.
- Enlace expirado y regeneración del enlace.
- Enlace de un solo uso.
- Envío de correos.
- Cancelación y cambio de plan desde el portal (webhooks).
- Transiciones válidas e inválidas de estados del contrato.
- Periodos: un mes desde la fecha de pago, fin de mes en meses cortos, pago tardío con un mes vigente (`scheduled`).
- Registro de la entrega: GET sin efectos, fecha por defecto hoy, fecha futura o anterior al pago rechazada, botón vencido, varios botones del mismo mes, doble registro sin cambios.
- Recordatorios: solo días hábiles, uno por cliente y por día, cada uno con botón nuevo, se detienen al registrar la entrega.
- Transferencia confirmada sobre un contrato vencido (pago tardío).
- Pendiente reutilizado, cambiado y vencido; pago tardío; mes vigente (sin pagos por adelantado); suscripción activa.
- Precio de suscripción con 10 % de descuento.

### 12.2 Pruebas de integración
Interacciones con:
- Stripe Checkout.
- Stripe Billing (con test clocks para renovaciones).
- Stripe Webhooks (con Stripe CLI).
- Resend.
- PostgreSQL.

### 12.3 Pruebas de seguridad
- Webhooks con firma inválida.
- Webhooks duplicados y fuera de orden.
- Tokens expirados, usados o invalidados.
- El GET del botón de entrega no registra nada.
- Cron sin `CRON_SECRET` o con uno incorrecto.
- `GET /api/contracts/pending` y `POST /api/portal` sin sesión o con la sesión de otro correo.
- PIN incorrecto e invalidación tras 5 intentos.
- Intentos de confirmación sin PIN o sin token.
- Crear contratos sin sesión de verificación.
- Enumeración de correos (respuesta idéntica).
- Acceso a información de clientes sin verificación.
- Manipulación de precios desde el frontend.

### 12.4 Pruebas de interfaz
- Diseño responsive.
- Formularios en celular.
- Paso de verificación de código.
- Navegación.
- Botones de contratación.
- Pantalla de pago pendiente.
- Pantalla de confirmación de transferencia.
- Pantalla de entrega del plan y su confirmación.
- Aviso de registro pendiente (continuar o cambiar).
- Mensajes de error y éxito.

---

## 13. Decisiones técnicas pendientes

| # | Decisión | Estado / implicación técnica |
|---|---|---|
| 1 | Proveedor de PostgreSQL | **Definido:** Neon. |
| 2 | Productos y precios de Stripe | **Definido:** Price `one_time` por `monthlyPrice` y `recurring` por `subscriptionPrice` (−10 %). Faltan los Price IDs de producción. |
| 3 | Correo de notificaciones de Ferro | **Definido.** Variable de entorno en Vercel. |
| 4 | Dominio | **Definido:** GoDaddy. Pendiente de compra; afecta DNS, `APP_URL` y Resend. |
| 5 | Remitente de Resend | **Definido.** Se verifica con el dominio. |
| 6 | Periodos de servicio | **Definido:** un mes desde la fecha de pago (ServicePeriod); la entrega del plan es solo referencia (§7.8). |
| 7 | Reintentos y suspensión | **Definido:** Smart Retries; `payment_failed` suspende el servicio; al agotarse, se cancela. |
| 8 | Mecanismo de cancelación | **Definido:** Stripe Customer Portal con OTP (§7.7). |
| 9 | Nuevas contrataciones con un periodo vigente | **Definido** en §7.3. |
| 10 | WhatsApp oficial de Ferro | **Definido.** Variable de entorno en Vercel. |
| 11 | Expiración y regeneración de enlaces privados | **Definido:** 7 días, un solo uso, invalidación tras 5 PIN incorrectos, regenerable. |
| 12 | Política de privacidad y condiciones | Borrador publicado (DECISIONS A22). Faltan los datos del responsable y la revisión legal. |

### 13.1 Decisiones ya establecidas
- Arquitectura Next.js + TypeScript.
- PostgreSQL como motor de base de datos.
- Prisma como ORM.
- Stripe para pagos y suscripciones.
- Resend para correos.
- Vercel para hosting.
- Servicio contratado por periodos de un mes desde la fecha de pago.
- Renovación automática mensual de las suscripciones.
- Suscripción con 10 % de descuento sobre el precio del programa.
- Verificación de correo por OTP obligatoria antes de cualquier contratación.
- Transferencias confirmadas manualmente por Ferro con enlace + PIN; sin acción de rechazo.
- Estados del contrato sin `paid`.
- `invoice.paid` como única fuente de pagos de suscripción.
- Comunicación deportiva por WhatsApp.
- Sin cuentas tradicionales ni dashboard de atletas.
- Sin aprobación de clientes.
- Sin entrega de planes de entrenamiento desde la web.
- Sin módulo automatizado de reembolsos en el MVP.

---

## 14. Consideraciones de escalabilidad y mantenimiento
La arquitectura debe permitir agregar funcionalidades futuras sin alterar el flujo principal de contratación.

Posibles extensiones futuras (fuera del MVP):
- Panel administrativo.
- Historial de contrataciones para clientes.
- Automatización de WhatsApp.
- Gestión avanzada de reembolsos.
- Gestión de programas y precios desde un panel.
- Reportes de ventas y suscripciones.

---

## 15. Glosario técnico

| Término | Definición |
|---|---|
| API | Interfaz que permite la comunicación entre componentes. |
| ORM | Herramienta para interactuar con la base de datos mediante objetos. |
| Webhook | Evento que un servicio externo envía a un endpoint. |
| Checkout Session | Sesión de pago alojada por Stripe. |
| Payment Intent | Objeto de Stripe que representa un intento de pago. |
| Price | Objeto de Stripe con el importe y el tipo de cobro (único o recurrente). |
| Subscription | Objeto que representa una suscripción recurrente. |
| Idempotencia | Protección que evita ejecutar varias veces la misma operación. |
| OTP | Código temporal de verificación. |
| Sesión de verificación | Cookie firmada que demuestra que el correo se verificó recientemente. |
| PIN de aprobación | Secreto de Ferro que se necesita, junto con el enlace, para confirmar transferencias. |
| Token | Cadena segura que autoriza una operación específica. |
| Migration | Cambio versionado del esquema de la base de datos. |

---

*Fin del documento — SDD v1.3*
