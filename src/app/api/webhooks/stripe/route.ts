import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";

import { getConfig } from "@/lib/config";
import { jsonError, unexpectedError } from "@/lib/http";
import { stripeWebhooks } from "@/lib/stripe";
import { processStripeEvent } from "@/services/stripe-webhook.service";

/**
 * `POST /api/webhooks/stripe` (RN-11, SDD §7.5, DECISIONS A6).
 *
 * 1. Verifica la firma (`Stripe-Signature`) con `STRIPE_WEBHOOK_SECRET` sobre el body crudo. Sin
 *    firma válida responde 400 y no toca nada.
 * 2. Procesa el evento de forma idempotente (WebhookEvent). Un evento repetido responde 200 sin
 *    volver a aplicarse.
 * 3. Si el procesamiento falla, responde 500 para que Stripe lo reintente.
 */
export async function POST(request: NextRequest) {
  const secret = getConfig().STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe.webhook] Falta STRIPE_WEBHOOK_SECRET: no se pueden verificar eventos.");
    return jsonError(503, "service_unavailable", "Webhook no configurado.");
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return jsonError(400, "invalid_signature", "Falta la firma de Stripe.");

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = stripeWebhooks.constructEvent(payload, signature, secret);
  } catch {
    return jsonError(400, "invalid_signature", "La firma de Stripe no es válida.");
  }

  try {
    const result = await processStripeEvent(event);
    return NextResponse.json(
      { received: true, status: result.status },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return unexpectedError("stripe.webhook", error);
  }
}
