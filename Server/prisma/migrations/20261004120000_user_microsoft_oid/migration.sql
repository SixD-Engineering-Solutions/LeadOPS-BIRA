-- AlterTable
ALTER TABLE "users" ADD COLUMN     "microsoft_oid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_microsoft_oid_key" ON "users"("microsoft_oid");

