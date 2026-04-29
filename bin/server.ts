#!/usr/bin/env npx tsx
/**
 * Server CLI Entry Point
 */
import {
  parseCliOptions,
  logServerConfig,
  startServer,
  formatInitFailure,
} from "../src/cli/server-cli.js";
import { logger } from "../src/logger.js";

/**
 * Hard deadline for process exit.
 * If graceful shutdown hasn't completed by this time, force exit.
 * Must be greater than the sum of inner timeouts
 * (WorkerPool drain 5s + gRPC tryShutdown 4s = 9s).
 */
const HARD_EXIT_TIMEOUT_MS = 10000;

const main = async (): Promise<void> => {
  const config = parseCliOptions(process.argv);
  logServerConfig(config);

  const startResult = await startServer(config);
  if (!startResult.ok) {
    logger.fatal(
      { failure: startResult.error },
      formatInitFailure(startResult.error),
    );
    process.exit(1);
  }
  const { shutdown } = startResult.value;

  let shutdownInProgress = false;

  const handleShutdown = (): void => {
    if (shutdownInProgress) {
      logger.warn("Forced exit by second signal");
      process.exit(1);
    }

    shutdownInProgress = true;

    // Safety net: force exit if graceful shutdown hangs
    setTimeout(() => {
      logger.error("Shutdown deadline exceeded, forcing process exit");
      process.exit(1);
    }, HARD_EXIT_TIMEOUT_MS).unref();

    shutdown().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, "Error during shutdown");
        process.exit(1);
      },
    );
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  logger.info("Server is ready to accept requests");
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Fatal error");
  process.exit(1);
});
