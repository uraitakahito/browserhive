/**
 * Server bootstrap (composition root).
 *
 * Assembles the concrete pieces — a `CaptureCoordinator` and the `HttpServer` —
 * from a resolved config and starts them, returning a shutdown handle. Kept
 * separate from CLI parsing (`src/cli/server-cli.ts`) and the HTTP transport
 * (`src/http/http-server.ts`): this is the single place that decides *what* to
 * construct and *how* to wire it together.
 */
import { CaptureCoordinator } from "./capture/index.js";
import type { BrowserHiveConfig } from "./config/index.js";
import { HttpServer } from "./http/http-server.js";
import { logger } from "./logger.js";

/** Server control interface */
export interface ServerControl {
  shutdown: () => Promise<void>;
}

export const startServer = async (
  config: BrowserHiveConfig,
): Promise<ServerControl> => {
  const coordinator = new CaptureCoordinator(config.coordinator);
  const server = new HttpServer(coordinator, config.http);

  await server.initialize();
  await server.start();

  return {
    shutdown: async (): Promise<void> => {
      logger.info("Received shutdown signal");
      await server.shutdown();
    },
  };
};
