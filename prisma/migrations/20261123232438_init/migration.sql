-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('pending_payment', 'active', 'completed', 'payment_failed', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('transfer', 'one_time', 'subscription');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('transfer', 'stripe_one_time', 'stripe_subscription');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('incomplete', 'active', 'past_due', 'canceled', 'unpaid');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('received', 'processed', 'failed', 'ignored');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "monthlyPrice" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'MXN',
    "stripePriceIdOneTime" TEXT,
    "stripePriceIdRecurring" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "paymentType" "PaymentType" NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'pending_payment',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "stripeCheckoutSessionId" TEXT,
    "serviceStartDate" TIMESTAMP(3),
    "serviceEndDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "subscriptionId" UUID,
    "method" "PaymentMethod" NOT NULL,
    "stripePaymentIntentId" TEXT,
    "stripeInvoiceId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_approvals" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "pinAttempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_verifications" (
    "id" UUID NOT NULL,
    "customerId" UUID,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'received',
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_stripeCustomerId_key" ON "customers"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "programs_slug_key" ON "programs"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "programs_stripePriceIdOneTime_key" ON "programs"("stripePriceIdOneTime");

-- CreateIndex
CREATE UNIQUE INDEX "programs_stripePriceIdRecurring_key" ON "programs"("stripePriceIdRecurring");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_reference_key" ON "contracts"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_stripeCheckoutSessionId_key" ON "contracts"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "contracts_customerId_idx" ON "contracts"("customerId");

-- CreateIndex
CREATE INDEX "contracts_programId_idx" ON "contracts"("programId");

-- CreateIndex
CREATE INDEX "contracts_status_serviceEndDate_idx" ON "contracts"("status", "serviceEndDate");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripePaymentIntentId_key" ON "payments"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripeInvoiceId_key" ON "payments"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "payments_contractId_idx" ON "payments"("contractId");

-- CreateIndex
CREATE INDEX "payments_subscriptionId_idx" ON "payments"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_contractId_key" ON "subscriptions"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_customerId_idx" ON "subscriptions"("customerId");

-- CreateIndex
CREATE INDEX "subscriptions_programId_idx" ON "subscriptions"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_approvals_tokenHash_key" ON "transfer_approvals"("tokenHash");

-- CreateIndex
CREATE INDEX "transfer_approvals_contractId_idx" ON "transfer_approvals"("contractId");

-- CreateIndex
CREATE INDEX "otp_verifications_email_createdAt_idx" ON "otp_verifications"("email", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_stripeEventId_key" ON "webhook_events"("stripeEventId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_approvals" ADD CONSTRAINT "transfer_approvals_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_verifications" ADD CONSTRAINT "otp_verifications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Restricciones que Prisma no expresa (SDD §5.4, RNF-07) ─────────────────

-- Secuencia para el consecutivo de `Contract.reference` (HM-AAAA-NNNNNN). `nextval` es atómico,
-- así que dos contratos creados a la vez nunca reciben el mismo número (DECISIONS A14).
CREATE SEQUENCE "contract_reference_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

-- Correo siempre normalizado (minúsculas, sin espacios): evita duplicados por mayúsculas.
ALTER TABLE "customers" ADD CONSTRAINT "customers_email_normalized_check"
  CHECK ("email" = lower("email") AND "email" !~ '\s' AND "email" LIKE '%_@_%');

ALTER TABLE "programs" ADD CONSTRAINT "programs_monthlyPrice_positive_check"
  CHECK ("monthlyPrice" > 0);
ALTER TABLE "programs" ADD CONSTRAINT "programs_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_reference_format_check"
  CHECK ("reference" ~ '^HM-[0-9]{4}-[0-9]{6,}$');
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_amount_positive_check"
  CHECK ("amount" > 0);
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');
-- Un contrato activo o terminado siempre tiene su periodo de servicio (DECISIONS A3).
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_service_period_check"
  CHECK (
    ("serviceStartDate" IS NULL AND "serviceEndDate" IS NULL)
    OR ("serviceStartDate" IS NOT NULL AND "serviceEndDate" IS NOT NULL
        AND "serviceEndDate" > "serviceStartDate")
  );
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_active_has_period_check"
  CHECK ("status" IN ('pending_payment') OR "serviceStartDate" IS NOT NULL);

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive_check"
  CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "transfer_approvals" ADD CONSTRAINT "transfer_approvals_pinAttempts_check"
  CHECK ("pinAttempts" BETWEEN 0 AND 5);
ALTER TABLE "otp_verifications" ADD CONSTRAINT "otp_verifications_attempts_check"
  CHECK ("attempts" BETWEEN 0 AND 5);
ALTER TABLE "otp_verifications" ADD CONSTRAINT "otp_verifications_email_normalized_check"
  CHECK ("email" = lower("email") AND "email" !~ '\s');
