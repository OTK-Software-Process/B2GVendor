import { z } from 'zod';

const businessProfileSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required').max(200),
  taxId: z.string().trim().regex(/^\d{13}$/, 'Tax ID must be exactly 13 digits')
});

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(150),
    email: z.string().trim().toLowerCase().email('Invalid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Za-z]/, 'Password must contain at least one letter')
      .regex(/\d/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
    type: z.enum(['individual', 'business']).default('individual'),
    businessProfile: businessProfileSchema.optional()
  })
  .refine(data => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword']
  })
  .refine(data => data.type !== 'business' || !!data.businessProfile, {
    message: 'Business accounts require companyName and taxId',
    path: ['businessProfile']
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

export type LoginInput = z.infer<typeof loginSchema>;
