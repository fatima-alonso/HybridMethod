-- Estados nuevos del contrato (DECISIONS A20). Van en su propia migración porque PostgreSQL no
-- permite usar un valor de enum recién agregado dentro de la misma transacción (la siguiente
-- migración lo usa en un CHECK).
ALTER TYPE "ContractStatus" ADD VALUE 'expired';
ALTER TYPE "ContractStatus" ADD VALUE 'scheduled';
