import Fastify from "fastify";
import cors from "@fastify/cors";
import { applySchema } from "./db/migrate.js";
import { env } from "./lib/env.js";
import { registerMcp } from "./mcp/server.js";
import { registerRoutes } from "./routes/index.js";

const app = Fastify({
  logger: { level: "info" },
  bodyLimit: 25 * 1024 * 1024,
});

await app.register(cors, { origin: true, credentials: true });

await applySchema().catch((err) => {
  console.error(
    "[brandlayer] could not reach Postgres — is Docker running? (docker compose up -d)\n",
    (err as Error).message,
  );
  process.exit(1);
});
await registerRoutes(app);
await registerMcp(app);

try {
  await app.listen({ port: env.port, host: "0.0.0.0" });
  console.log(`[brandlayer] API on ${env.baseUrl}  (REST: /api/v1, MCP: /api/mcp)`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
