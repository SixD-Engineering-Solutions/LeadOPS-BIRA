-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "amount_received" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "proposals" ALTER COLUMN "value" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "tenders" ALTER COLUMN "value" SET DATA TYPE DECIMAL(14,2);

