import { NextFunction, Request, Response } from 'express';

/**
 * One JSON line per HTTP request, written when the response is finished
 * (docs/Security.md section 13). Installed FIRST, so refused requests (CSRF,
 * a broken body, rate limits, 404s) are logged too.
 *
 *   {"scope":"http","event":"http.request","method":"GET","path":"/api/v1/works",
 *    "status":200,"ms":42,"ip":"…","requestId":"…","accountId":"…"}
 *
 * The path is logged WITHOUT its query string: search text and filters stay out
 * of the logs. The request id is set by auditContextMiddleware (res.locals) and
 * also returned to the caller in X-Request-Id, so a reported error can be found.
 * This replaces morgan, whose text format could not be parsed reliably and had
 * log-forging advisories.
 */
export function accessLog() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const status = res.statusCode;
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      const record = {
        time: new Date().toISOString(),
        level,
        scope: 'http',
        event: 'http.request',
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status,
        ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
        ip: req.ip,
        ...(res.locals.requestId ? { requestId: res.locals.requestId } : {}),
        ...(req.account ? { accountId: String(req.account._id), role: req.account.role } : {})
      };
      // One console call per line, with the JSON as an argument to a fixed format (V1.3.10).
      if (level === 'error') console.error('%s', JSON.stringify(record));
      else if (level === 'warn') console.warn('%s', JSON.stringify(record));
      else console.log('%s', JSON.stringify(record));
    });
    next();
  };
}

