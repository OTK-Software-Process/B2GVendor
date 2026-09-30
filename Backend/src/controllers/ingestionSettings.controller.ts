import { Request, Response } from 'express';
import * as settingsService from '../services/ingestionSettings.service';
import { ok } from '../utils/apiResponse';
import { IAccount } from '../models/account.model';
import { UpdateIngestionSettingsBody } from '../validators/ingestionSettings.validator';

export async function get(_req: Request, res: Response): Promise<void> {
  ok(res, await settingsService.getScheduleOverview());
}

export async function update(req: Request, res: Response): Promise<void> {
  const account = req.account as IAccount;
  ok(res, await settingsService.updateIngestionSettings(req.body as UpdateIngestionSettingsBody, account._id));
}
