import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 3000),
  baseUrl: process.env.BASE_URL ?? "http://localhost:3000",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@127.0.0.1:5432/brandlayer",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  devApiKey: process.env.DEV_API_KEY ?? "dev-secret",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  /** "gemini" | "openai" | "mock" | "" (auto: gemini → openai → mock) */
  imageProvider: process.env.IMAGE_PROVIDER ?? "",
  clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? "",
  clerkSecretKey: process.env.CLERK_SECRET_KEY ?? "",
  /** Claude handles brand extraction when set (best quality for the core IP step). */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  storageDir: process.env.STORAGE_DIR ?? "./storage",
};

/** Seeded by src/db/schema.sql; DEV_API_KEY maps to this user. */
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";
