import { createApp } from "./app.js";
import { createContainer } from "./container.js";

const container = createContainer();
await container.bootstrap();
container.startScheduler();
const app = createApp(container);

container.logger.info(`FontInAss v2 listening on port ${container.config.port}`);
container.logger.info(`Font directory: ${container.config.fontDirectory}`);
container.logger.info(`Database: ${container.config.databasePath}`);

const shutdown = (signal: string) => {
  container.logger.info(`Received ${signal}; shutting down`);
  container.stopScheduler();
  container.close();
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default {
  port: container.config.port,
  fetch: app.fetch,
  // Public submissions have strict product limits. Trusted member/admin uploads are
  // intentionally outside that policy, with only a high operational body ceiling.
  maxRequestBodySize: Math.max(
    container.config.publicUploadMaxBatchSize,
    container.config.archiveMaxFileSize,
    container.config.subsetMaxBatchSize,
  ) + 2 * 1024 * 1024,
};
