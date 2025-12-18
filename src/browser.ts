/**
 * Remote Browser Connection Module
 *
 * This module provides a custom implementation for connecting to a remote
 * browser (Chromium) in Docker environments.
 *
 * ## Why is a custom implementation needed?
 *
 * Puppeteer's standard `browserURL` option cannot connect using hostnames
 * in Docker environments. This is due to Chromium's security features.
 *
 * ### Problem 1: Host header validation for DNS Rebinding attack prevention
 *
 * Since Chrome v66, remote debugging endpoints (/json/version, etc.) validate
 * the Host header of HTTP requests to prevent DNS Rebinding attacks.
 * Only the following are allowed:
 * - localhost
 * - IP addresses (e.g., 127.0.0.1, 192.168.1.1)
 *
 * When using a service name in Docker (e.g., `puppeteer`):
 * ```
 * GET /json/version HTTP/1.1
 * Host: puppeteer:9222  <- This gets rejected
 * ```
 * Result: HTTP 500 Internal Server Error
 *
 * ### Problem 2: webSocketDebuggerUrl hostname is fixed to localhost
 *
 * The webSocketDebuggerUrl returned by /json/version always contains localhost:
 * ```json
 * {
 *   "webSocketDebuggerUrl": "ws://localhost/devtools/browser/xxxx"
 * }
 * ```
 * Using this URL as-is won't resolve when connecting from another container.
 *
 * ### Solution
 *
 * 1. Explicitly add `Host: localhost` header to HTTP requests
 * 2. Replace the host part of the retrieved webSocketDebuggerUrl with the actual target host
 *
 * ### Why use http module instead of fetch?
 *
 * Node.js's `fetch` API does not allow overriding the `Host` header.
 * This is a restriction based on the HTTP specification. To freely set
 * the `Host` header, we need to use the low-level `http` module.
 *
 * @see https://github.com/nicholasdower/chrome-startup/issues/3
 * @see https://bugs.chromium.org/p/chromium/issues/detail?id=813540
 */
import http from "node:http";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser } from "puppeteer";
import type { BrowserOptions } from "./config/index.js";
import { DEFAULT_BROWSER_SLOW_MO_MS } from "./config/index.js";

// Apply stealth plugin to avoid bot detection
puppeteer.use(StealthPlugin());

interface VersionResponse {
  webSocketDebuggerUrl: string;
}

/**
 * Send an HTTP request and retrieve a JSON response
 *
 * Since Node.js's fetch API does not allow overriding the Host header,
 * we use the low-level http module to send the request.
 *
 * @param hostname - Target hostname
 * @param port - Target port number
 * @param path - Request path
 * @returns JSON-parsed response
 */
const httpGetJson = <T>(hostname: string, port: number, path: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname,
      port,
      path,
      method: "GET",
      // Set Host: localhost to bypass Chromium's DNS Rebinding protection
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { Host: "localhost" },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${String(res.statusCode)}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data) as T);
        } catch {
          reject(new Error(`Failed to parse JSON: ${data}`));
        }
      });
    });

    req.on("error", (err) => {
      reject(new Error(`HTTP request failed: ${err.message}`));
    });

    req.end();
  });
};

/**
 * Retrieve the WebSocket endpoint from browserURL
 *
 * Reasons for making HTTP requests ourselves instead of using
 * Puppeteer's standard implementation (browserURL option):
 *
 * - Add Host: localhost header to pass Chromium's security check
 * - Replace the host part of the returned webSocketDebuggerUrl with the actual target
 *
 * @param browserURL - Remote browser URL (e.g., http://puppeteer:9222)
 * @returns Connectable WebSocket endpoint URL
 */
/**
 * Replace the host in a WebSocket URL with the actual target host
 *
 * @param wsUrl - Original WebSocket URL (e.g., ws://localhost/devtools/browser/xxx)
 * @param targetHost - Target host to use (e.g., puppeteer:9222)
 * @returns WebSocket URL with replaced host
 */
export const replaceWsUrlHost = (wsUrl: string, targetHost: string): string => {
  const wsUrlObj = new URL(wsUrl);
  wsUrlObj.host = targetHost;
  return wsUrlObj.toString();
};

const fetchWebSocketEndpoint = async (browserURL: string): Promise<string> => {
  const url = new URL(browserURL);
  const targetHost = url.host; // e.g., "puppeteer:9222"
  const port = url.port ? parseInt(url.port, 10) : 9222;

  const data = await httpGetJson<VersionResponse>(url.hostname, port, "/json/version");
  const wsUrl = data.webSocketDebuggerUrl;

  // Replace the host part of webSocketDebuggerUrl with the actual target host
  // Example: ws://localhost/devtools/browser/xxx
  //        -> ws://puppeteer:9222/devtools/browser/xxx
  return replaceWsUrlHost(wsUrl, targetHost);
};

const connectBrowser = async (options: BrowserOptions): Promise<Browser> => {
  const { browserURL, slowMo = DEFAULT_BROWSER_SLOW_MO_MS } = options;
  const wsEndpoint = await fetchWebSocketEndpoint(browserURL);

  return puppeteer.connect({
    browserWSEndpoint: wsEndpoint,
    slowMo,
  });
};

export default connectBrowser;
