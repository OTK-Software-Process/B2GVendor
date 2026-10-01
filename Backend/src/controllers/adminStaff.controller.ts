import { Request, Response } from 'express';
import * as adminStaffService from '../services/adminStaff.service';
import { created, ok } from '../utils/apiResponse';
import { CreateAdminInput, UpdateAdminInput } from '../validators/adminStaff.validator';

export async function list(req: Request, res: Response): Promise<void> {
  ok(res, await adminStaffService.listStaff(req.query as adminStaffService.StaffListFilter));
}

export async function getById(req: Request, res: Response): Promise<void> {
  ok(res, await adminStaffService.getStaff(req.params.id));
}

export async function create(req: Request, res: Response): Promise<void> {
  created(res, await adminStaffService.createAdmin(req.body as CreateAdminInput));
}

export async function update(req: Request, res: Response): Promise<void> {
  ok(res, await adminStaffService.updateAdmin(req.params.id, req.body as UpdateAdminInput));
}

export async function suspend(req: Request, res: Response): Promise<void> {
  ok(res, await adminStaffService.suspendAdmin(req.params.id));
}

export async function reactivate(req: Request, res: Response): Promise<void> {
  ok(res, await adminStaffService.reactivateAdmin(req.params.id));
}

export async function signOutEverywhere(req: Request, res: Response): Promise<void> {
  ok(res, await adminStaffService.signOutAdminEverywhere(req.params.id));
}

export async function sendPasswordLink(req: Request, res: Response): Promise<void> {
  ok(res, await adminStaffService.sendAdminPasswordLink(req.params.id));
}

export async function remove(req: Request, res: Response): Promise<void> {
  ok(res, await adminStaffService.deleteAdmin(req.params.id));
}
