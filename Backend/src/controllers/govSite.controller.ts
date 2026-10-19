import { Request, Response } from 'express';
import * as govSiteService from '../services/govSite.service';
import * as pollJobService from '../services/pollJob.service';
import { ok, created } from '../utils/apiResponse';
import { CreateGovSiteInput, UpdateGovSiteInput } from '../validators/govSite.validator';
import { IAccount } from '../models/account.model';
import { audit } from '../services/audit.service';

export async function list(_req: Request, res: Response): Promise<void> {
  const sites = await govSiteService.listGovSitesWithWorksCount();
  ok(res, sites);
}

// Admin view of the same list: adds last-run results and the next scheduled run.
export async function listAdmin(_req: Request, res: Response): Promise<void> {
  const sites = await govSiteService.listGovSitesForAdmin();
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

// Not a model write -- a one-off live check an admin runs from the "Add
// Government Site" form before saving, so it is not itself audited (nothing
// persisted to audit a diff of).
export async function verifyDeptId(req: Request, res: Response): Promise<void> {
  const { deptId, announceTypes } = req.body as { deptId: string; announceTypes?: ('P0' | '15' | 'B0' | 'D0' | 'W0' | 'D1' | 'W1' | 'D2' | 'W2')[] };
  const result = await govSiteService.verifyDeptIdLive(deptId, announceTypes ?? ['B0', 'D0']);
  ok(res, result);
}

export async function pollOne(req: Request, res: Response): Promise<void> {
  const { source } = req.body as { source: 'rss' | 'data_go_th' | 'both' };
  const account = req.account as IAccount;
  const site = await govSiteService.getGovSiteById(req.params.id);
  const job = await pollJobService.enqueueSitePoll(req.params.id, source, account._id);
  // Not a GovSite field change, so the auto-capture plugin never sees this --
  // "an admin clicked Poll Now" is logged by hand (FR-N1.9/task: every admin
  // action should show up in the audit trail, not just model edits).
  await audit.log({
    action: 'gov_site.poll',
    entity: { type: 'gov_site', id: site._id, label: site.name },
    metadata: { scope: 'site', source, jobId: job._id }
  });
  created(res, job);
}

export async function pollAll(req: Request, res: Response): Promise<void> {
  const account = req.account as IAccount;
  const job = await pollJobService.enqueueAllSitesPoll(account._id);
  await audit.log({
    action: 'gov_site.poll_all',
    entity: { type: 'gov_site', id: 'all', label: 'All government sites' },
    metadata: { scope: 'all', source: 'both', jobId: job._id }
  });
  created(res, job);
}
