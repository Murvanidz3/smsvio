-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('MOCK', 'SMPP', 'HTTP');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('ALPHANUMERIC', 'LONG_CODE', 'SHORT_CODE');

-- CreateEnum
CREATE TYPE "SenderStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('TOPUP', 'HOLD', 'CHARGE', 'RELEASE', 'REFUND', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "networks" (
    "mcc" TEXT NOT NULL,
    "mnc" TEXT NOT NULL,
    "countryIso2" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "networks_pkey" PRIMARY KEY ("mcc","mnc")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ProviderType" NOT NULL,
    "configEnc" TEXT,
    "status" "ProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxTps" INTEGER NOT NULL,
    "callbackSecretHash" TEXT,
    "markupPercent" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "countryIso2" CHAR(2) NOT NULL,
    "mccmnc" TEXT,
    "providerId" UUID NOT NULL,
    "priority" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "costMicros" BIGINT NOT NULL,
    "markupPercent" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rates" (
    "id" UUID NOT NULL,
    "countryIso2" CHAR(2) NOT NULL,
    "mccmnc" TEXT,
    "priceMicros" BIGINT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_rates" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "countryIso2" CHAR(2) NOT NULL,
    "mccmnc" TEXT,
    "priceMicros" BIGINT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sender_ids" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "SenderType" NOT NULL,
    "value" TEXT NOT NULL,
    "status" "SenderStatus" NOT NULL DEFAULT 'PENDING',
    "useCase" TEXT NOT NULL,
    "reviewNote" TEXT,
    "intendedCountries" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sender_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_countries" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "countryIso2" CHAR(2) NOT NULL,
    "senderIdId" UUID,
    "registrationComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_balances" (
    "organizationId" UUID NOT NULL,
    "availableMicros" BIGINT NOT NULL DEFAULT 0,
    "heldMicros" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_balances_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "balanceAfterMicros" BIGINT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL,
    "defaultDailySpendCapMicros" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "providers_code_key" ON "providers"("code");

-- One route per provider and destination. Null mccmnc is the country-wide route.
CREATE UNIQUE INDEX "routes_destination_provider_key" ON "routes" ("countryIso2", COALESCE("mccmnc", ''), "providerId");

-- CreateIndex
CREATE INDEX "networks_countryIso2_idx" ON "networks"("countryIso2");

-- CreateIndex
CREATE INDEX "routes_countryIso2_enabled_priority_idx" ON "routes"("countryIso2", "enabled", "priority");

-- CreateIndex
CREATE INDEX "rates_countryIso2_mccmnc_effectiveFrom_idx" ON "rates"("countryIso2", "mccmnc", "effectiveFrom");

-- CreateIndex
CREATE INDEX "org_rates_organizationId_countryIso2_mccmnc_effectiveFrom_idx" ON "org_rates"("organizationId", "countryIso2", "mccmnc", "effectiveFrom");

-- CreateIndex
CREATE INDEX "sender_ids_organizationId_createdAt_idx" ON "sender_ids"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sender_ids_organizationId_value_key" ON "sender_ids"("organizationId", "value");

-- CreateIndex
CREATE INDEX "org_countries_organizationId_idx" ON "org_countries"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "org_countries_organizationId_countryIso2_key" ON "org_countries"("organizationId", "countryIso2");

-- CreateIndex
CREATE INDEX "ledger_entries_organizationId_createdAt_idx" ON "ledger_entries"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_organizationId_refId_idx" ON "ledger_entries"("organizationId", "refId");

-- AddForeignKey
ALTER TABLE "networks" ADD CONSTRAINT "networks_countryIso2_fkey" FOREIGN KEY ("countryIso2") REFERENCES "countries"("iso2") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_countryIso2_fkey" FOREIGN KEY ("countryIso2") REFERENCES "countries"("iso2") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rates" ADD CONSTRAINT "rates_countryIso2_fkey" FOREIGN KEY ("countryIso2") REFERENCES "countries"("iso2") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_rates" ADD CONSTRAINT "org_rates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sender_ids" ADD CONSTRAINT "sender_ids_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_countries" ADD CONSTRAINT "org_countries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_countries" ADD CONSTRAINT "org_countries_countryIso2_fkey" FOREIGN KEY ("countryIso2") REFERENCES "countries"("iso2") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_countries" ADD CONSTRAINT "org_countries_senderIdId_fkey" FOREIGN KEY ("senderIdId") REFERENCES "sender_ids"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_balances" ADD CONSTRAINT "org_balances_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "providers" ADD CONSTRAINT "providers_markup_check" CHECK ("markupPercent" >= 0 AND "markupPercent" <= 1000);
ALTER TABLE "providers" ADD CONSTRAINT "providers_tps_check" CHECK ("maxTps" >= 1);
ALTER TABLE "routes" ADD CONSTRAINT "routes_markup_check" CHECK ("markupPercent" IS NULL OR ("markupPercent" >= 0 AND "markupPercent" <= 1000));
ALTER TABLE "routes" ADD CONSTRAINT "routes_cost_check" CHECK ("costMicros" >= 0);
ALTER TABLE "routes" ADD CONSTRAINT "routes_priority_check" CHECK ("priority" >= 1 AND "weight" >= 1);
ALTER TABLE "rates" ADD CONSTRAINT "rates_price_check" CHECK ("priceMicros" >= 0);
ALTER TABLE "org_rates" ADD CONSTRAINT "org_rates_price_check" CHECK ("priceMicros" >= 0);
ALTER TABLE "org_balances" ADD CONSTRAINT "org_balances_nonnegative_check" CHECK ("availableMicros" >= 0 AND "heldMicros" >= 0);
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_cap_check" CHECK ("defaultDailySpendCapMicros" >= 0);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_spend_cap_check" CHECK ("dailySpendCapMicros" IS NULL OR "dailySpendCapMicros" >= 0);
