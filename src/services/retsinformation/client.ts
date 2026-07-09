import type { Eli, ResourceFormat } from "./eli";
import type { LawSource } from "./types";

// Bare requests can be rejected with 403; a browser-like User-Agent avoids it.
const USER_AGENT = "Mozilla/5.0 (compatible; lexdania-mcp/0.1; +https://retsinformation.dk)";
// Bound the upstream fetch so a hung origin can't hold the Worker request open.
const REQUEST_TIMEOUT_MS = 15_000;
// Documents past this size can't be parsed into a DOM or uploaded for RAG within
// the Worker's memory budget. Some consolidated laws exceed 300MB; those are
// refused and the caller is pointed at the raw XML for local analysis instead.
const DEFAULT_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface RetsinformationClientOptions {
  /** Max bytes to buffer for a single document before refusing it. Default 10MB. */
  maxDocumentBytes?: number;
}

/**
 * Raised when a document is too large to process in-server. Its message tells the
 * client why the server refused and how to study the document directly: every ELI
 * exposes its raw LexDania XML at the `/xml` suffix.
 */
export class DocumentTooLargeError extends Error {
  constructor(
    readonly eli: Eli,
    readonly limitBytes: number,
    /** Actual size when known from Content-Length; undefined when detected mid-stream. */
    readonly actualBytes?: number,
  ) {
    const limitMb = formatMb(limitBytes);
    const sizePart = actualBytes !== undefined ? `is ${formatMb(actualBytes)} MB` : `exceeds ${limitMb} MB`;
    super(`Document ${eli.id} ${sizePart}, over the ${limitMb} MB limit. Fetch the XML directly for analysis: ${eli.fetchUrl("xml")}`);
    this.name = "DocumentTooLargeError";
  }
}

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Fetches LexDania resources from retsinformation.dk by swapping the ELI format suffix. */
export class RetsinformationClient implements LawSource {
  private readonly maxDocumentBytes: number;

  constructor(options: RetsinformationClientOptions = {}) {
    this.maxDocumentBytes = options.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
  }

  async fetchXml(eli: Eli): Promise<string> {
    return new TextDecoder().decode(await this.fetchCapped(eli, "xml", "application/xml"));
  }

  async fetchPdf(eli: Eli): Promise<Blob> {
    const bytes = await this.fetchCapped(eli, "pdf", "application/pdf");
    // `readCapped` returns an exact-sized buffer, so its ArrayBuffer is the payload verbatim.
    return new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  }

  async fetchJson(eli: Eli): Promise<unknown> {
    return JSON.parse(new TextDecoder().decode(await this.fetchCapped(eli, "json", "application/json")));
  }

  /**
   * Fetches a resource and buffers its body, refusing anything past the size cap.
   * A declared Content-Length is checked first so oversized PDFs are rejected
   * before download; bodies without one (chunked XML) are capped while streaming.
   */
  private async fetchCapped(eli: Eli, format: ResourceFormat, acceptHeaderValue: string): Promise<Uint8Array> {
    const url = eli.fetchUrl(format);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: acceptHeaderValue },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error(`Retsinformation request timed out after ${REQUEST_TIMEOUT_MS}ms for ${url}`);
      }
      throw error;
    }
    if (!response.ok) {
      throw new Error(`Retsinformation returned ${response.status} ${response.statusText} for ${url}`);
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxDocumentBytes) {
      throw new DocumentTooLargeError(eli, this.maxDocumentBytes, declared);
    }

    return this.readCapped(response, eli);
  }

  /** Streams a response body, aborting and refusing once it passes the size cap. */
  private async readCapped(response: Response, eli: Eli): Promise<Uint8Array> {
    const body = response.body;
    if (!body) return new Uint8Array(0);

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > this.maxDocumentBytes) {
        await reader.cancel();
        throw new DocumentTooLargeError(eli, this.maxDocumentBytes);
      }
      chunks.push(value);
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}
