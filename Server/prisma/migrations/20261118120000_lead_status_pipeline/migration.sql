-- Lead statuses are now: Cold call, Warm, Hot, Qualified, Follow-up, Lost.
-- Existing leads keep their place: Submitted -> Cold call, In Process ->
-- Follow-up, Dead -> Lost. Renaming the rows keeps every lead's link.
UPDATE "lead_statuses" SET "status_name" = 'Cold call', "status_category" = 'Open',        "display_order" = 1 WHERE "status_name" = 'Submitted'  AND NOT EXISTS (SELECT 1 FROM "lead_statuses" WHERE "status_name" = 'Cold call');
UPDATE "lead_statuses" SET "status_name" = 'Follow-up', "status_category" = 'In Progress', "display_order" = 5 WHERE "status_name" = 'In Process' AND NOT EXISTS (SELECT 1 FROM "lead_statuses" WHERE "status_name" = 'Follow-up');
UPDATE "lead_statuses" SET "status_name" = 'Lost',      "status_category" = 'Closed Lost', "display_order" = 6 WHERE "status_name" = 'Dead'       AND NOT EXISTS (SELECT 1 FROM "lead_statuses" WHERE "status_name" = 'Lost');

INSERT INTO "lead_statuses" ("id", "status_name", "status_category", "display_order", "updated_at")
SELECT 'status_' || lower(replace(v.n, ' ', '_')), v.n, v.c, v.o, CURRENT_TIMESTAMP
FROM (VALUES ('Cold call','Open',1), ('Warm','Open',2), ('Hot','Open',3), ('Qualified','Open',4), ('Follow-up','In Progress',5), ('Lost','Closed Lost',6)) AS v(n, c, o)
WHERE NOT EXISTS (SELECT 1 FROM "lead_statuses" s WHERE s."status_name" = v.n);
