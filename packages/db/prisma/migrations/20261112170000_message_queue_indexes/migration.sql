-- CreateIndex
CREATE INDEX "messages_status_sentAt_idx" ON "messages"("status", "sentAt");

-- CreateIndex
CREATE INDEX "messages_status_queuedAt_idx" ON "messages"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "messages_status_updatedAt_idx" ON "messages"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "messages_providerMessageId_idx" ON "messages"("providerMessageId");
