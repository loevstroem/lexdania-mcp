import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentTooLargeError, RetsinformationClient } from "@/services/retsinformation/client";
import { Eli } from "@/services/retsinformation/eli";

const ELI = Eli.parse("lta/2023/1098");

/** Minimal fetch Response stand-in — the client only touches these members. */
function fakeResponse(opts: { ok?: boolean; status?: number; statusText?: string; headers?: Record<string, string>; chunks?: Uint8Array[] }): Response {
  const chunks = opts.chunks ?? [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "OK",
    headers: new Headers(opts.headers ?? {}),
    body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RetsinformationClient size cap", () => {
  it("rejects a document whose declared content-length exceeds the cap without reading the body", async () => {
    const bodyRead = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const res = fakeResponse({ headers: { "content-length": String(357_042_061) } });
        // Trip if the body is ever read — a 340MB doc must be rejected on the header alone.
        Object.defineProperty(res, "body", { get: bodyRead });
        return res;
      }),
    );

    const client = new RetsinformationClient({ maxDocumentBytes: 10 * 1024 * 1024 });
    await expect(client.fetchPdf(ELI)).rejects.toBeInstanceOf(DocumentTooLargeError);
    expect(bodyRead).not.toHaveBeenCalled();
  });

  it("aborts a streamed body (no content-length) once it exceeds the cap", async () => {
    const cap = 1024;
    // Two 1KB chunks: first fits, second trips the cap.
    const chunks = [new Uint8Array(1024).fill(65), new Uint8Array(1024).fill(66)];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ chunks })),
    );

    const client = new RetsinformationClient({ maxDocumentBytes: cap });
    await expect(client.fetchXml(ELI)).rejects.toBeInstanceOf(DocumentTooLargeError);
  });

  it("returns content for a document under the cap", async () => {
    const text = "<Dokument><Body>ok</Body></Dokument>";
    const chunks = [new TextEncoder().encode(text)];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ chunks })),
    );

    const client = new RetsinformationClient({ maxDocumentBytes: 10 * 1024 * 1024 });
    await expect(client.fetchXml(ELI)).resolves.toBe(text);
  });

  it("surfaces the XML url and ELI in the too-large error message", () => {
    const err = new DocumentTooLargeError(ELI, 10 * 1024 * 1024, 357_042_061);
    expect(err.message).toContain("eli/lta/2023/1098");
    expect(err.message).toContain("https://www.retsinformation.dk/eli/lta/2023/1098/xml");
  });
});
