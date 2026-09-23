/**
 * Kode error yang machine-readable (ketentuan E.1).
 *
 * Aturannya: klien TIDAK BOLEH mem-parsing `message` — pesan itu untuk manusia
 * dan boleh berubah kapan saja. Yang stabil dan boleh dijadikan pegangan logika
 * klien hanyalah `code` di bawah ini.
 */
export enum ErrorCode {
  // 400 / 422 — payload bermasalah
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  MALFORMED_JSON = 'MALFORMED_JSON',
  BATCH_TOO_LARGE = 'BATCH_TOO_LARGE',
  UNKNOWN_SENSOR_TYPE = 'UNKNOWN_SENSOR_TYPE',
  INVALID_TIME_RANGE = 'INVALID_TIME_RANGE',
  INTERVAL_TOO_FINE = 'INTERVAL_TOO_FINE',

  // 401 / 403 — autentikasi & otorisasi
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  INVALID_DEVICE_CREDENTIAL = 'INVALID_DEVICE_CREDENTIAL',
  DEVICE_NOT_REGISTERED = 'DEVICE_NOT_REGISTERED',
  DEVICE_NOT_ACTIVE = 'DEVICE_NOT_ACTIVE',
  /** Kredensial sah, tetapi field device_id di payload menunjuk device lain. */
  DEVICE_MISMATCH = 'DEVICE_MISMATCH',
  FORBIDDEN = 'FORBIDDEN',

  // 404 / 409 — resource
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  /** Resource tidak bisa dihapus karena masih direferensikan resource lain. */
  RESOURCE_IN_USE = 'RESOURCE_IN_USE',
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',
  SENSOR_ALREADY_INSTALLED = 'SENSOR_ALREADY_INSTALLED',
  SENSOR_NOT_INSTALLED = 'SENSOR_NOT_INSTALLED',

  // 429 / 5xx
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}
