-- Fase 4, parte 2 (DECISIONS A18–A20, SDD §5.3): precio con suscripción, periodos de servicio,
-- botones de entrega del plan y un solo contrato pendiente por cliente.

-- ─── Program.subscriptionPrice (A18) ────────────────────────────────────────
-- Se llena con monthlyPrice − 10 % redondeado a centavos; el seed lo vuelve a escribir desde el
-- catálogo, que es la fuente del importe exacto.
ALTER TABLE "programs" ADD COLUMN "subscriptionPrice" DECIMAL(10,2);
UPDATE "programs" SET "subscriptionPrice" = round("monthlyPrice" * 0.90, 2);
ALTER TABLE "programs" ALTER COLUMN "subscriptionPrice" SET NOT NULL;
ALTER TABLE "programs" ADD CONSTRAINT "programs_subscriptionPrice_check"
  CHECK ("subscriptionPrice" > 0 AND "subscriptionPrice" <= "monthlyPrice");

-- ─── Contract.lastActivityAt (A20) ──────────────────────────────────────────
ALTER TABLE "contracts" ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "contracts" SET "lastActivityAt" = "createdAt";

-- Un contrato sin pagar (pendiente o vencido) no tiene periodo; los demás sí.
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_active_has_period_check";
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_active_has_period_check"
  CHECK ("status" IN ('pending_payment', 'expired') OR "serviceStartDate" IS NOT NULL);

-- Un solo contrato pendiente por cliente (A20). Si una BD ya tenía varios pendientes del mismo
-- cliente (antes no había esta regla), se conserva el más reciente y los demás vencen.
UPDATE "contracts" c SET "status" = 'expired'
WHERE c."status" = 'pending_payment'
  AND EXISTS (SELECT 1 FROM "contracts" newer
              WHERE newer."customerId" = c."customerId" AND newer."status" = 'pending_payment'
                AND (newer."createdAt", newer."id") > (c."createdAt", c."id"));
CREATE UNIQUE INDEX "contracts_one_pending_per_customer_key" ON "contracts"("customerId")
  WHERE "status" = 'pending_payment';

-- ─── ServicePeriod (A19) ────────────────────────────────────────────────────
CREATE TABLE "service_periods" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "planDeliveredOn" DATE,
    "deliveryRecordedAt" TIMESTAMP(3),
    "lastReminderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_periods_pkey" PRIMARY KEY ("id")
);

-- ─── PlanDeliveryLink (A19) ─────────────────────────────────────────────────
CREATE TABLE "plan_delivery_links" (
    "id" UUID NOT NULL,
    "servicePeriodId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_delivery_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_periods_paymentId_key" ON "service_periods"("paymentId");
CREATE INDEX "service_periods_programId_idx" ON "service_periods"("programId");
CREATE INDEX "service_periods_planDeliveredOn_paidAt_idx" ON "service_periods"("planDeliveredOn", "paidAt");
CREATE UNIQUE INDEX "service_periods_contractId_sequence_key" ON "service_periods"("contractId", "sequence");
CREATE UNIQUE INDEX "plan_delivery_links_tokenHash_key" ON "plan_delivery_links"("tokenHash");
CREATE INDEX "plan_delivery_links_servicePeriodId_idx" ON "plan_delivery_links"("servicePeriodId");

ALTER TABLE "service_periods" ADD CONSTRAINT "service_periods_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_periods" ADD CONSTRAINT "service_periods_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_periods" ADD CONSTRAINT "service_periods_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plan_delivery_links" ADD CONSTRAINT "plan_delivery_links_servicePeriodId_fkey" FOREIGN KEY ("servicePeriodId") REFERENCES "service_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_periods" ADD CONSTRAINT "service_periods_dates_check"
  CHECK ("endDate" > "startDate" AND "sequence" >= 1);
-- La entrega no puede ser anterior al día del pago (en la zona del negocio). Las fechas se guardan
-- en UTC sin zona.
ALTER TABLE "service_periods" ADD CONSTRAINT "service_periods_delivery_after_payment_check"
  CHECK (
    "planDeliveredOn" IS NULL
    OR "planDeliveredOn" >= (("paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Mexico_City')::date
  );

-- Meses de contratos ya pagados antes de esta migración (transferencias confirmadas en la parte 1
-- de la Fase 4): un ServicePeriod por cada pago exitoso, con el periodo del contrato.
INSERT INTO "service_periods"
  ("id", "contractId", "paymentId", "programId", "sequence", "paidAt", "startDate", "endDate", "updatedAt")
SELECT gen_random_uuid(), c."id", p."id", c."programId", 1, p."paidAt", c."serviceStartDate",
       c."serviceEndDate", CURRENT_TIMESTAMP
FROM "contracts" c
JOIN "payments" p ON p."contractId" = c."id" AND p."status" = 'succeeded' AND p."paidAt" IS NOT NULL
WHERE c."serviceStartDate" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "payments" p2
                  WHERE p2."contractId" = c."id" AND p2."status" = 'succeeded' AND p2."id" <> p."id");
