-- AlterTable
ALTER TABLE "messages" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "messages" ADD COLUMN "failedRouteIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "message_events" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "detail" TEXT,
    "providerRaw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_events_messageId_createdAt_idx" ON "message_events"("messageId", "createdAt");

-- AddForeignKey
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
