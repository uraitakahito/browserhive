/**
 * gRPC Capture Submitter
 *
 * Submitter for CaptureService.
 */
import { readFileSync } from "node:fs";
import * as grpc from "@grpc/grpc-js";
import {
  CaptureServiceClient as GeneratedCaptureServiceClient,
  type CaptureRequest,
  type CaptureAcceptance,
} from "./generated/browserhive/v1/capture.js";
import type { ClientTlsConfig } from "../config/index.js";

export class CaptureSubmitter {
  private client: GeneratedCaptureServiceClient | null = null;
  private serverAddress: string;
  private tlsConfig?: ClientTlsConfig;

  constructor(serverAddress: string, tlsConfig?: ClientTlsConfig) {
    this.serverAddress = serverAddress;
    if (tlsConfig) {
      this.tlsConfig = tlsConfig;
    }
  }

  /**
   * Create channel credentials based on TLS config
   */
  private createCredentials(): grpc.ChannelCredentials {
    if (!this.tlsConfig?.enabled) {
      return grpc.credentials.createInsecure();
    }

    const caCert = readFileSync(this.tlsConfig.caCertPath);
    return grpc.credentials.createSsl(caCert);
  }

  /**
   * Connect to the gRPC server
   */
  connect(): void {
    const credentials = this.createCredentials();

    this.client = new GeneratedCaptureServiceClient(
      this.serverAddress,
      credentials
    );
  }

  submit(request: CaptureRequest): Promise<CaptureAcceptance> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error("Client not connected"));
        return;
      }

      this.client.submitCapture(request, (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      });
    });
  }

  close(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }
}

// Re-export types for convenience
export type { CaptureRequest, CaptureAcceptance };
