-- The Photos timeline (timeline.repo.ts timelinePage) reads an account's photos and videos newest
-- first by COALESCE("takenAt", "modifiedAt", "createdAt"), then id, a page at a time. This index
-- holds exactly that order, so a page reads its rows from the index instead of sorting every
-- photo of the account. Prisma cannot describe an expression index in schema.prisma; it ignores
-- it when comparing the schema with the database (CI's migrate diff).
CREATE INDEX "Node_timeline_idx" ON "Node" ("accountId", (COALESCE("takenAt", "modifiedAt", "createdAt")) DESC, "id" DESC)
  WHERE "type" = 'FILE' AND "kind" IN ('IMAGE', 'VIDEO');
