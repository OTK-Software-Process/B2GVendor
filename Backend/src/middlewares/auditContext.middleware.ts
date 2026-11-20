import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { actorFromAccount, runWithAuditContext } from '../utils/auditContext';

// Opens an audit context for the request. Everything that runs for this
// request (middleware, controllers, services, awaited DB calls) can call
// audit.log() and get the right actor/IP/request id automatically.
export function auditContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const path = req.originalUrl.split('?')[0]; // never keep the query string: it can hold search terms
  // The same id ties together the audit rows, the log lines and the access-log
  // line of this request; the caller gets it back to quote in a support request.
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  runWithAuditContext(
    {
      ip: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 512),
      requestId,
      request: { method: req.method, path },
      // req.account is filled in later by requireAuth, so look it up on demand.
      getActor: () => (req.account ? actorFromAccount(req.account) : { type: 'anonymous' })
    },
    () => next()
  );
}
