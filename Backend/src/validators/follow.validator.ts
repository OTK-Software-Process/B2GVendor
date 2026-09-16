import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');

export const followTagParamsSchema = z.object({ tagId: objectId }).strict();

export type FollowTagParams = z.infer<typeof followTagParamsSchema>;

export const setTagPausedSchema = z.object({ paused: z.boolean() }).strict();
