import { IngestionRun, IIngestionRun, IngestionSource, IngestionRunStatus } from '../models/ingestionRun.model';
import { AppError } from '../utils/AppError';

export interface ListRunsFilter {
  siteId?: string;
  source?: IngestionSource;
  status?: IngestionRunStatus;
  /** Inclusive range over startedAt, as YYYY-MM-DD in the server's local date. */
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export interface ListRunsResult {
  items: IIngestionRun[];
  total: number;
  page: number;
  pageSize: number;
}

// FR-N1.7: run history, viewable and filterable by site (and here, also by
// source and status, since RSS vs data.go.th runs behave very differently).
export async function listIngestionRuns(filter: ListRunsFilter = {}): Promise<ListRunsResult> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filter.pageSize ?? 20));

  const query: Record<string, unknown> = {};
  if (filter.siteId) query.siteId = filter.siteId;
  if (filter.source) query.source = filter.source;
  if (filter.status) query.status = filter.status;
  if (filter.startDate || filter.endDate) {
    const startedAt: Record<string, Date> = {};
    if (filter.startDate) startedAt.$gte = new Date(`${filter.startDate}T00:00:00.000Z`);
    if (filter.endDate) startedAt.$lte = new Date(`${filter.endDate}T23:59:59.999Z`);
    query.startedAt = startedAt;
  }

  const [items, total] = await Promise.all([
    IngestionRun.find(query)
      .sort({ startedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate('siteId', 'name shortCode'),
    IngestionRun.countDocuments(query)
  ]);

  return { items, total, page, pageSize };
}

export async function getIngestionRunById(id: string): Promise<IIngestionRun> {
  const run = await IngestionRun.findById(id).populate('siteId', 'name shortCode');
  if (!run) throw AppError.notFound('Ingestion run not found.');
  return run;
}
