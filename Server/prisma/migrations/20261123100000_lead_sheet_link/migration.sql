-- AlterTable
ALTER TABLE "leads" ADD COLUMN "sheet_key" TEXT,
ADD COLUMN "sheet_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "leads_sheet_key_key" ON "leads"("sheet_key");
