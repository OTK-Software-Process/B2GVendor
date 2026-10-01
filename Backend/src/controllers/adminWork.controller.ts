import { Request, Response } from 'express';
import * as adminWorkService from '../services/adminWork.service';
import { ok } from '../utils/apiResponse';
import { SetWorkTagsInput } from '../validators/adminWork.validator';

export async function list(req: Request, res: Response): Promise<void> {
  ok(res, await adminWorkService.listAdminWorks(req.query as adminWorkService.AdminWorkListFilter));
}

export async function getById(req: Request, res: Response): Promise<void> {
  ok(res, await adminWorkService.getAdminWork(req.params.id));
}

export async function setTags(req: Request, res: Response): Promise<void> {
  const { tagIds } = req.body as SetWorkTagsInput;
  ok(res, await adminWorkService.setWorkTags(req.params.id, tagIds));
}
