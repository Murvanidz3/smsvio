-- Sent.dm provider: a template-only provider whose sends can end BLOCKED.
ALTER TYPE "MessageStatus" ADD VALUE 'BLOCKED';
ALTER TYPE "ProviderType" ADD VALUE 'SENT_DM';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "providerRequestId" TEXT;
ALTER TABLE "messages" ADD COLUMN "providerTemplateId" TEXT;
ALTER TABLE "messages" ADD COLUMN "channel" TEXT;
