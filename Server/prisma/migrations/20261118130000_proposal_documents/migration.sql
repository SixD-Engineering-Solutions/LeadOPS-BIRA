-- AlterTable
ALTER TABLE "documents" ADD COLUMN "proposal_id" TEXT;

-- CreateIndex
CREATE INDEX "documents_proposal_id_idx" ON "documents"("proposal_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
