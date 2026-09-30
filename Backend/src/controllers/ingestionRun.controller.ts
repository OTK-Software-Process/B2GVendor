import { Request, Response } from 'express';
import * as ingestionRunService from '../services/ingestionRun.service';
import * as pollJobService from '../services/pollJob.service';
import { ok } from '../utils/apiResponse';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await ingestionRunService.listIngestionRuns(req.query as ingestionRunService.ListRunsFilter);
  ok(res, result);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const run = await ingestionRunService.getIngestionRunById(req.params.id);
  ok(res, run);
}

export async function getPollJob(req: Request, res: Response): Promise<void> {
  const job = await pollJobService.getPollJob(req.params.id);
  ok(res, job);
}

// Is a poll queued/running right now? Server-side truth, so every admin's
// "Poll Now" button (and a page refresh) agrees.
export async function getStatus(_req: Request, res: Response): Promise<void> {
  ok(res, await pollJobService.getPollStatus());
}
