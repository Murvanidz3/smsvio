-- Compliance profile, use cases, private documents, auto-replies, and the opt-out list.

CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "AutoReplyCategory" AS ENUM ('HELP', 'OPT_IN', 'OPT_OUT', 'CUSTOM');

CREATE TABLE "compliance_profiles" (
    "organizationId" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "website" TEXT,
    "registrationNumber" TEXT,
    "registrationCountry" CHAR(2) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_profiles_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "use_cases" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "sample" TEXT NOT NULL,
    "optIn" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "use_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_documents" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "countryIso2" CHAR(2) NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytesEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auto_replies" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "category" "AutoReplyCategory" NOT NULL,
    "keywords" TEXT[],
    "body" TEXT NOT NULL,
    "protected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_replies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opt_outs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opt_outs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "use_cases_organizationId_createdAt_idx" ON "use_cases"("organizationId", "createdAt");
CREATE INDEX "use_cases_status_createdAt_idx" ON "use_cases"("status", "createdAt");
CREATE INDEX "compliance_documents_organizationId_createdAt_idx" ON "compliance_documents"("organizationId", "createdAt");
CREATE INDEX "auto_replies_organizationId_idx" ON "auto_replies"("organizationId");
CREATE UNIQUE INDEX "opt_outs_organizationId_phoneE164_key" ON "opt_outs"("organizationId", "phoneE164");
CREATE INDEX "opt_outs_organizationId_idx" ON "opt_outs"("organizationId");

ALTER TABLE "compliance_profiles" ADD CONSTRAINT "compliance_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "use_cases" ADD CONSTRAINT "use_cases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auto_replies" ADD CONSTRAINT "auto_replies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opt_outs" ADD CONSTRAINT "opt_outs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
