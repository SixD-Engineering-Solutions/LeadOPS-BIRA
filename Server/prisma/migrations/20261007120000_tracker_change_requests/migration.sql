-- CreateTable
CREATE TABLE "tracker_change_requests" (
    "id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "row_id" TEXT NOT NULL,
    "row_label" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decision_note" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracker_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tracker_change_requests_admin_id_status_idx" ON "tracker_change_requests"("admin_id", "status");

-- CreateIndex
CREATE INDEX "tracker_change_requests_requester_id_status_idx" ON "tracker_change_requests"("requester_id", "status");

-- AddForeignKey
ALTER TABLE "tracker_change_requests" ADD CONSTRAINT "tracker_change_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_change_requests" ADD CONSTRAINT "tracker_change_requests_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

