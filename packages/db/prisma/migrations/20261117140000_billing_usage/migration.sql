-- Billing preferences and the daily usage rollup. No payment-provider credentials.

CREATE TABLE "billing_profiles" (
    "organizationId" UUID NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "line1" TEXT,
    "line2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "countryIso2" CHAR(2),
    "lowBalanceMicros" BIGINT,
    "lowBalanceNotifiedAt" TIMESTAMP(3),
    "autoRechargeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoRechargeThresholdMicros" BIGINT,
    "autoRechargeAmountMicros" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_profiles_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "daily_usage" (
    "organizationId" UUID NOT NULL,
    "day" CHAR(10) NOT NULL,
    "sent" INTEGER NOT NULL,
    "delivered" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "finalCount" INTEGER NOT NULL,
    "spendMicros" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_usage_pkey" PRIMARY KEY ("organizationId", "day")
);

CREATE INDEX "daily_usage_organizationId_day_idx" ON "daily_usage"("organizationId", "day");

ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_usage" ADD CONSTRAINT "daily_usage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
