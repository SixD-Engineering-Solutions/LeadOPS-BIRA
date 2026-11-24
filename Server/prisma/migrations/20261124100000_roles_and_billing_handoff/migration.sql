-- Roles are now admin / bd / accounts; the old "employee" is the BD role.
UPDATE "users" SET "role" = 'bd' WHERE "role" = 'employee';
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'bd';

-- When a completed project was handed to the Accounts team for invoicing.
ALTER TABLE "projects" ADD COLUMN "billing_handoff_at" TIMESTAMP(3);
CREATE INDEX "projects_billing_handoff_at_idx" ON "projects"("billing_handoff_at");
