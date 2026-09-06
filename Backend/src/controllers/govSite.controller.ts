import { Request, Response } from 'express';
import * as govSiteService from '../services/govSite.service';
import * as pollJobService from '../services/pollJob.service';
import { ok, created } from '../utils/apiResponse';
import { CreateGovSiteInput, UpdateGovSiteInput } from '../validators/govSite.validator';
import { IAccount } from '../models/account.model';

export async function list(_req: Request, res: Response): Promise<void> {
  const sites = await govSiteService.listGovSites();
  ok(res, sites);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const site = await govSiteService.getGovSiteById(req.params.id);
  ok(res, site);
}

export async function create(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateGovSiteInput;
  const site = await govSiteService.createGovSite(input);
  created(res, site);
}

export async function update(req: Request, res: Response): Promise<void> {
  const input = req.body as UpdateGovSiteInput;
  const site = await govSiteService.updateGovSite(req.params.id, input);
  ok(res, site);
}

export async function pollOne(req: Request, res: Response): Promise<void> {
  const { source } = req.body as { source: 'rss' | 'data_go_th' | 'both' };
  const account = req.account as IAccount;
  const job = await pollJobService.enqueueSitePoll(req.params.id, source, account._id);
  created(res, job);
}

export async function pollAll(req: Request, res: Response): Promise<void> {
  const account = req.account as IAccount;
  const job = await pollJobService.enqueueAllSitesPoll(account._id);
  created(res, job);
}
