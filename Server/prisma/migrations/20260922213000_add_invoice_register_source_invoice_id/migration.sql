-- AlterTable
ALTER TABLE "invoice_register_items" ADD COLUMN     "source_invoice_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "invoice_register_items_source_invoice_id_key" ON "invoice_register_items"("source_invoice_id");
