import { z } from 'zod';

export const emailSchema = z.string().trim().email();

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
