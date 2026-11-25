# THE HYBRID METHOD · by Ferro Fits

Landing page y plataforma básica de contratación y pagos para THE HYBRID METHOD, servicio de
entrenamiento personalizado de fuerza, running y rendimiento híbrido.

- Requisitos: [`docs/SRS.md`](docs/SRS.md) · Diseño técnico: [`docs/SDD.md`](docs/SDD.md)
- Plan por fases: [`docs/PLAN.md`](docs/PLAN.md) · Decisiones: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Stack

Next.js 16 (App Router, Route Handlers) · React 19 · TypeScript estricto · Tailwind CSS v4 · Zod ·
Vitest · PostgreSQL (Neon) + Prisma 7. En fases posteriores: Stripe, Resend y despliegue en Vercel.

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

Antes de abrir un PR: `npm run lint`, `npm run typecheck` y `npm test` sin errores. La CI
(`.github/workflows/ci.yml`) ejecuta además `format:check` y `build` en cada PR.

## Estructura

Sigue la sección 4 del SDD:

```
prisma/              Esquema, seed y migraciones
public/              images/, logos/, fonts/
scripts/             Scripts de soporte (hash-pin)
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
