-- AlterTable
ALTER TABLE "proposals" ADD COLUMN "decided_at" TIMESTAMP(3);

-- Backfill: proposals already Won or Lost get their last update as the best
-- available decision date (there was no dedicated field before).
UPDATE "proposals" SET "decided_at" = "updated_at" WHERE "status" IN ('Won', 'Lost');
