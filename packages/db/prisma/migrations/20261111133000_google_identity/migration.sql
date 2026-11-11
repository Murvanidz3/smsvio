ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

ALTER TABLE "users" ADD COLUMN "googleSub" TEXT;

CREATE UNIQUE INDEX "users_googleSub_key" ON "users"("googleSub");
