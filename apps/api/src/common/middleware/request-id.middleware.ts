import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Menempelkan request_id pada setiap request (ketentuan E.1: tracing).
 *
 * Kalau klien sudah mengirim header X-Request-Id — misalnya gateway atau
 * simulator yang ingin mengkorelasikan retry-nya — nilai itu dipakai ulang,
 * sehingga satu payload yang dikirim ulang 3x bisa ditelusuri sebagai satu
 * rangkaian di log. Kalau tidak ada, kita yang membuatkan.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();

    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
