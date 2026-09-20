import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode } from '../errors/error-codes';
import type { FieldError } from '../errors/api.exception';

/**
 * Menerjemahkan SEMUA error menjadi satu format response yang sama:
 *
 *   {
 *     "success": false,
 *     "error": { "code": "...", "message": "...", "details": [...] },
 *     "meta":  { "request_id": "...", "timestamp": "..." }
 *   }
 *
 * Filter ini sengaja menangkap segalanya (termasuk error tak terduga) supaya
 * tidak ada satu pun jalur yang bocor mengembalikan format default Nest.
 * Detail error internal tidak pernah dikirim ke klien; yang keluar hanya
 * INTERNAL_ERROR + request_id, sementara stack trace-nya masuk ke log server
 * dengan request_id yang sama sebagai penghubung.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL_ERROR;
    let message = 'Terjadi kesalahan internal';
    let details: FieldError[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null && 'code' in body) {
        // Dilempar oleh ApiException -> sudah membawa kode kita sendiri.
        const typed = body as { code: string; message: string; details?: FieldError[] };
        code = typed.code;
        message = typed.message;
        details = typed.details;
      } else if (typeof body === 'object' && body !== null && 'message' in body) {
        // Dilempar oleh ValidationPipe bawaan Nest.
        const typed = body as { message: string | string[] };
        code = status === HttpStatus.BAD_REQUEST
          ? ErrorCode.VALIDATION_FAILED
          : this.statusToCode(status);
        const messages = Array.isArray(typed.message) ? typed.message : [typed.message];
        message = messages[0] ?? 'Request tidak valid';
        details = messages.map((m) => ({
          field: this.guessFieldName(m),
          code: 'INVALID_VALUE',
          message: m,
        }));
      } else {
        code = this.statusToCode(status);
        message = typeof body === 'string' ? body : message;
      }
    } else {
      // Error yang benar-benar tidak terduga: catat lengkap di server.
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} - unhandled`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      error: { code, message, ...(details?.length ? { details } : {}) },
      meta: { request_id: requestId, timestamp: new Date().toISOString() },
    });
  }

  private statusToCode(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.ALREADY_EXISTS;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMIT_EXCEEDED;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }

  /** class-validator menaruh nama properti di awal pesannya. */
  private guessFieldName(message: string): string {
    return message.split(' ')[0] ?? 'unknown';
  }
}
