import { GovSite, IGovSite, AnnounceType } from '../models/govSite.model';
import { Tag } from '../models/tag.model';
import { AppError } from '../utils/AppError';

export interface CreateGovSiteInput {
  name: string;
  nameEn?: string;
  shortCode: string;
  deptId: string;
  announceTypes?: AnnounceType[];
  dataGoThOrgSlug?: string;
  dataGoThResourceId?: string;
  requestsPerMinute?: number;
  pollIntervalMinutes?: number;
}

export type UpdateGovSiteInput = Partial<CreateGovSiteInput> & { enabled?: boolean };

export async function listGovSites(): Promise<IGovSite[]> {
  return GovSite.find().sort({ createdAt: 1 });
}

export async function getGovSiteById(id: string): Promise<IGovSite> {
  const site = await GovSite.findById(id);
  if (!site) throw AppError.notFound('Government site not found.');
  return site;
}

// FR-2.10 / N3: adding a government site auto-creates its followable "site"
// tag, so it's a first-class facet immediately, with no separate admin step.
async function ensureSiteTag(site: IGovSite): Promise<void> {
  await Tag.updateOne(
    { facet: 'site', siteId: site._id },
    { $setOnInsert: { name: site.name, facet: 'site', aliases: [site.shortCode], siteId: site._id, retired: false } },
    { upsert: true }
  );
}

export async function createGovSite(input: CreateGovSiteInput): Promise<IGovSite> {
  const site = await GovSite.create({
    name: input.name,
    nameEn: input.nameEn,
    shortCode: input.shortCode,
    deptId: input.deptId,
    announceTypes: input.announceTypes,
    dataGoThOrgSlug: input.dataGoThOrgSlug,
    dataGoThResourceId: input.dataGoThResourceId,
    requestsPerMinute: input.requestsPerMinute,
    pollIntervalMinutes: input.pollIntervalMinutes
  });

  await ensureSiteTag(site);
  return site;
}

export async function updateGovSite(id: string, input: UpdateGovSiteInput): Promise<IGovSite> {
  const site = await GovSite.findByIdAndUpdate(id, input, { new: true, runValidators: true });
  if (!site) throw AppError.notFound('Government site not found.');
  return site;
}
