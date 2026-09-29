-- DropIndex
DROP INDEX "pipeline_tracker_items_source_project_id_key";

-- AlterTable
ALTER TABLE "pipeline_tracker_items" DROP COLUMN "source_project_id",
ADD COLUMN     "source_lead_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_tracker_items_source_lead_id_key" ON "pipeline_tracker_items"("source_lead_id");
