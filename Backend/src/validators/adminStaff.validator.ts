import { z } from 'zod';
import { nameSchema, phoneSchema } from './adminAccount.validator';

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

// The role is NOT accepted: this API only ever creates plain Admins. As with
// vendors, nobody chooses the new staff member's password -- they are emailed
// a link to set their own.
export const createAdminSchema = z
  .object({
    name: nameSchema,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^\S+$/, 'Email cannot contain spaces')
      .email('Invalid email address'),
    phone: phoneSchema.optional()
  })
  .strict();

export type CreateAdminInput = z.infer<typeof createAdminSchema>;

// Email and role are identity/privilege: they cannot be changed here.
// `phone: null` clears the phone number.
export const updateAdminSchema = z
  .object({
    name: nameSchema.optional(),
    phone: phoneSchema.nullable().optional()
  })
  .strict()
  .refine(v => v.name !== undefined || v.phone !== undefined, {
    message: 'Nothing to update',
    path: ['name']
  });

export type UpdateAdminInput = z.infer<typeof updateAdminSchema>;
