/**
 * Semua pembacaan process.env dikumpulkan di satu tempat supaya tidak ada
 * `process.env.X` yang tersebar di dalam service. Nilai numerik di-parse dan
 * diberi default di sini, jadi service selalu menerima tipe yang benar.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  displayTimezone: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  deviceKeyPepper: string;
  clockDriftToleranceSeconds: number;
  maxBatchSize: number;
  ingestRateLimitPerMinute: number;
  deviceOfflineThresholdMinutes: number;
}

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: toInt(process.env.API_PORT, 3001),
  displayTimezone: process.env.DISPLAY_TZ ?? 'Asia/Jakarta',
  jwtSecret: process.env.JWT_SECRET ?? 'insecure-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  deviceKeyPepper: process.env.DEVICE_KEY_PEPPER ?? 'insecure-dev-pepper-change-me',
  clockDriftToleranceSeconds: toInt(process.env.CLOCK_DRIFT_TOLERANCE_SECONDS, 300),
  maxBatchSize: toInt(process.env.MAX_BATCH_SIZE, 500),
  ingestRateLimitPerMinute: toInt(process.env.INGEST_RATE_LIMIT_PER_MINUTE, 120),
  deviceOfflineThresholdMinutes: toInt(process.env.DEVICE_OFFLINE_THRESHOLD_MINUTES, 15),
});
