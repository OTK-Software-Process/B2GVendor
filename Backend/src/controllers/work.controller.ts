import { Request, Response } from 'express';
import * as workService from '../services/work.service';
import { ok } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';
import { isStoredPdf, resolveTorFilePath, torFileExists } from '../services/fileStorage.service';
import { safePdfFilename } from '../utils/pdfFile';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await workService.listWorks(req.query as workService.ListWorksFilter);
  ok(res, result);
}

export async function fiscalYears(_req: Request, res: Response): Promise<void> {
  ok(res, await workService.listFiscalYears());
}

export async function getById(req: Request, res: Response): Promise<void> {
  const work = await workService.getWorkById(req.params.id);
  ok(res, work);
}

// How long a client is told to wait before asking again for a TOR file whose
// source link is dead: the retry sweep tries it again on the next poll.
const TOR_RETRY_AFTER_SECONDS = 60 * 60;

// GET /works/:id/tor/:index -- serves a downloaded TOR PDF by its position
// in the work's torFiles array. An 'html' link has no file to serve here by
// design (see egpRss.client.ts) -- callers should follow sourceUrl instead.
export async function downloadTorFile(req: Request, res: Response): Promise<void> {
  const work = await workService.getWorkById(req.params.id);
  // A plain array position only: "1e0", "0x0", "-1", " 1" or "1.5" are not one.
  const index = /^\d{1,4}$/.test(req.params.index) ? Number(req.params.index) : -1;
  const file = index >= 0 ? work.torFiles[index] : undefined;

  if (!file) throw AppError.notFound('TOR file not found.');
  if (!file.storageKey) {
    if (file.linkType === 'pdf' || file.linkType === 'zip') {
      // A document the government site linked to but we couldn't download (the
      // link is dead right now). It is logged in the admin run history and
      // retried on every poll -- so: temporarily unavailable, not "not found".
      res.setHeader('Retry-After', String(TOR_RETRY_AFTER_SECONDS));
      throw AppError.serviceUnavailable('This TOR document is temporarily unavailable: the government site did not deliver it. It will be retried on the next update.');
    }
    throw AppError.notFound(
      file.linkType === 'html'
        ? 'This TOR is only available as a page on the government site, not a downloadable file.'
        : 'This TOR file is not available for download.'
    );
  }
  if (!(await torFileExists(file.storageKey))) {
    throw AppError.notFound('TOR file is missing from storage.');
  }
  // Only ever a PDF goes out, as a PDF: never typed from the (remote) file name.
  if (!(await isStoredPdf(file.storageKey))) {
    throw AppError.notFound('TOR file is not available.');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(resolveTorFilePath(file.storageKey), safePdfFilename(file.filename), {
    headers: { 'Content-Type': 'application/pdf' }
  });
}
