import { Request, Response } from 'express';
import * as adminDashboardService from '../services/adminDashboard.service';
import { ok } from '../utils/apiResponse';

export async function get(_req: Request, res: Response): Promise<void> {
  ok(res, await adminDashboardService.getAdminDashboard());
}
