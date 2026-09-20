import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

export interface FieldError {
  /** Lokasi field yang bermasalah, mis. "readings[2].v" */
  field: string;
  /** Kode spesifik per-field, mis. "OUT_OF_RANGE" */
  code: string;
  message: string;
}

/**
 * Satu-satunya cara melempar error yang disengaja di aplikasi ini. Dengan
 * memaksa setiap error punya ErrorCode, tidak mungkin ada response error yang
 * hanya berisi kalimat bahasa manusia tanpa kode.
 */
export class ApiException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: FieldError[],
  ) {
    super({ code, message, details }, status);
  }

  static notFound(resource: string, id: string | number): ApiException {
    return new ApiException(
      ErrorCode.NOT_FOUND,
      `${resource} dengan id "${id}" tidak ditemukan`,
      HttpStatus.NOT_FOUND,
    );
  }

  static validation(message: string, details?: FieldError[]): ApiException {
    return new ApiException(
      ErrorCode.VALIDATION_FAILED,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
      details,
    );
  }

  static conflict(code: ErrorCode, message: string): ApiException {
    return new ApiException(code, message, HttpStatus.CONFLICT);
  }
}
