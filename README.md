# THE HYBRID METHOD · by Ferro Fits

Landing page y plataforma básica de contratación y pagos para THE HYBRID METHOD, servicio de
entrenamiento personalizado de fuerza, running y rendimiento híbrido.

- Requisitos: [`docs/SRS.md`](docs/SRS.md) · Diseño técnico: [`docs/SDD.md`](docs/SDD.md)
- Plan por fases: [`docs/PLAN.md`](docs/PLAN.md) · Decisiones: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Stack

Next.js 16 (App Router, Route Handlers) · React 19 · TypeScript estricto · Tailwind CSS v4 · Zod ·
Vitest · PostgreSQL (Neon) + Prisma 7 · Stripe (Checkout, Billing y webhooks) · Resend. Despliegue en Vercel (Fase 8).

## Requisitos previos

- Node.js 22 o superior (ver `.nvmrc`) y npm.
- PostgreSQL 16 (opcional en desarrollo: sin `DATABASE_URL` la landing usa el catálogo del código).

## Arranque en local

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

La app queda en <http://localhost:3000>.

### Base de datos

`npm install` genera el cliente de Prisma en `src/generated/prisma` (ignorado en git). Con
`DATABASE_URL` en `.env.local`:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

`db:migrate` aplica las migraciones (y crea nuevas si cambias `prisma/schema.prisma`); `db:seed` copia
los programas de `src/content/programs.ts` a la BD y se puede repetir sin duplicar nada. En staging y
producción se usa `npm run db:deploy` (solo aplica migraciones). Detalle en DECISIONS A14.

### Pruebas de base de datos

Las pruebas `*.db.test.ts` usan una BD real de PostgreSQL **que se borra en cada ejecución**. Se
activan con `TEST_DATABASE_URL` (el nombre de la BD debe contener `test`); si no está definida se
omiten. Ejemplo:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hm_test npm test
```

En desarrollo **todas las variables de entorno son opcionales**: sin claves reales, cada servicio
externo funciona en modo desarrollo (p. ej. los correos se registran en consola si falta
`RESEND_API_KEY`). Si defines una variable, se valida su formato. En producción
(`NODE_ENV=production`, incluido `npm start` y los previews de Vercel) todas son obligatorias salvo
`TRANSFER_LINK_TTL_DAYS`, y el servidor no arranca si falta alguna. Detalle en
[`src/lib/config.ts`](src/lib/config.ts) y en DECISIONS A9.

Para probar el flujo de contratación (Fase 3) en local hace falta `DATABASE_URL` con las migraciones y el
seed aplicados. Sin `RESEND_API_KEY`, el código de verificación aparece en la terminal de `npm run dev`
(`[email:dev] … Tu código: 123456`), igual que el correo Transfer Pending con el enlace para Ferro.

### Pagos con Stripe (Fase 5)

Sin `STRIPE_SECRET_KEY` el pago con tarjeta responde "no disponible" y la transferencia sigue
funcionando. Para probarlo en local con tu cuenta de Stripe **en modo de prueba**:

1. En el Dashboard de Stripe (modo de prueba), copia la clave secreta `sk_test_…` y la publicable
   `pk_test_…` a `STRIPE_SECRET_KEY` y `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` en `.env.local`.
2. Crea los productos y precios de los tres programas y guarda sus IDs en la BD (después de
   `npm run db:seed`; se puede repetir, y hay que repetirlo cada vez que cambie un precio):

   ```bash
   npm run stripe:sync
   ```

3. Instala la [Stripe CLI](https://docs.stripe.com/stripe-cli) e inicia sesión en la cuenta de
   THE HYBRID METHOD:

   ```bash
   stripe login
   ```

4. Con `npm run dev` corriendo, en **otra terminal** reenvía los webhooks a tu app y déjala abierta:

   ```bash
   npm run stripe:listen
   ```

   Usa la clave de `.env.local`, escucha solo los eventos que procesa la app y escribe en
   `STRIPE_WEBHOOK_SECRET` el `whsec_…` de esa ejecución (cada ejecución puede dar uno nuevo).
   `npm run dev` lo toma solo, sin reiniciar. Si la app corre en otro puerto:
   `npm run stripe:listen -- --port 3001`.

5. Haz una inscripción en la landing y elige "Pago único con tarjeta": el formulario de pago de Stripe
   aparece ahí mismo, con el diseño de la marca (DECISIONS A29). Paga con la tarjeta de prueba
   `4242 4242 4242 4242` (cualquier fecha futura y cualquier CVC). En la terminal de
   `stripe:listen` debe salir `<-- [200] POST …/api/webhooks/stripe`; el webhook activa el contrato y
   se envían los correos (Purchase Confirmation, Welcome y Payment Received con el botón de
   entrega).

Si sale `[400]`, la app no tiene el mismo `whsec_`: reinicia `npm run dev`. Si sale "connection
refused", `npm run dev` no está corriendo o usa otro puerto.

Pruebas útiles con la CLI: reenviar un evento (`stripe events resend evt_… --api-key <sk_test_…>`, con
el ID de la línea `-->` de `stripe:listen`) debe responder
`duplicate` sin duplicar nada, y un pago con la tarjeta `4000 0000 0000 0002` se rechaza en el formulario
sin tocar el contrato (`4000 0025 0000 3155` pide 3D Secure). Las dos claves (`sk_…` y `pk_…`) deben ser del mismo modo; si no, el pago
con tarjeta aparece como no disponible. Para producción (Fase 8): un endpoint de webhook en el Dashboard apuntando a
`https://<dominio>/api/webhooks/stripe` con los ocho eventos de `STRIPE_WEBHOOK_EVENTS`
(`src/lib/stripe-constants.ts`: los tres de `checkout.session.*`, `invoice.paid`, `invoice.payment_failed` y
`customer.subscription.created/updated/deleted`), y `npm run stripe:sync -- --live` con la clave live. Detalle en
DECISIONS A26 y A31.

