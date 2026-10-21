-- CreateTable
CREATE TABLE "catalog_changes" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "leads_moved" INTEGER NOT NULL DEFAULT 0,
    "tracker_rows" INTEGER NOT NULL DEFAULT 0,
    "by_user_id" TEXT NOT NULL,
    "by_name" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reverted_at" TIMESTAMP(3),
    "reverted_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_changes_kind_created_at_idx" ON "catalog_changes"("kind", "created_at");
