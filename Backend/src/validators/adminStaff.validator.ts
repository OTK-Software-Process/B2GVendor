import { z } from 'zod';
import { PERMISSIONS } from '../models/account.model';
import { nameSchema, phoneSchema } from './adminAccount.validator';

// What an Admin is allowed to do -- the same three role names the rest of the
// admin panel is gated by (see PERMISSIONS in account.model.ts).
export const permissionSchema = z.enum(PERMISSIONS, {
  errorMap: () => ({ message: 'Choose Poll Admin, Tag Admin or Poll and Tag Admin' })
});

export const listStaffQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    status: z.enum(['active', 'suspended']).optional(),
    role: z.enum(['admin', 'superadmin']).optional(),
    sort: z.enum(['newest', 'oldest', 'name']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional()
  })
  .strict();

// The account role is NOT accepted: this API only ever creates plain Admins
// (what they may do is the required `permission`). As with vendors, nobody
// chooses the new staff member's password -- they are emailed a link to set
// their own.
export const createAdminSchema = z
  .object({
    name: nameSchema,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^\S+$/, 'Email cannot contain spaces')
      .email('Invalid email address'),
    phone: phoneSchema.optional(),
    permission: permissionSchema
  })
  .strict();

export type CreateAdminInput = z.infer<typeof createAdminSchema>;

// Email and the account role are identity/privilege: they cannot be changed
// here (what the Admin may do, `permission`, can). `phone: null` clears the
// phone number.
export const updateAdminSchema = z
  .object({
    name: nameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    permission: permissionSchema.optional()
  })
  .strict()
  .refine(v => v.name !== undefined || v.phone !== undefined || v.permission !== undefined, {
    message: 'Nothing to update',
    path: ['name']
  });

export type UpdateAdminInput = z.infer<typeof updateAdminSchema>;
