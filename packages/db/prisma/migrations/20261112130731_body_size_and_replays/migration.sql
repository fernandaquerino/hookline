-- AlterTable
ALTER TABLE "InboundRequest" ADD COLUMN     "bodySize" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Delivery_replayOfId_idx" ON "Delivery"("replayOfId");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_replayOfId_fkey" FOREIGN KEY ("replayOfId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill sizes for requests stored before this column existed.
UPDATE "InboundRequest" SET "bodySize" = octet_length("body");
