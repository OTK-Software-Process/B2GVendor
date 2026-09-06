import { Request, Response } from 'express';
import * as tagService from '../services/tag.service';
import { ok, created } from '../utils/apiResponse';
import { CreateTagInput } from '../validators/tag.validator';
import { TagFacet } from '../models/tag.model';

export async function list(req: Request, res: Response): Promise<void> {
  const { facet, includeRetired } = req.query as { facet?: TagFacet; includeRetired?: boolean };
  const tags = await tagService.listTags({ facet, includeRetired });
  ok(res, tags);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { name, facet, aliases } = req.body as CreateTagInput;
  const tag = await tagService.createTag(name, facet, aliases);
  created(res, tag);
}

export async function retire(req: Request, res: Response): Promise<void> {
  const tag = await tagService.retireTag(req.params.id);
  ok(res, tag);
}