### Suscripción mensual (Fase 6)

Con lo anterior funcionando, elige "Suscripción mensual con tarjeta" y paga con `4242 4242 4242 4242`. En
`stripe:listen` deben salir `checkout.session.completed`, `customer.subscription.created` e `invoice.paid` con `[200]`;
el contrato queda `active` con el periodo de la factura y llegan los mismos correos que en el pago único.

**Configuración en el Dashboard de Stripe (modo de prueba y live)** — Billing → Revenue recovery → Retries
(DECISIONS A32: tres intentos en tres días seguidos):

- **Sin Smart Retries**: programación personalizada con **2 reintentos, 1 día después del intento anterior**.
- Si todos los reintentos fallan: **cancelar la suscripción** (no dejarla `unpaid` ni vencida). La app también la
  cancela al recibir el último intento fallido, y el contrato pasa a `cancelled`.
- Opcional: los correos de Stripe sobre pagos fallidos (la app ya avisa al cliente y a Ferro en el primer fallo).

**Renovaciones y pagos fallidos con test clocks** (`npm run stripe:test-clock`, solo con claves de prueba). Un test
clock es un reloj simulado de Stripe: al adelantarlo, Stripe hace las renovaciones, cobros, reintentos y cancelaciones
de ese lapso y manda sus webhooks. Solo mueve clientes creados dentro de él, así que el script crea en Stripe un
cliente y una suscripción dentro de un reloj y los liga a un contrato pendiente hecho en la landing. Con `npm run dev`
y `npm run stripe:listen` corriendo:

1. En la landing, inscríbete con "Suscripción mensual con tarjeta" y **no pagues**. Anota la referencia
   (`HM-2026-…`).
2. Crea el reloj, el cliente (con una tarjeta que paga) y la suscripción. Llega `invoice.paid` y el contrato queda
   `active`:

   ```bash
   npm run stripe:test-clock -- start HM-2026-000123
   ```

3. Renovación exitosa (mes 2, correos de renovación):

   ```bash
   npm run stripe:test-clock -- renew
   ```

4. Tres días de fallos (DECISIONS A32): cambia a una tarjeta que falla, adelanta a la renovación (día 1: contrato
   `payment_failed` y avisos) y luego un día dos veces (día 2: otro intento; día 3: contrato `cancelled`):

   ```bash
   npm run stripe:test-clock -- fail-card
   npm run stripe:test-clock -- renew
   npm run stripe:test-clock -- day
   npm run stripe:test-clock -- day
   ```

   Para probar que se reactiva, después del día 1 corre `ok-card` y luego `day`.

5. En cualquier momento, `npm run stripe:test-clock -- status` muestra el reloj, la suscripción y la última factura en
   Stripe, y el contrato, los pagos y los meses en la BD. Al terminar, `npm run stripe:test-clock -- end` borra el
   reloj en Stripe (el contrato se queda en la BD). Solo hay un reloj en curso a la vez; sus IDs se guardan en
   `.stripe-test-clock.json` (no se sube al repositorio).

