import { Request, Response } from 'express';
import * as adminAccountService from '../services/adminAccount.service';
import { created, ok } from '../utils/apiResponse';
import { CreateVendorInput, UpdateVendorInput } from '../validators/adminAccount.validator';
import { MfaResetInput } from '../validators/mfa.validator';
import { AppError } from '../utils/AppError';

export async function list(req: Request, res: Response): Promise<void> {
  ok(res, await adminAccountService.listVendors(req.query as adminAccountService.VendorListFilter));
}

export async function getById(req: Request, res: Response): Promise<void> {
  ok(res, await adminAccountService.getVendor(req.params.id));
}

export async function create(req: Request, res: Response): Promise<void> {
  created(res, await adminAccountService.createVendor(req.body as CreateVendorInput));
}

export async function update(req: Request, res: Response): Promise<void> {
  ok(res, await adminAccountService.updateVendor(req.params.id, req.body as UpdateVendorInput));
}

export async function suspend(req: Request, res: Response): Promise<void> {
  ok(res, await adminAccountService.suspendVendor(req.params.id));
}

export async function reactivate(req: Request, res: Response): Promise<void> {
  ok(res, await adminAccountService.reactivateVendor(req.params.id));
}

export async function signOutEverywhere(req: Request, res: Response): Promise<void> {
  ok(res, await adminAccountService.signOutVendorEverywhere(req.params.id));
}

export async function sendPasswordLink(req: Request, res: Response): Promise<void> {
  ok(res, await adminAccountService.sendVendorPasswordLink(req.params.id));
}

export async function remove(req: Request, res: Response): Promise<void> {
  ok(res, await adminAccountService.deleteVendor(req.params.id));
}

export async function resetMfa(req: Request, res: Response): Promise<void> {
  if (!req.account) throw AppError.notAuthenticated();
  ok(res, await adminAccountService.resetVendorMfa(req.params.id, req.account, req.body as MfaResetInput));
}
