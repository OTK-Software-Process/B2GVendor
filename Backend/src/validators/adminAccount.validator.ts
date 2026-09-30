import { z } from 'zod';
import { NAME_REGEX } from './auth.validator';

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(150)
  .regex(NAME_REGEX, 'Name can only contain letters, hyphens, and apostrophes, with at most one space');

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+66|0)[\d\-\s]{8,12}$/, 'Invalid Thai phone number');

const businessProfileSchema = z
  .object({
    companyName: z.string().trim().min(1, 'Company name is required').max(200),
    taxId: z.string().trim().regex(/^\d{13}$/, 'Tax ID must be exactly 13 digits')
  })
  .strict();

export const listVendorsQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    status: z.enum(['active', 'suspended']).optional(),
    type: z.enum(['individual', 'business']).optional(),
    sort: z.enum(['newest', 'oldest', 'name']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional()
  })
  .strict();

// The admin never chooses a password: the vendor receives an email with a
// link to set their own.
export const createVendorSchema = z
  .object({
    name: nameSchema,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^\S+$/, 'Email cannot contain spaces')
      .email('Invalid email address'),
    phone: phoneSchema.optional(),
    type: z.enum(['individual', 'business']).default('individual'),
    businessProfile: businessProfileSchema.optional()
  })
  .strict()
  .refine(data => data.type !== 'business' || !!data.businessProfile, {
    message: 'Business accounts require companyName and taxId',
    path: ['businessProfile']
  })
  .refine(data => data.type !== 'individual' || !data.businessProfile, {
    message: 'Only business accounts have a business profile',
    path: ['businessProfile']
  });

export type CreateVendorInput = z.infer<typeof createVendorSchema>;

// Email and account type are identity: they cannot be changed here.
// `phone: null` clears the phone number.
export const updateVendorSchema = z
  .object({
    name: nameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    businessProfile: businessProfileSchema.optional()
  })
  .strict()
  .refine(v => v.name !== undefined || v.phone !== undefined || v.businessProfile !== undefined, {
    message: 'Nothing to update',
    path: ['name']
  });

export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
