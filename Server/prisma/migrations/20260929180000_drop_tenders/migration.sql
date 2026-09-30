-- DropForeignKey
ALTER TABLE "tenders" DROP CONSTRAINT "tenders_client_id_fkey";

-- DropForeignKey
ALTER TABLE "tenders" DROP CONSTRAINT "tenders_created_by_user_id_fkey";

-- DropTable
DROP TABLE "tenders";

