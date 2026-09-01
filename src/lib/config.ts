import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  APP_URL: z.string().url().default("http://localhost:3000"),
  STORAGE_ADAPTER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  EMAIL_ADAPTER: z.enum(["log", "smtp"]).default("log"),
  EMAIL_FROM: z.string().default("ops@example.com"),
  ESIGN_ADAPTER: z.enum(["mock"]).default("mock"),
  LISTING_API_KEY: z.string().min(8).default("dev-listing-api-key"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
});

/**
 * When STORAGE_ADAPTER=s3 the S3_* values stop being optional. Validating here
 * means a misconfigured deployment fails at boot with a readable message rather
 * than at the moment someone uploads a photo.
 */
const configSchema = envSchema.superRefine((env, ctx) => {
  if (env.STORAGE_ADAPTER !== "s3") return;
  for (const key of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
    if (!env[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when STORAGE_ADAPTER="s3"`,
      });
    }
  }
});

let cached: z.infer<typeof configSchema> | null = null;

export function config() {
  if (!cached) cached = configSchema.parse(process.env);
  return cached;
}
