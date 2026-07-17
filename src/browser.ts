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
import dns from "node:dns/promises";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser } from "puppeteer";
import type { BrowserConnectOptions } from "./config/index.js";
import { DEFAULT_BROWSER_SLOW_MO_MS } from "./config/index.js";

// Apply stealth plugin to avoid bot detection
// Disable user-agent-override evasion: BrowserHive sets User-Agent via page.setUserAgent(),
// and this evasion pulls in puppeteer-extra-plugin-user-preferences → user-data-dir → rimraf@3
// which causes npm deprecation warnings (rimraf@3, glob@7, inflight@1).
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('user-agent-override');
puppeteer.use(stealth);

/**
 * Re-export the configured `puppeteer-extra` instance so `BrowserClient` can
 * read its `plugins` array and manually fire `onPageCreated` against the
 * initial Chromium tab obtained via `browser.pages()` at connect time. See
 * `BrowserClient.connect` for the WHY (stealth evasions are otherwise
 * skipped on pre-existing tabs).
 */
export const puppeteerExtra = puppeteer;

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
 * Apply an IP host (already resolved) to a WebSocket URL.
 *
 * Pure / deterministic helper extracted so the host-rewriting logic is
 * unit-testable in isolation (the DNS side-effect lives in
 * `resolveWsUrlHost` instead).
 *
 * IPv6 addresses are wrapped in `[...]` so the URL parser handles them
 * correctly (otherwise the `:` characters in the address are mistaken
 * for the port separator).
 *
 * @param wsUrl  - Original ws/wss URL (e.g., ws://localhost/devtools/browser/xxx)
 * @param ip     - IP literal (e.g., "192.168.117.4" or "::1")
 * @param port   - Optional port. When omitted, the URL's existing port is preserved.
 * @param family - 4 or 6, as returned by `dns.lookup`. Drives bracket wrapping.
 * @returns ws/wss URL whose host part is an IP literal that Chromium's
 *          DNS-Rebinding Host-header check will accept.
 */
export const applyIpToWsUrl = (
  wsUrl: string,
  ip: string,
  port: number | undefined,
  family: 4 | 6,
): string => {
  const u = new URL(wsUrl);
  const ipHost = family === 6 ? `[${ip}]` : ip;
  u.host = port !== undefined ? `${ipHost}:${String(port)}` : ipHost;
  return u.toString();
};

/**
 * Replace the host in a WebSocket URL with the *resolved IP* of
 * `targetHost`.
 *
 * Why IP and not the hostname (which is what puppeteer.connect()
 * originally received): Chromium's DNS-Rebinding guard rejects HTTP
 * "Upgrade: websocket" handshakes whose `Host` header is anything other
 * than `localhost` or an IP literal. This guard has applied to the HTTP
 * `/json/version` endpoint since Chrome 66; from Chrome 148 onward it
 * also applies to the WebSocket upgrade endpoint.
 *
 * The HTTP path here cheats by sending `Host: localhost` via the
 * low-level `node:http` module (`httpGetJson` above). The WebSocket
 * path cannot do the same: puppeteer's underlying `ws` library derives
 * the `Host` header from `URL.host` with no override hook. The only
 * portable workaround is therefore to bake an IP literal *into the URL*
 * before handing it to puppeteer.connect().
 *
 * `dns.lookup` uses the OS resolver (respecting /etc/hosts, Docker's
 * embedded DNS, NSS modules) — the same semantics as ping or curl,
 * which is exactly what we want for a hostname like `chromium-server-1`
 * defined by a Docker network.
 *
 * @param wsUrl      - Original ws URL returned by /json/version
 * @param targetHost - "host[:port]" string the caller originally passed
 *                     in via `browserURL` (e.g., "chromium-server-1:9222").
 */
export const resolveWsUrlHost = async (
  wsUrl: string,
  targetHost: string,
): Promise<string> => {
  const [hostname, portPart] = targetHost.split(":");
  if (hostname === undefined || hostname === "") {
    throw new Error(`resolveWsUrlHost: empty hostname in targetHost "${targetHost}"`);
  }
  const { address, family } = await dns.lookup(hostname);
  const port = portPart !== undefined ? parseInt(portPart, 10) : undefined;
  return applyIpToWsUrl(wsUrl, address, port, family as 4 | 6);
};

/**
 * Retrieve a Connect-ready WebSocket endpoint URL for the given
 * browserURL.
 *
 * Two-step process:
 *   1. HTTP GET /json/version with `Host: localhost` so Chromium's
 *      DNS-Rebinding guard lets the request through. The response
 *      includes a `webSocketDebuggerUrl` whose host part is always
 *      `localhost` (Chromium has no idea what hostname the caller
 *      reached it through).
 *   2. Replace that `localhost` with the IP literal of the original
 *      target host so the subsequent WebSocket upgrade also passes
 *      the same guard (see `resolveWsUrlHost` for the WHY).
 */
const fetchWebSocketEndpoint = async (browserURL: URL): Promise<string> => {
  const url = browserURL; // already parsed & validated at the CLI boundary
  const targetHost = url.host; // e.g., "chromium-server-1:9222"
  const port = url.port ? parseInt(url.port, 10) : 9222;

  const data = await httpGetJson<VersionResponse>(url.hostname, port, "/json/version");
  const wsUrl = data.webSocketDebuggerUrl;

  // Replace the host with the resolved IP of targetHost.
  // Example: ws://localhost/devtools/browser/xxx
  //        -> ws://192.168.117.4:9222/devtools/browser/xxx
  return resolveWsUrlHost(wsUrl, targetHost);
};

const connectBrowser = async (options: BrowserConnectOptions): Promise<Browser> => {
  const { browserURL, slowMo = DEFAULT_BROWSER_SLOW_MO_MS } = options;
  const wsEndpoint = await fetchWebSocketEndpoint(browserURL);

  return puppeteer.connect({
    browserWSEndpoint: wsEndpoint,
    slowMo,
  });
};

export default connectBrowser;
