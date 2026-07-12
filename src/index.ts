import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { applySchema } from "./db/migrate.js";
import { env } from "./lib/env.js";
import { hasUnsafeDevSecret, isOriginAllowed, parseAllowedOrigins } from "./lib/security.js";
import { registerMcp } from "./mcp/server.js";
import { registerRoutes } from "./routes/index.js";

const isProduction = process.env.NODE_ENV === "production";

const app = Fastify({
  logger: { level: isProduction ? "info" : "debug" },
  bodyLimit: 25 * 1024 * 1024,
});

// ── CORS: allowlist in production, permissive in dev ──
const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS, isProduction);

await app.register(cors, {
  origin: allowedOrigins === null
    ? true // dev: reflect any origin
    : (origin, cb) => {
        const ok = isOriginAllowed(origin, allowedOrigins);
        if (!ok) app.log.warn({ origin, allowed: allowedOrigins }, "[cors] rejected");
        cb(null, ok);
      },
  credentials: true,
});

// ── Security headers ──
await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
});

// ── Rate limiting: per IP, 100 req/min ──
await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

// ── Dev-secret production gate: reject dev-secret in production ──
if (hasUnsafeDevSecret(isProduction, env.devApiKey)) {
  app.log.error("[brandlayer] FATAL: DEV_API_KEY is 'dev-secret' in production. Set a real key or unset it.");
  process.exit(1);
}

// ── DB: graceful retry instead of instant crash ──
const MAX_DB_RETRIES = 3;
const DB_RETRY_DELAY = 5000;
for (let attempt = 1; attempt <= MAX_DB_RETRIES; attempt++) {
  try {
    await applySchema();
    break;
  } catch (err) {
    app.log.error(
      `[brandlayer] DB connection failed (attempt ${attempt}/${MAX_DB_RETRIES}): ${(err as Error).message}`,
    );
    if (attempt === MAX_DB_RETRIES) {
      app.log.error("[brandlayer] All DB connection attempts exhausted. Exiting.");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, DB_RETRY_DELAY * attempt));
  }
}

await registerRoutes(app);
await registerMcp(app);

try {
  await app.listen({ port: env.port, host: "0.0.0.0" });
  console.log(`[brandlayer] API on ${env.baseUrl}  (REST: /api/v1, MCP: /api/mcp)`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
