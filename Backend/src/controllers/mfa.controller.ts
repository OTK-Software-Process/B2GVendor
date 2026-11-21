import { Request, Response } from 'express';
import { IAccount } from '../models/account.model';
import { AppError } from '../utils/AppError';
import { ok } from '../utils/apiResponse';
import * as mfaService from '../services/mfa.service';

// Two-step verification, for the signed-in account (docs/API.md section 5). The
// routes sit behind requireAuth only, NOT behind a role: a staff account that must
// set up its second factor has to be able to reach exactly these.

function accountOf(req: Request): IAccount {
  if (!req.account) throw AppError.notAuthenticated();
  return req.account;
}

function sessionIdOf(req: Request): string {
  if (!req.authSession) throw AppError.notAuthenticated();
  return String(req.authSession._id);
}

export async function status(req: Request, res: Response): Promise<void> {
  ok(res, await mfaService.getStatus(accountOf(req)));
}

export async function setup(req: Request, res: Response): Promise<void> {
  ok(res, await mfaService.beginSetup(accountOf(req), req.body.password as string));
}

export async function enable(req: Request, res: Response): Promise<void> {
  ok(res, await mfaService.enable(accountOf(req), req.body.code as string, sessionIdOf(req)));
}

export async function regenerateRecoveryCodes(req: Request, res: Response): Promise<void> {
  ok(res, await mfaService.regenerateRecoveryCodes(accountOf(req), req.body.password as string, req.body.code as string));
}

export async function disable(req: Request, res: Response): Promise<void> {
  ok(res, await mfaService.disable(accountOf(req), req.body.password as string, req.body.code as string, sessionIdOf(req)));
}
