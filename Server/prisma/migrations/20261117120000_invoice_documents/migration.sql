-- AlterTable
ALTER TABLE "documents" ADD COLUMN "invoice_id" TEXT;

-- CreateIndex
CREATE INDEX "documents_invoice_id_idx" ON "documents"("invoice_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
