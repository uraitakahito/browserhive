/**
 * Local-filesystem artifact store.
 *
 * Pre-existing behaviour of `PageCapturer`: `writeFile(join(outputDir,
 * filename), body)`. Wrapped here behind the `ArtifactStore` interface so
 * the capture pipeline does not branch on the storage kind.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ArtifactContentType, ArtifactStore } from "./types.js";

export class LocalArtifactStore implements ArtifactStore {
  private readonly outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = resolve(outputDir);
  }

  async initialize(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true });
  }

  async put(
    filename: string,
    body: Buffer | string,
    contentType: ArtifactContentType,
  ): Promise<string> {
    // The local filesystem has no Content-Type concept; the parameter is
    // part of the abstract-store contract for object stores (S3) and is
    // silently ignored here.
    void contentType;
    const filePath = join(this.outputDir, filename);
    await writeFile(filePath, body);
    return filePath;
  }
}
