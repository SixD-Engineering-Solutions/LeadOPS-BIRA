-- AlterTable
ALTER TABLE "pipeline_tracker_items" ADD COLUMN     "source_project_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_tracker_items_source_project_id_key" ON "pipeline_tracker_items"("source_project_id");
