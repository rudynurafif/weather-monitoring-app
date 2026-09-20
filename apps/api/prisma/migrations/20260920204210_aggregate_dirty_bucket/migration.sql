-- DropIndex
DROP INDEX "sensor_reading_device_time_idx";

-- DropIndex
DROP INDEX "sensor_reading_latest_idx";

-- CreateTable
CREATE TABLE "aggregate_dirty_bucket" (
    "device_id" UUID NOT NULL,
    "sensor_type_id" INTEGER NOT NULL,
    "channel" SMALLINT NOT NULL DEFAULT 0,
    "bucket_width" "bucket_width" NOT NULL,
    "bucket_start" TIMESTAMPTZ(6) NOT NULL,
    "marked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aggregate_dirty_bucket_pkey" PRIMARY KEY ("device_id","sensor_type_id","channel","bucket_width","bucket_start")
);

-- CreateIndex
CREATE INDEX "aggregate_dirty_bucket_marked_at_idx" ON "aggregate_dirty_bucket"("marked_at");
