import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  APP_URL: z.string().url().default("http://localhost:3000"),
  STORAGE_ADAPTER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  EMAIL_ADAPTER: z.enum(["log", "smtp"]).default("log"),
  EMAIL_FROM: z.string().default("ops@example.com"),
  ESIGN_ADAPTER: z.enum(["mock"]).default("mock"),
  LISTING_API_KEY: z.string().min(8).default("dev-listing-api-key"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
});

let cached: z.infer<typeof envSchema> | null = null;

export function config() {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}
