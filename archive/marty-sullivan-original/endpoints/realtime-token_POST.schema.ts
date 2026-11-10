import { z } from "zod";

export const schema = z.object({}).default({});
export type InputType = z.infer<typeof schema>;