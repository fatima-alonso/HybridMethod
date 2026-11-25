import { connection, type NextRequest } from "next/server";

import { getConfig } from "@/lib/config";
import { safeEqual } from "@/lib/crypto";
import { jsonError, jsonOk, unexpectedError } from "@/lib/http";
import { runDailyJobs } from "@/services/cron.service";

/**
 * `GET /api/cron/daily` (SDD §7.8). Lo llama Vercel Cron una vez al día (`vercel.json`) con
 * `Authorization: Bearer ${CRON_SECRET}`. Sin `CRON_SECRET` configurado no se ejecuta nunca.
 */
export async function GET(request: NextRequest) {
  // Siempre en tiempo de ejecución: nunca se prerenderiza en `next build`.
  await connection();
  const secret = getConfig().CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) {
    return jsonError(401, "verification_required", "No autorizado.");
  }
  try {
    const result = await runDailyJobs();
    console.info("[cron.daily]", JSON.stringify(result));
    return jsonOk({ ...result });
  } catch (error) {
    return unexpectedError("cron.daily", error);
  }
}