Las pruebas automáticas (`src/app/api/__tests__/phase6-flow.db.test.ts`) simulan lo mismo con un Stripe en memoria.

### Portal y cancelación (Fase 7)

El cliente entra a **"Administrar mi suscripción"** (`/suscripcion`, enlazada en el pie de página y en los correos de
la suscripción), verifica su correo con un código y la app le abre el **Stripe Customer Portal**
(`POST /api/portal`). Ahí cancela, cambia de programa o actualiza su tarjeta; la app se entera por
`customer.subscription.updated/deleted` y avisa al cliente y a Ferro (DECISIONS A33).

**Configuración del Customer Portal en el Dashboard de Stripe (modo de prueba y live)** — Settings → Billing →
Customer portal (DECISIONS A21):

- **Cancelar suscripciones**: activado, **al final del periodo de facturación** (no de inmediato). Opcional: pedir
  el motivo.
- **Cambiar de plan**: activado, con los **tres Prices recurrentes** (`hm-run_recurring`, `hm-strength_recurring`,
  `hm-complete_recurring`, los que crea `npm run stripe:sync`) y **sin prorrateo** ("No prorrateo"): el cambio se
  cobra en la siguiente renovación. Si `stripe:sync` crea un Price nuevo porque cambió un precio, cámbialo también aquí.
- **Actualizar el método de pago**: activado.
- Facturas y datos de facturación: opcional. Enlace de regreso: lo manda la app (la landing).
- Si un día hay varias configuraciones del portal, la app usa la predeterminada.

**Prueba en local.** Con una suscripción activa (ver arriba), entra a `http://localhost:3000/suscripcion`, verifica
el correo (el código sale en la consola) y en el portal:

1. **Cancela**: en `stripe:listen` sale `customer.subscription.updated` y en la consola los correos "Tu suscripción
   terminará el …" (cliente) y "Cancelación programada" (Ferro). El contrato sigue `active`.
2. **Renueva la suscripción** (deshacer la cancelación): "Tu suscripción sigue activa" y "Cancelación deshecha".
3. **Cambia de programa**: "Cambiaste a …" y "Cambio de programa"; el mes nuevo se cobra con ese programa en la
   siguiente renovación (con test clocks: `npm run stripe:test-clock -- renew`).
4. Con la cancelación programada y un test clock, adelanta al fin del periodo (`renew`): llega
   `customer.subscription.deleted`, el contrato pasa a `cancelled` y salen "Tu suscripción terminó" y "Suscripción
   terminada".

Las pruebas automáticas están en `src/app/api/__tests__/phase7-flow.db.test.ts`.

## Scripts

| Script                 | Qué hace                                                   |
| ---------------------- | ---------------------------------------------------------- |
| `npm run dev`          | Servidor de desarrollo.                                    |
| `npm run build`        | Build de producción (no necesita variables de entorno).    |
| `npm start`            | Sirve el build (exige todas las variables de producción).  |
| `npm run db:migrate`   | Aplica y crea migraciones en desarrollo (`prisma migrate dev`). |
| `npm run db:deploy`    | Aplica migraciones pendientes (staging/producción).        |
| `npm run db:seed`      | Copia el catálogo de programas a la BD (idempotente).      |
| `npm run db:studio`    | Abre Prisma Studio.                                        |
| `npm run test:db`      | Solo las pruebas de BD (requiere `TEST_DATABASE_URL`).     |
| `npm run lint`         | ESLint (reglas de Next.js + Prettier).                     |
| `npm run typecheck`    | Genera los tipos de rutas de Next.js y ejecuta `tsc`.      |
| `npm test`             | Pruebas con Vitest (una sola pasada).                      |
| `npm run test:watch`   | Vitest en modo observación.                                |
| `npm run format`       | Formatea el código con Prettier.                           |
| `npm run format:check` | Comprueba el formato (lo ejecuta la CI).                   |
| `npm run hash-pin`     | Genera `FERRO_APPROVAL_PIN_HASH` a partir del PIN de Ferro. |
| `npm run stripe:sync`  | Crea o actualiza en Stripe los productos y precios y guarda sus IDs. |
| `npm run stripe:listen` | Reenvía los webhooks de Stripe a la app local y guarda su `whsec_`. |
| `npm run stripe:test-clock` | Prueba renovaciones y pagos fallidos de la suscripción con un test clock. |

