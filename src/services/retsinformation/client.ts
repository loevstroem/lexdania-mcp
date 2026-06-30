import type { Eli } from "./eli";
import type { LawSource } from "./types";

// Bare requests can be rejected with 403; a browser-like User-Agent avoids it.
const USER_AGENT = "Mozilla/5.0 (compatible; lexdania-mcp/0.1; +https://retsinformation.dk)";
// Bound the upstream fetch so a hung origin can't hold the Worker request open.
const REQUEST_TIMEOUT_MS = 15_000;

/** Fetches LexDania resources from retsinformation.dk by swapping the ELI format suffix. */
export class RetsinformationClient implements LawSource {
  async fetchXml(eli: Eli): Promise<string> {
    const response = await this.get(eli.fetchUrl("xml"), "application/xml");
    return response.text();
  }

  async fetchPdf(eli: Eli): Promise<Blob> {
    const response = await this.get(eli.fetchUrl("pdf"), "application/pdf");
    return response.blob();
  }

  async fetchJson(eli: Eli): Promise<unknown> {
    const response = await this.get(eli.fetchUrl("json"), "application/json");
    return response.json();
  }

  private async get(url: string, acceptHeaderValue: string): Promise<Response> {
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
    return response;
  }
}
