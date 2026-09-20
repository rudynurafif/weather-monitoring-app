import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { Request } from 'express';

/**
 * Envelope response sukses yang seragam di seluruh API.
 *
 *   { "success": true, "data": <payload>, "meta": { ... } }
 *
 * Kenapa pakai envelope, bukan mengembalikan objek polos:
 *  - tempat yang konsisten untuk request_id dan info pagination;
 *  - bentuk response sukses dan gagal jadi simetris, sehingga klien cukup
 *    memeriksa satu field (`success`) untuk bercabang;
 *  - bisa menambah metadata baru tanpa merusak kontrak yang sudah ada.
 *
 * Handler cukup mengembalikan data apa adanya. Kalau handler mengembalikan
 * objek ber-field `data` + `meta`, meta-nya digabung (dipakai endpoint list
 * untuk menyelipkan pagination).
 */
export interface ResponseMeta {
  request_id: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<Request & { requestId?: string }>();

    return next.handle().pipe(
      map((payload) => {
        const isEnvelopedByHandler =
          payload !== null &&
          typeof payload === 'object' &&
          'data' in (payload as object) &&
          'meta' in (payload as object);

        const body = isEnvelopedByHandler
          ? (payload as unknown as { data: T; meta: Record<string, unknown> })
          : { data: payload as T, meta: {} };

        return {
          success: true as const,
          data: body.data,
          meta: {
            ...body.meta,
            request_id: request.requestId ?? 'unknown',
            // Selalu UTC dengan suffix Z. Konversi ke WIB dilakukan di frontend.
            timestamp: new Date().toISOString(),
          },
        };
      }),
    );
  }
}
