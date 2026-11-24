-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limit_buckets_windowStart_idx" ON "rate_limit_buckets"("windowStart");

-- Restricciones que Prisma no expresa (DECISIONS A16).
ALTER TABLE "rate_limit_buckets" ADD CONSTRAINT "rate_limit_buckets_count_check"
  CHECK ("count" >= 1);
