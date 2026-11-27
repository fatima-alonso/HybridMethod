-- Fase 6 (DECISIONS A31): Smart Retries genera varios intentos fallidos de la misma factura, con el
-- mismo Payment Intent. Cada intento se registra como un Payment `failed` (RF-18), así que la
-- unicidad de `stripeInvoiceId` y `stripePaymentIntentId` aplica solo a los pagos exitosos: sigue
-- siendo la segunda barrera contra cobros duplicados (SDD §5.3).

DROP INDEX "payments_stripePaymentIntentId_key";
DROP INDEX "payments_stripeInvoiceId_key";

CREATE INDEX "payments_stripeInvoiceId_idx" ON "payments"("stripeInvoiceId");
CREATE INDEX "payments_stripePaymentIntentId_idx" ON "payments"("stripePaymentIntentId");

CREATE UNIQUE INDEX "payments_succeeded_stripeInvoiceId_key" ON "payments"("stripeInvoiceId")
  WHERE "status" = 'succeeded';
CREATE UNIQUE INDEX "payments_succeeded_stripePaymentIntentId_key" ON "payments"("stripePaymentIntentId")
  WHERE "status" = 'succeeded';
