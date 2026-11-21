-- Operator pause. Existing rows keep sending.
ALTER TABLE "platform_settings" ADD COLUMN "sendingPaused" BOOLEAN NOT NULL DEFAULT false;
