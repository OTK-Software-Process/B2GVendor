import { Request, Response } from 'express';
import * as tagService from '../services/tag.service';
import { ok, created } from '../utils/apiResponse';
import { CheckDuplicatesInput, CreateTagInput, UpdateTagInput } from '../validators/tag.validator';
import { TagFacet } from '../models/tag.model';

export async function list(req: Request, res: Response): Promise<void> {
  const { facet, includeRetired } = req.query as { facet?: TagFacet; includeRetired?: boolean };
  const tags = await tagService.listTags({ facet, includeRetired });
  ok(res, tags);
}

// Admin view: includes usage counts and (optionally) retired tags.
export async function listAdmin(req: Request, res: Response): Promise<void> {
  const { facet, includeRetired, search } = req.query as {
    facet?: TagFacet;
    includeRetired?: boolean;
    search?: string;
  };
  ok(res, await tagService.listAdminTags({ facet, includeRetired, search }));
}

export async function checkDuplicates(req: Request, res: Response): Promise<void> {
  const { name, aliases, facet, excludeId } = req.body as CheckDuplicatesInput;
  ok(res, await tagService.findTagConflicts({ name, aliases, facet, excludeId }));
}

export async function create(req: Request, res: Response): Promise<void> {
  const { name, facet, aliases, includeInIngestionFilter, confirmNearDuplicate } = req.body as CreateTagInput;
  const tag = await tagService.createTag(name, facet, { aliases, includeInIngestionFilter, confirmNearDuplicate });
  created(res, tag);
}

export async function update(req: Request, res: Response): Promise<void> {
  const tag = await tagService.updateTag(req.params.id, req.body as UpdateTagInput);
  ok(res, tag);
}

export async function retire(req: Request, res: Response): Promise<void> {
  const tag = await tagService.retireTag(req.params.id);
  ok(res, tag);
}

export async function reactivate(req: Request, res: Response): Promise<void> {
  const tag = await tagService.reactivateTag(req.params.id);
  ok(res, tag);
}

export async function setIngestionFilter(req: Request, res: Response): Promise<void> {
  const { value } = req.body as { value: boolean };
  const tag = await tagService.setIngestionFilter(req.params.id, value);
  ok(res, tag);
}
