/**
 * gRPC Server
 *
 * Sets up and runs the gRPC server for CaptureService.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ReflectionService } from "@grpc/reflection";
import type { ServerConfig } from "../config/index.js";
import { createCaptureServiceHandlers } from "./handlers.js";
import { WorkerPool } from "../capture/worker-pool.js";
import { logger } from "../logger.js";
import { CaptureServiceService } from "./generated/browserhive/v1/capture.js";

/**
 * Timeout for tryShutdown before falling back to forceShutdown.
 * tryShutdown waits for all HTTP/2 connections to close, which can hang
 * indefinitely if a client connection lingers.
 */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 4000;

const currentDir = dirname(fileURLToPath(import.meta.url));
// Navigate from dist/src/grpc to project root, then to src/grpc/proto
const projectRoot = join(currentDir, "..", "..", "..");
const PROTO_PATH = join(projectRoot, "src", "grpc", "proto", "browserhive", "v1", "capture.proto");

/** Load proto definition for reflection service (grpcurl support) */
const loadProtoDefinitionForReflection = () => {
  return protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });
};

export class CaptureServer {
  private server: grpc.Server;
  private workerPool: WorkerPool | null = null;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
    this.server = new grpc.Server();
  }

  async initialize(): Promise<void> {
    this.workerPool = new WorkerPool(this.config.worker);
    await this.workerPool.initialize();

    const handlers = createCaptureServiceHandlers(this.workerPool);

    // Use ts-proto generated service definition
    this.server.addService(CaptureServiceService, {
      submitCapture: handlers.submitCapture,
      getStatus: handlers.getStatus,
    });

    // Add reflection service for grpcurl and other tools
    const packageDefinition = loadProtoDefinitionForReflection();
    const reflection = new ReflectionService(packageDefinition);
    reflection.addToServer(this.server);
  }

  /**
   * Create server credentials based on TLS config
   */
  private createCredentials(): grpc.ServerCredentials {
    const tlsConfig = this.config.tls;

    if (!tlsConfig?.enabled) {
      logger.info("Starting server in insecure mode");
      return grpc.ServerCredentials.createInsecure();
    }

    logger.info({ certPath: tlsConfig.certPath }, "Starting server with TLS");

    const privateKey = readFileSync(tlsConfig.keyPath);
    const certChain = readFileSync(tlsConfig.certPath);

    return grpc.ServerCredentials.createSsl(
      null, // CA certificate (null for server-only authentication)
      [{ private_key: privateKey, cert_chain: certChain }],
      false // Client certificate not required
    );
  }

  async start(): Promise<void> {
    const address = `0.0.0.0:${String(this.config.port)}`;
    const credentials = this.createCredentials();

    return new Promise((resolve, reject) => {
      this.server.bindAsync(
        address,
        credentials,
        (error, port) => {
          if (error) {
            reject(error);
            return;
          }
          logger.info(
            { port, tls: this.config.tls?.enabled ?? false },
            "gRPC server started"
          );
          resolve();
        }
      );
    });
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down gRPC server");

    if (this.workerPool) {
      await this.workerPool.shutdown();
    }

    // Shutdown gRPC server with timeout fallback to forceShutdown
    return new Promise((resolve) => {
      let settled = false;

      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        logger.warn(
          { timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS },
          "tryShutdown timed out, forcing shutdown"
        );
        this.server.forceShutdown();
        resolve();
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

      this.server.tryShutdown((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (error) {
          logger.error({ err: error }, "Error during server shutdown");
        }
        logger.info("gRPC server shut down");
        resolve();
      });
    });
  }
}
