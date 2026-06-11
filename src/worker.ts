import { applySchema } from "./db/migrate.js";
import { startWorkers } from "./queue/workers.js";

await applySchema().catch((err) => {
  console.error(
    "[brandlayer] could not reach Postgres — is Docker running? (docker compose up -d)\n",
    (err as Error).message,
  );
  process.exit(1);
});
startWorkers();
console.log("[brandlayer] workers running (brand-jobs, image-jobs). Ctrl-C to stop.");
