# Decisiones — THE HYBRID METHOD

Registro de decisiones y temas pendientes. Las decisiones A1–A8 ya están integradas en
**SRS v1.4** y **SDD v1.3**; este archivo conserva el porqué de cada una. Cuando se tome una
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
