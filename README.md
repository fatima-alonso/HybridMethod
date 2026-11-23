# THE HYBRID METHOD · by Ferro Fits

Landing page y plataforma básica de contratación y pagos para THE HYBRID METHOD, servicio de
entrenamiento personalizado de fuerza, running y rendimiento híbrido.

- Requisitos: [`docs/SRS.md`](docs/SRS.md) · Diseño técnico: [`docs/SDD.md`](docs/SDD.md)
- Plan por fases: [`docs/PLAN.md`](docs/PLAN.md) · Decisiones: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Stack

Next.js 16 (App Router, Route Handlers) · React 19 · TypeScript estricto · Tailwind CSS v4 · Zod ·
Vitest. En fases posteriores: PostgreSQL (Neon) + Prisma, Stripe, Resend y despliegue en Vercel.

## Requisitos previos

- Node.js 22 o superior (ver `.nvmrc`) y npm.

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

En desarrollo **todas las variables de entorno son opcionales**: sin claves reales, cada servicio
externo funciona en modo desarrollo (p. ej. los correos se registran en consola si falta
`RESEND_API_KEY`). Si defines una variable, se valida su formato. En producción
(`NODE_ENV=production`, incluido `npm start` y los previews de Vercel) todas son obligatorias salvo
`TRANSFER_LINK_TTL_DAYS`, y el servidor no arranca si falta alguna. Detalle en
[`src/lib/config.ts`](src/lib/config.ts) y en DECISIONS A9.

## Scripts

| Script                 | Qué hace                                                   |
| ---------------------- | ---------------------------------------------------------- |
| `npm run dev`          | Servidor de desarrollo.                                    |
| `npm run build`        | Build de producción (no necesita variables de entorno).    |
| `npm start`            | Sirve el build (exige todas las variables de producción).  |
| `npm run lint`         | ESLint (reglas de Next.js + Prettier).                     |
| `npm run typecheck`    | Genera los tipos de rutas de Next.js y ejecuta `tsc`.      |
| `npm test`             | Pruebas con Vitest (una sola pasada).                      |
| `npm run test:watch`   | Vitest en modo observación.                                |
| `npm run format`       | Formatea el código con Prettier.                           |
| `npm run format:check` | Comprueba el formato (lo ejecuta la CI).                   |

Antes de abrir un PR: `npm run lint`, `npm run typecheck` y `npm test` sin errores. La CI
(`.github/workflows/ci.yml`) ejecuta además `format:check` y `build` en cada PR.

## Estructura

Sigue la sección 4 del SDD:

```
prisma/              Esquema, seed y migraciones (Fase 2)
public/              images/, logos/, fonts/
scripts/             Scripts de soporte (p. ej. hash-pin, Fase 4)
src/app/             Páginas (App Router) y Route Handlers en src/app/api/
src/components/      UI: layout, landing, programs, forms, checkout, shared
src/lib/             Configuración e integraciones (config.ts, prisma, stripe, resend…)
src/services/        Lógica de negocio; único lugar donde cambian contratos, pagos y suscripciones
src/types/           Tipos compartidos
src/utils/           Utilidades puras
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
