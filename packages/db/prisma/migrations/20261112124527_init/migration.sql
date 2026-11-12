-- CreateEnum
CREATE TYPE "SigningScheme" AS ENUM ('none', 'generic_sha256', 'github', 'stripe');

-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('valid', 'invalid', 'not_configured');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'IN_FLIGHT', 'SUCCEEDED', 'FAILED_RETRYING', 'DEAD');

-- CreateTable
CREATE TABLE "Endpoint" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "signingScheme" "SigningScheme" NOT NULL DEFAULT 'none',
    "signingSecretEnc" TEXT,
    "dedupeHeader" TEXT,
    "forwardInvalidSignatures" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Destination" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Destination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundRequest" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "body" BYTEA NOT NULL,
    "contentType" TEXT,
    "signatureStatus" "SignatureStatus" NOT NULL,
    "dedupeKey" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" UUID NOT NULL,
    "inboundRequestId" UUID NOT NULL,
    "destinationId" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "replayOfId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER,
    "responseStatus" INTEGER,
    "responseBodySnippet" TEXT,
    "error" TEXT,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Endpoint_slug_key" ON "Endpoint"("slug");

-- CreateIndex
CREATE INDEX "Destination_endpointId_idx" ON "Destination"("endpointId");

-- CreateIndex
CREATE INDEX "InboundRequest_endpointId_receivedAt_id_idx" ON "InboundRequest"("endpointId", "receivedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "InboundRequest_receivedAt_idx" ON "InboundRequest"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboundRequest_endpointId_dedupeKey_key" ON "InboundRequest"("endpointId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Delivery_inboundRequestId_idx" ON "Delivery"("inboundRequestId");

-- CreateIndex
CREATE INDEX "Delivery_destinationId_idx" ON "Delivery"("destinationId");

-- CreateIndex
CREATE INDEX "Delivery_status_updatedAt_idx" ON "Delivery"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_deliveryId_attemptNumber_key" ON "DeliveryAttempt"("deliveryId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "Destination" ADD CONSTRAINT "Destination_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundRequest" ADD CONSTRAINT "InboundRequest_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_inboundRequestId_fkey" FOREIGN KEY ("inboundRequestId") REFERENCES "InboundRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Destination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial index for the outbox relay: only unpublished events are scanned.
CREATE INDEX "OutboxEvent_unpublished_idx" ON "OutboxEvent"("createdAt") WHERE "publishedAt" IS NULL;
