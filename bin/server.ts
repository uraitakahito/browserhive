#!/usr/bin/env npx tsx
/**
 * Server CLI Entry Point
 *
 * Usage:
 *   npx tsx bin/server.ts [options]
 */
import {
  parseCliOptions,
  logServerConfig,
  startServer,
} from "../src/cli/server-cli.js";
import { logger } from "../src/logger.js";

const main = async (): Promise<void> => {
  const config = parseCliOptions(process.argv);
  logServerConfig(config);

  const { shutdown } = await startServer(config);

  const handleShutdown = (): void => {
    void shutdown().then(() => process.exit(0));
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  logger.info("Server is ready to accept requests");
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Fatal error");
  process.exit(1);
});
