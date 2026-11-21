import { Router } from 'express';
import * as workController from '../controllers/work.controller';
import { validate } from '../middlewares/validate.middleware';
import { listWorksQuerySchema, workParamsSchema, torFileParamsSchema } from '../validators/work.validator';
import { asyncHandler } from '../utils/asyncHandler';
import { searchLimiter } from '../middlewares/rateLimit.middleware';

// Fully public -- E1/E2/E3: a Visitor browses, views detail, and downloads
// TOR documents without logging in.
export const workRouter = Router();

// Search is rate-limited per client address (ASVS V2.4.1); the rest are cheap lookups by id.
workRouter.get('/', searchLimiter, validate(listWorksQuerySchema, 'query'), asyncHandler(workController.list));
// Before '/:id', or "fiscal-years" would be read as a work id.
workRouter.get('/fiscal-years', asyncHandler(workController.fiscalYears));
workRouter.get('/:id', validate(workParamsSchema, 'params'), asyncHandler(workController.getById));
workRouter.get('/:id/tor/:index', validate(torFileParamsSchema, 'params'), asyncHandler(workController.downloadTorFile));
