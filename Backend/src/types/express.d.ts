import { IAccount } from '../models/account.model';
import { ISession } from '../models/session.model';

declare global {
  namespace Express {
    interface Request {
      account?: IAccount;
      authSession?: ISession;
    }
  }
}

export {};