Antes de abrir un PR: `npm run lint`, `npm run typecheck` y `npm test` sin errores. La CI
(`.github/workflows/ci.yml`) ejecuta además `format:check` y `build` en cada PR.

## Estructura

Sigue la sección 4 del SDD:

```
prisma/              Esquema, seed y migraciones
public/              images/, logos/, fonts/
scripts/             Scripts de soporte (hash-pin, stripe-sync, stripe-listen, stripe-test-clock)
src/app/             Páginas (App Router) y Route Handlers en src/app/api/
src/components/      UI: layout, landing, programs, forms, checkout, shared, legal
src/content/         Catálogo de programas (precios) y textos de la landing
src/lib/             Configuración e integraciones (config.ts, prisma, stripe, resend…)
src/services/        Lógica de negocio; único lugar donde cambian contratos, pagos y suscripciones
src/types/           Tipos compartidos
src/utils/           Utilidades puras
```

## Contenido de la landing (para la marca)

- **Programas y precios:** [`src/content/programs.ts`](src/content/programs.ts). Es la única fuente
  de precios en el código (decimales en texto, nunca números con coma flotante). La landing muestra
  los de la BD: después de cambiar un precio aquí hay que ejecutar `npm run db:seed` (DECISIONS A14).
- **Textos:** [`src/content/landing.ts`](src/content/landing.ts). Lo marcado como `PLACEHOLDER`,
  `[Texto de relleno]` o `[Pendiente]` debe reemplazarse o aprobarse antes del lanzamiento.
- **Imágenes:** aparecen como bloques "Imagen pendiente". Para reemplazarlas, sube las fotos a
  `public/images/` y cambia cada `ImagePlaceholder` por `next/image` con su `alt`.
- **Logotipo:** versiones transparentes en `public/logos/` (horizontal en el header, apilado en el
  footer) y favicon en `src/app/` (`icon.png`, `apple-icon.png`, `favicon.ico`). Los originales están
  en `docs/brand/`. Si la marca entrega el logo en SVG o en mayor resolución, se reemplazan esos
  archivos (el componente es `src/components/shared/Logo.tsx`).
- **WhatsApp:** el botón flotante y el contacto usan `FERRO_WHATSAPP_NUMBER`. Si no está definido,
  no se muestran. Como la landing es estática, cambiar el número requiere volver a desplegar.

## Confirmación de transferencias (Ferro)

Ferro confirma cada transferencia con el enlace privado que le llega por correo y su **PIN de
aprobación** (DECISIONS A7, A23). Para configurar el PIN:

1. Ejecuta `npm run hash-pin` y escribe el PIN (de 6 a 12 dígitos; se piden dos veces y no se
   muestran). El PIN nunca se guarda.
2. Copia la línea `FERRO_APPROVAL_PIN_HASH=\$2b\$12\$…` en `.env.local`. Los `$` van escapados con
   `\` porque Next.js los expande en los archivos `.env`. En Vercel se pega el valor sin escapar,
   tal como lo imprime el script.

Si el enlace vence (7 días) o se desactiva tras 5 PIN incorrectos, la misma página permite generar uno
nuevo con la referencia del contrato y el PIN. Sin `FERRO_APPROVAL_PIN_HASH`, la confirmación responde
que no está configurada: no existe un PIN por defecto.

## Entrega del plan y cron diario

Cada pago confirmado abre un mes (ServicePeriod) y el correo "Pago registrado" a Ferro trae el botón
**Registrar entrega del plan**. La fecha es solo de referencia (DECISIONS A19, A25).

`GET /api/cron/daily` vence pendientes, inicia y termina meses, envía los recordatorios de entrega (días
hábiles, sin festivos) y purga el rate limit. En Vercel lo llama Vercel Cron (`vercel.json`). En local, con
`CRON_SECRET` en `.env.local`:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily
```

## Identidad visual

Definida como tokens de Tailwind en [`src/app/globals.css`](src/app/globals.css):

| Token          | Color     | Uso                        |
| -------------- | --------- | -------------------------- |
| `ink`          | `#111111` | Fondo principal (≈70 %)    |
| `bone`         | `#F5F3EE` | Texto y superficies (≈20 %) |
| `volt`         | `#FF6A00` | Acentos y CTA (≈10 %)      |
| `font-display` | Barlow Condensed | Encabezados         |
| `font-sans`    | Inter     | Cuerpo                     |

Ejemplo: `<h2 className="font-display text-volt">`. No usar texto `volt` sobre fondo `bone`
(contraste insuficiente).
