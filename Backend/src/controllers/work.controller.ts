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

// GET /works/:id/tor/:index -- serves a downloaded TOR PDF by its position
// in the work's torFiles array. An 'html' link has no file to serve here by
// design (see egpRss.client.ts) -- callers should follow sourceUrl instead.
export async function downloadTorFile(req: Request, res: Response): Promise<void> {
  const work = await workService.getWorkById(req.params.id);
  const index = Number(req.params.index);
  const file = work.torFiles[index];

  if (!file) throw AppError.notFound('TOR file not found.');
  if (!file.storageKey) {
    throw AppError.notFound(
      file.linkType === 'html'
        ? 'This TOR is only available as a page on the government site, not a downloadable file.'
        : 'This TOR file has not been downloaded yet.'
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
