-- Admin audit lists the newest rows across every organization.
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt" DESC);
