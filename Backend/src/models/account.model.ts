import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';

export type AccountType = 'individual' | 'business';
export type AccountStatus = 'active' | 'suspended';
export type AccountRole = 'user' | 'admin' | 'superadmin';

export interface IBusinessProfile {
  companyName: string;
  taxId: string;
}

export interface IAccount extends Document {
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  emailVerifiedAt?: Date;

  name: string;
  phone?: string;

  type: AccountType;
  businessProfile?: IBusinessProfile;

  status: AccountStatus;
  role: AccountRole;

  lockedUntil?: Date;
  passwordChangedAt?: Date;

  createdAt: Date;
  updatedAt: Date;

  comparePassword(plain: string): Promise<boolean>;
}

export const STAFF_ROLES: readonly AccountRole[] = ['admin', 'superadmin'] as const;

export function isStaffRole(role: AccountRole): boolean {
  return STAFF_ROLES.includes(role);
}

export function canManageAccount(actorRole: AccountRole, targetRole: AccountRole): boolean {
  if (actorRole === 'superadmin') return true;
  if (actorRole === 'admin') return targetRole === 'user';
  return false;
}

export function canAssignRole(actorRole: AccountRole): boolean {
  return actorRole === 'superadmin';
}

const BusinessProfileSchema = new Schema<IBusinessProfile>(
  {
    companyName: { type: String, required: true, trim: true, maxlength: 200 },
    taxId: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{13}$/, 'Tax ID must be exactly 13 digits'],
    },
  },
  { _id: false }
);

const AccountSchema = new Schema<IAccount>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
    },
    passwordHash: { type: String, required: true, select: false },
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date },

    name: { type: String, required: true, trim: true, maxlength: 150 },
    phone: {
      type: String,
      trim: true,
      match: [/^(\+66|0)[\d\-\s]{8,12}$/, 'Invalid Thai phone number'],
    },

    type: {
      type: String,
      enum: ['individual', 'business'],
      default: 'individual',
      required: true,
      index: true,
    },
    businessProfile: { type: BusinessProfileSchema, required: false },

    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['user', 'admin', 'superadmin'],
      default: 'user',
      required: true,
      index: true,
    },

    lockedUntil: { type: Date, select: false },
    passwordChangedAt: { type: Date, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.passwordHash;
        delete ret.lockedUntil;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

AccountSchema.index({ createdAt: -1 });

AccountSchema.pre('validate', function (next) {
  if (this.type === 'business' && !this.businessProfile) {
    return next(new Error('A business account requires companyName and taxId'));
  }
  if (this.type === 'individual' && this.businessProfile) {
    this.businessProfile = undefined;
  }
  next();
});

AccountSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, env.BCRYPT_ROUNDS);
  this.passwordChangedAt = new Date();
  next();
});

AccountSchema.methods.comparePassword = function (plain: string): Promise<boolean> {
  return bcrypt.compare(plain, this.passwordHash);
};

export const Account: Model<IAccount> =
  mongoose.models.Account || mongoose.model<IAccount>('Account', AccountSchema);
