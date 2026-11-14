-- relayfiles: contract Node_accountId_type_size_idx covers both dropped indexes (they are its prefix and its type = 'FILE' case); only indexes go, no data
-- Storage used by an account is summed from the index alone (index-only scan) instead of every file row.

-- CreateIndex
CREATE INDEX "Node_accountId_type_size_idx" ON "Node"("accountId", "type", "size");

-- DropIndex
DROP INDEX "Node_accountId_size_idx";

-- DropIndex
DROP INDEX "Node_accountId_type_idx";
