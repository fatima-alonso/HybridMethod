import type { Contract, Payment, ServicePeriod } from "@/generated/prisma/client";
import { getPrisma, type Db } from "@/lib/prisma";
import { addOneBusinessMonth } from "@/utils/service-period";

import { NON_RENEWING } from "./contract.service";

/**
 * Meses pagados (DECISIONS A19, SDD §5.3 ServicePeriod). Cada pago confirmado abre un mes que va
 * de la fecha de pago al mismo día del mes siguiente. Si el cliente ya tiene un mes pagado que
 * todavía no termina, el nuevo empieza cuando termina ese (pago por adelantado, A20).
 */

/**
 * Fin del último mes pagado del cliente que sigue vigente o por empezar (pago único o
 * transferencia), o `null`. `excludeContractId` deja fuera el contrato que se está pagando.
 */
export async function currentCoverageEnd(
  customerId: string,
  db: Db,
  now: Date,
  excludeContractId?: string,
): Promise<Date | null> {
  const latest = await db.contract.findFirst({
    where: {
      customerId,
      status: { in: ["active", "scheduled"] },
      paymentType: { in: [...NON_RENEWING] },
      serviceEndDate: { gt: now },
      ...(excludeContractId ? { id: { not: excludeContractId } } : {}),
    },
    orderBy: { serviceEndDate: "desc" },
    select: { serviceEndDate: true },
  });
  return latest?.serviceEndDate ?? null;
}

/** Periodo del mes que abre un pago confirmado en `paidAt` para pago único o transferencia. */
export async function nextOneMonthPeriod(
  contract: Pick<Contract, "id" | "customerId">,
  paidAt: Date,
  db: Db,
): Promise<{ serviceStartDate: Date; serviceEndDate: Date }> {
  const coverageEnd = await currentCoverageEnd(contract.customerId, db, paidAt, contract.id);
  const serviceStartDate =
    coverageEnd && coverageEnd.getTime() > paidAt.getTime() ? coverageEnd : paidAt;
  return { serviceStartDate, serviceEndDate: addOneBusinessMonth(serviceStartDate) };
}

/** Registra el mes pagado (`sequence` = siguiente número de mes del contrato). */
export async function createServicePeriod(
  input: {
    contract: Pick<Contract, "id" | "programId">;
    payment: Pick<Payment, "id">;
    paidAt: Date;
    serviceStartDate: Date;
    serviceEndDate: Date;
  },
  db: Db = getPrisma(),
): Promise<ServicePeriod> {
  const previous = await db.servicePeriod.count({ where: { contractId: input.contract.id } });
  return db.servicePeriod.create({
    data: {
      contractId: input.contract.id,
      paymentId: input.payment.id,
      programId: input.contract.programId,
      sequence: previous + 1,
      paidAt: input.paidAt,
      startDate: input.serviceStartDate,
      endDate: input.serviceEndDate,
      createdAt: input.paidAt,
    },
  });
}
