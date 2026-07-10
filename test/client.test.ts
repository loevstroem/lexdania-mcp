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

/** In-memory stand-in for the Workers Cache API — stores whatever the client puts. */
function fakeCache() {
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: string) => {
      const hit = store.get(key);
      return hit?.clone();
    }),
    put: vi.fn(async (key: string, response: Response) => {
      store.set(key, response);
    }),
  };
  return { cache: cache as unknown as Cache, match: cache.match, put: cache.put, store };
}

describe("RetsinformationClient edge cache", () => {
  it("serves a repeat fetch from cache without hitting the origin", async () => {
    const text = "<xml>cached law</xml>";
    const origin = vi.fn(async () => fakeResponse({ chunks: [new TextEncoder().encode(text)] }));
    vi.stubGlobal("fetch", origin);

    const { cache } = fakeCache();
    const client = new RetsinformationClient({ cache });
    await expect(client.fetchXml(ELI)).resolves.toBe(text);
    await expect(client.fetchXml(ELI)).resolves.toBe(text);
    expect(origin).toHaveBeenCalledTimes(1);
  });

  it("accepts a promised cache handle, as returned by caches.open()", async () => {
    const text = "<xml>cached law</xml>";
    const origin = vi.fn(async () => fakeResponse({ chunks: [new TextEncoder().encode(text)] }));
    vi.stubGlobal("fetch", origin);

    const { cache } = fakeCache();
    const client = new RetsinformationClient({ cache: Promise.resolve(cache) });
    await expect(client.fetchXml(ELI)).resolves.toBe(text);
    await expect(client.fetchXml(ELI)).resolves.toBe(text);
    expect(origin).toHaveBeenCalledTimes(1);
  });

  it("handles a rejected cache promise before the cache is used", async () => {
    const cache = Promise.reject<Cache>(new Error("cache unavailable"));
    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);

    try {
      new RetsinformationClient({ cache });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.removeListener("unhandledRejection", unhandled);
      await cache.catch(() => undefined);
    }
  });

  it.each([
    {
      format: "XML",
      body: "<xml/>",
      fetchResource: (client: RetsinformationClient) => client.fetchXml(ELI),
      url: "https://www.retsinformation.dk/eli/lta/2023/1098/xml",
      contentType: "application/xml",
    },
    {
      format: "PDF",
      body: "%PDF-1.7",
      fetchResource: (client: RetsinformationClient) => client.fetchPdf(ELI),
      url: "https://www.retsinformation.dk/eli/lta/2023/1098/pdf",
      contentType: "application/pdf",
    },
    {
      format: "JSON",
      body: '{"title":"law"}',
      fetchResource: (client: RetsinformationClient) => client.fetchJson(ELI),
      url: "https://www.retsinformation.dk/eli/lta/2023/1098.json",
      contentType: "application/json",
    },
  ])("stores $format responses with the canonical key, content type, body, and 24h TTL", async ({ body, fetchResource, url, contentType }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ chunks: [new TextEncoder().encode(body)] })),
    );

    const { cache, put } = fakeCache();
    await fetchResource(new RetsinformationClient({ cache }));

    expect(put).toHaveBeenCalledTimes(1);
    const [key, stored] = put.mock.calls[0] as [string, Response];
    expect(key).toBe(url);
    expect(stored.headers.get("content-type")).toBe(contentType);
    expect(stored.headers.get("cache-control")).toBe("public, max-age=86400");
    await expect(stored.text()).resolves.toBe(body);
  });

  it("defers the cache write via waitUntil instead of blocking the response", async () => {
    const text = "<xml/>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ chunks: [new TextEncoder().encode(text)] })),
    );

    const { cache, put } = fakeCache();
    put.mockImplementation(() => new Promise<void>(() => {})); // write never settles
    const scheduled: Promise<unknown>[] = [];
    const client = new RetsinformationClient({ cache, waitUntil: (promise) => scheduled.push(promise) });

    await expect(client.fetchXml(ELI)).resolves.toBe(text);
    expect(scheduled).toHaveLength(1);
  });

  it("does not cache non-200 origin responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ ok: false, status: 503, statusText: "Service Unavailable" })),
    );

    const { cache, put } = fakeCache();
    const client = new RetsinformationClient({ cache });
    await expect(client.fetchXml(ELI)).rejects.toThrow("503");
    expect(put).not.toHaveBeenCalled();
  });

  it("does not cache documents refused for size", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ headers: { "content-length": String(357_042_061) } })),
    );

    const { cache, put } = fakeCache();
    const client = new RetsinformationClient({ cache, maxDocumentBytes: 10 * 1024 * 1024 });
    await expect(client.fetchPdf(ELI)).rejects.toBeInstanceOf(DocumentTooLargeError);
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses an oversized cached response exactly like an uncached one", async () => {
    const origin = vi.fn();
    vi.stubGlobal("fetch", origin);

    const { cache, match } = fakeCache();
    match.mockResolvedValueOnce(fakeResponse({ headers: { "content-length": String(357_042_061) } }));
    const client = new RetsinformationClient({ cache, maxDocumentBytes: 10 * 1024 * 1024 });
    await expect(client.fetchPdf(ELI)).rejects.toBeInstanceOf(DocumentTooLargeError);
    expect(origin).not.toHaveBeenCalled();
  });

  it("falls back to the origin when the cache itself fails", async () => {
    const text = "<xml/>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ chunks: [new TextEncoder().encode(text)] })),
    );

    const { cache, match, put } = fakeCache();
    match.mockRejectedValue(new Error("cache unavailable"));
    put.mockRejectedValue(new Error("cache unavailable"));
    const client = new RetsinformationClient({ cache });
    await expect(client.fetchXml(ELI)).resolves.toBe(text);
  });

  it("falls back to the origin when a cached body cannot be read", async () => {
    const text = "<xml>origin</xml>";
    const origin = vi.fn(async () => fakeResponse({ chunks: [new TextEncoder().encode(text)] }));
    vi.stubGlobal("fetch", origin);

    const { cache, match } = fakeCache();
    match.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("cached body failed"));
          },
        }),
      ),
    );
    const client = new RetsinformationClient({ cache });

    await expect(client.fetchXml(ELI)).resolves.toBe(text);
    expect(origin).toHaveBeenCalledTimes(1);
  });
});
