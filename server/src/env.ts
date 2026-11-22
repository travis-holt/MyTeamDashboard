import { config } from "dotenv";
import { z } from "zod";
config({ quiet: true });
const dataDir = z.string().min(1).default("./data");
export const readDataDir = () => dataDir.parse(process.env.DATA_DIR);
const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: dataDir,
  DASHBOARD_PASSWORD_HASH: z
    .string()
    .regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, "Expected a bcrypt hash"),
  SESSION_SECRET: z.string().min(32),
  SOURCE_MODE: z.enum(["fixture", "live"]).default("fixture"),
  TZ: z.string().default("Africa/Cairo"),
});
export type Env = z.infer<typeof schema>;
export function readEnv(): Env {
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      "Invalid environment\n" +
        result.error.issues
          .map((issue) => issue.path.join(".") + ": " + issue.message)
          .join("\n"),
    );
  return result.data;
}
