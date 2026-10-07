import { Router } from 'express';
import * as workController from '../controllers/work.controller';
import { validate } from '../middlewares/validate.middleware';
import { listWorksQuerySchema } from '../validators/work.validator';
import { asyncHandler } from '../utils/asyncHandler';

// Fully public -- E1/E2/E3: a Visitor browses, views detail, and downloads
// TOR documents without logging in.
export const workRouter = Router();

workRouter.get('/', validate(listWorksQuerySchema, 'query'), asyncHandler(workController.list));
// Before '/:id', or "fiscal-years" would be read as a work id.
workRouter.get('/fiscal-years', asyncHandler(workController.fiscalYears));
workRouter.get('/:id', asyncHandler(workController.getById));
workRouter.get('/:id/tor/:index', asyncHandler(workController.downloadTorFile));
