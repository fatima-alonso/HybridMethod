-- Fase 7B (DECISIONS A34): cupones de descuento de Stripe en el pago único y la suscripción.
-- El Payment guarda lo cobrado (puede ser 0 con una cortesía del 100 %) y aparte el descuento y el
-- código. La Subscription recuerda si tiene un cupón vigente, para avisar cuando se quita.

ALTER TABLE "payments" ADD COLUMN "discountAmount" DECIMAL(10,2);
ALTER TABLE "payments" ADD COLUMN "promotionCode" TEXT;

ALTER TABLE "subscriptions" ADD COLUMN "hasDiscount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subscriptions" ADD COLUMN "promotionCode" TEXT;

-- Un pago puede ser de $0 solo si un cupón lo descontó todo (cortesía). Sin cupón, sigue siendo > 0.
-- COALESCE: un CHECK que da NULL se acepta, y sin descuento "discountAmount" es NULL.
ALTER TABLE "payments" DROP CONSTRAINT "payments_amount_positive_check";
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive_check"
  CHECK ("amount" > 0 OR ("amount" = 0 AND COALESCE("discountAmount", 0) > 0));
ALTER TABLE "payments" ADD CONSTRAINT "payments_discount_positive_check"
  CHECK ("discountAmount" IS NULL OR "discountAmount" > 0);
