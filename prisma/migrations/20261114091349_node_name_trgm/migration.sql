-- Trigram matching for name search (ILIKE '%text%'). pg_trgm is a trusted extension since
-- PostgreSQL 13: the database owner may create it without being a superuser (docs/deploy-systemd.md).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Node_name_idx" ON "Node" USING GIN ("name" gin_trgm_ops);
