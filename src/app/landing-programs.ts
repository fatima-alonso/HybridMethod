import { cacheLife } from "next/cache";

import { getLandingPrograms } from "@/services/program.service";
import type { LandingProgram } from "@/types/program";

/**
 * Programas de la landing con caché de Next.js (`cacheComponents`): la página sigue siendo
 * estática, pero vuelve a leer la BD como máximo cada 5 minutos (DECISIONS A14). El precio que se
 * cobra siempre se toma de la BD en el servidor al crear el contrato, nunca de esta página.
 */
export async function getCachedLandingPrograms(): Promise<LandingProgram[]> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 86_400 });
  return getLandingPrograms();
}
