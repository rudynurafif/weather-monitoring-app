-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "device_status" AS ENUM ('PROVISIONED', 'ACTIVE', 'MAINTENANCE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "credential_status" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "sensor_status" AS ENUM ('IN_STOCK', 'INSTALLED', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "bucket_width" AS ENUM ('MINUTE_1', 'HOUR_1', 'DAY_1');

-- CreateTable
CREATE TABLE "location" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "altitude_m" DECIMAL(7,2) NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'VIEWER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device" (
    "id" UUID NOT NULL,
    "device_code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "location_id" UUID,
    "status" "device_status" NOT NULL DEFAULT 'PROVISIONED',
    "firmware_version" VARCHAR(32),
    "installed_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6),
    "last_battery_v" DOUBLE PRECISION,
    "last_rssi" INTEGER,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_credential" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "key_id" VARCHAR(32) NOT NULL,
    "secret_hash" VARCHAR(64) NOT NULL,
    "secret_prefix" VARCHAR(12) NOT NULL,
    "status" "credential_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_status_history" (
    "id" BIGSERIAL NOT NULL,
    "device_id" UUID NOT NULL,
    "from_status" "device_status",
    "to_status" "device_status" NOT NULL,
    "reason" VARCHAR(255),
    "changed_by_user_id" UUID,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor_type" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "unit" VARCHAR(16) NOT NULL,
    "min_valid" DOUBLE PRECISION NOT NULL,
    "max_valid" DOUBLE PRECISION NOT NULL,
    "precision" INTEGER NOT NULL DEFAULT 2,
    "is_cumulative" BOOLEAN NOT NULL DEFAULT false,
    "unit_per_count" DOUBLE PRECISION,
    "is_circular" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sensor_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor" (
    "id" UUID NOT NULL,
    "serial_number" VARCHAR(64) NOT NULL,
    "sensor_type_id" INTEGER NOT NULL,
    "manufacturer" VARCHAR(80),
    "model" VARCHAR(80),
    "status" "sensor_status" NOT NULL DEFAULT 'IN_STOCK',
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sensor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor_installation" (
    "id" UUID NOT NULL,
    "sensor_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "sensor_type_id" INTEGER NOT NULL,
    "channel" SMALLINT NOT NULL DEFAULT 0,
    "installed_at" TIMESTAMPTZ(6) NOT NULL,
    "removed_at" TIMESTAMPTZ(6),
    "installed_by_user_id" UUID,
    "notes" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensor_installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor_calibration" (
    "id" UUID NOT NULL,
    "sensor_id" UUID NOT NULL,
    "offset" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scale" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "notes" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sensor_calibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor_reading" (
    "device_time" TIMESTAMPTZ(6) NOT NULL,
    "server_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" UUID NOT NULL,
    "sensor_type_id" INTEGER NOT NULL,
    "channel" SMALLINT NOT NULL DEFAULT 0,
    "sensor_id" UUID,
    "installation_id" UUID,
    "raw_value" DOUBLE PRECISION NOT NULL,
    "value" DOUBLE PRECISION,
    "delta_value" DOUBLE PRECISION,
    "quality_flags" INTEGER NOT NULL DEFAULT 0,
    "seq" INTEGER,
    "calibration_id" UUID,

    CONSTRAINT "sensor_reading_pkey" PRIMARY KEY ("device_id","sensor_type_id","channel","device_time")
);

-- CreateTable
CREATE TABLE "device_heartbeat" (
    "device_time" TIMESTAMPTZ(6) NOT NULL,
    "server_time" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" UUID NOT NULL,
    "battery_v" DOUBLE PRECISION,
    "rssi" INTEGER,
    "uptime_s" BIGINT,
    "firmware_version" VARCHAR(32),
    "source" VARCHAR(16) NOT NULL DEFAULT 'HEARTBEAT',

    CONSTRAINT "device_heartbeat_pkey" PRIMARY KEY ("device_id","device_time")
);

-- CreateTable
CREATE TABLE "reading_aggregate" (
    "bucket_start" TIMESTAMPTZ(6) NOT NULL,
    "bucket_width" "bucket_width" NOT NULL,
    "device_id" UUID NOT NULL,
    "sensor_type_id" INTEGER NOT NULL,
    "channel" SMALLINT NOT NULL DEFAULT 0,
    "avg_value" DOUBLE PRECISION,
    "min_value" DOUBLE PRECISION,
    "max_value" DOUBLE PRECISION,
    "sum_delta" DOUBLE PRECISION,
    "last_value" DOUBLE PRECISION,
    "sum_sin" DOUBLE PRECISION,
    "sum_cos" DOUBLE PRECISION,
    "count_readings" INTEGER NOT NULL DEFAULT 0,
    "count_good" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reading_aggregate_pkey" PRIMARY KEY ("device_id","sensor_type_id","channel","bucket_width","bucket_start")
);

-- CreateIndex
CREATE UNIQUE INDEX "location_name_key" ON "location"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "device_device_code_key" ON "device"("device_code");

-- CreateIndex
CREATE INDEX "device_status_location_id_idx" ON "device"("status", "location_id");

-- CreateIndex
CREATE INDEX "device_last_seen_at_idx" ON "device"("last_seen_at");

-- CreateIndex
CREATE INDEX "device_deleted_at_idx" ON "device"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_credential_key_id_key" ON "device_credential"("key_id");

-- CreateIndex
CREATE INDEX "device_credential_device_id_status_idx" ON "device_credential"("device_id", "status");

-- CreateIndex
CREATE INDEX "device_status_history_device_id_changed_at_idx" ON "device_status_history"("device_id", "changed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sensor_type_key_key" ON "sensor_type"("key");

-- CreateIndex
CREATE UNIQUE INDEX "sensor_serial_number_key" ON "sensor"("serial_number");

-- CreateIndex
CREATE INDEX "sensor_sensor_type_id_status_idx" ON "sensor"("sensor_type_id", "status");

-- CreateIndex
CREATE INDEX "sensor_installation_device_id_sensor_type_id_channel_instal_idx" ON "sensor_installation"("device_id", "sensor_type_id", "channel", "installed_at" DESC);

-- CreateIndex
CREATE INDEX "sensor_installation_device_id_installed_at_idx" ON "sensor_installation"("device_id", "installed_at" DESC);

-- CreateIndex
CREATE INDEX "sensor_installation_sensor_id_installed_at_idx" ON "sensor_installation"("sensor_id", "installed_at" DESC);

-- CreateIndex
CREATE INDEX "sensor_calibration_sensor_id_effective_from_idx" ON "sensor_calibration"("sensor_id", "effective_from" DESC);

-- CreateIndex
CREATE INDEX "sensor_reading_device_id_device_time_idx" ON "sensor_reading"("device_id", "device_time" DESC);

-- CreateIndex
CREATE INDEX "device_heartbeat_device_time_idx" ON "device_heartbeat"("device_time" DESC);

-- CreateIndex
CREATE INDEX "reading_aggregate_bucket_width_bucket_start_idx" ON "reading_aggregate"("bucket_width", "bucket_start" DESC);

-- AddForeignKey
ALTER TABLE "device" ADD CONSTRAINT "device_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_credential" ADD CONSTRAINT "device_credential_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_status_history" ADD CONSTRAINT "device_status_history_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_status_history" ADD CONSTRAINT "device_status_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor" ADD CONSTRAINT "sensor_sensor_type_id_fkey" FOREIGN KEY ("sensor_type_id") REFERENCES "sensor_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_installation" ADD CONSTRAINT "sensor_installation_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "sensor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_installation" ADD CONSTRAINT "sensor_installation_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_installation" ADD CONSTRAINT "sensor_installation_sensor_type_id_fkey" FOREIGN KEY ("sensor_type_id") REFERENCES "sensor_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_installation" ADD CONSTRAINT "sensor_installation_installed_by_user_id_fkey" FOREIGN KEY ("installed_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_calibration" ADD CONSTRAINT "sensor_calibration_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "sensor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_calibration" ADD CONSTRAINT "sensor_calibration_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_heartbeat" ADD CONSTRAINT "device_heartbeat_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
