-- CreateTable
CREATE TABLE "sheet_sync_runs" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "trigger" TEXT NOT NULL,
    "user_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "message" TEXT,
    "file_hash" TEXT,
    "changes" JSONB,

    CONSTRAINT "sheet_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sheet_sync_runs_started_at_idx" ON "sheet_sync_runs"("started_at");
