import { createApp } from "./app.js";
import { createContainer } from "./container.js";

const container = createContainer();
await container.bootstrap();
container.startScheduler();
const app = createApp(container);

container.logger.info(`FontInAss v2 listening on port ${container.config.port}`);
container.logger.info(`Font directory: ${container.config.fontDirectory}`);
container.logger.info(`Database: ${container.config.databasePath}`);

const server = Bun.serve({
  port: container.config.port,
  fetch: app.fetch,
  // Public submissions have strict product limits. Trusted member/admin uploads are
  // intentionally outside that policy, with only a high operational body ceiling.
  maxRequestBodySize: Math.max(
    container.config.publicUploadMaxBatchSize,
    container.config.archiveMaxFileSize,
    container.config.subsetMaxBatchSize,
  ) + 2 * 1024 * 1024,
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  container.logger.info(`Received ${signal}; draining requests`);
  container.stopScheduler();
  const deadline = setTimeout(() => process.exit(1), 35_000);
  deadline.unref();
  await server.stop(false);
  while (container.getSchedulerStatus().running) await Bun.sleep(50);
  container.close();
  clearTimeout(deadline);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
