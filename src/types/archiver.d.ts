/**
 * Minimal type shim for archiver 8.x.
 *
 * archiver 8 dropped its CommonJS factory (`archiver(format, options)`) in
 * favour of per-format ES module classes (`new ZipArchive(opts)`,
 * `new TarArchive(opts)`, …). DefinitelyTyped's @types/archiver still tracks
 * the v7 factory API, so we declaration-merge a `ZipArchive` class on top of
 * it for the methods this codebase consumes.
 *
 * Drop this file once `@types/archiver@^8` lands upstream and ships the
 * class API natively.
 */
declare module "archiver" {
  export class ZipArchive {
    constructor(options?: { zlib?: { level?: number } });
    append(
      source: Buffer | string,
      data: { name: string; store?: boolean },
    ): this;
    finalize(): Promise<void>;
    pipe<T>(destination: T): T;
    on(
      event: "error" | "warning",
      listener: (err: Error & { code?: string }) => void,
    ): this;
  }
}
