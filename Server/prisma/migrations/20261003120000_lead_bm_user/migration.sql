-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "bm_user_id" TEXT;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_bm_user_id_fkey" FOREIGN KEY ("bm_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
