import { z } from "zod";
export const schema = z.object({ script: z.string().trim().min(1).max(4000) });
export type InputType = z.infer<typeof schema>;