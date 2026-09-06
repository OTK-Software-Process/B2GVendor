import { Router } from 'express';
import { authRouter } from './auth.routes';
import { passwordRouter } from './password.routes';
import { accountRouter } from './account.routes';
import { adminRouter } from './admin.routes';
import { tagRouter } from './tag.routes';
import { workRouter } from './work.routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/auth', passwordRouter);
apiRouter.use('/account', accountRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/tags', tagRouter);
apiRouter.use('/works', workRouter);
