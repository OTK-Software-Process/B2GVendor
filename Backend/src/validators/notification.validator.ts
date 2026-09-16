import { z } from 'zod';

export const notificationIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid notification ID')
}).strict();
