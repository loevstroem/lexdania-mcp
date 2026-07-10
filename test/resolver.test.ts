import { describe, expect, it, vi } from "vitest";
import { handleResolve, requestResolvedDocument, resolveUrl } from "@/http/resolver";
import { Eli } from "@/services/retsinformation/eli";
import { ResolverUnavailableError } from "@/services/retsinformation/resolver";
import type { LawSource, LegislationCorpus } from "@/services/retsinformation/types";

interface CorpusOverrides {
  find?: ReturnType<typeof vi.fn>;
  index?: ReturnType<typeof vi.fn>;
}

function buildDeps(overrides: CorpusOverrides = {}) {
  const lawSource = {
    fetchPdf: vi.fn().mockResolvedValue(new Blob(["%PDF"])),
  } as unknown as LawSource;
  const legislationCorpus = {
    find: overrides.find ?? vi.fn().mockResolvedValue(undefined),
    index: overrides.index ?? vi.fn().mockResolvedValue("fileSearchStores/test/documents/fresh"),
  } as unknown as LegislationCorpus;
  const waitUntil = vi.fn();
  return { lawSource, legislationCorpus, waitUntil };
}

describe("handleResolve", () => {
  it("serves an already-indexed law with an explicit fresh window and no indexing", async () => {
    const find = vi.fn().mockResolvedValue("fileSearchStores/test/documents/known");
    const deps = buildDeps({ find });

    const response = await handleResolve(deps, new Request(resolveUrl(Eli.parse("lta/2020/100"), "test-store")));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400, stale-if-error=0");
    expect(await response.json()).toEqual({ eli: "eli/lta/2020/100", documentName: "fileSearchStores/test/documents/known" });
    expect(deps.legislationCorpus.index).not.toHaveBeenCalled();
    expect(deps.lawSource.fetchPdf).not.toHaveBeenCalled();
  });

  it("falls back to fetching and indexing a law missing from the store", async () => {
    const deps = buildDeps();

    const response = await handleResolve(deps, new Request(resolveUrl(Eli.parse("lta/2020/101"), "test-store")));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400, stale-if-error=0");
    expect(await response.json()).toEqual({ eli: "eli/lta/2020/101", documentName: "fileSearchStores/test/documents/fresh" });
    expect(deps.lawSource.fetchPdf).toHaveBeenCalledTimes(1);
    expect(deps.legislationCorpus.index).toHaveBeenCalledTimes(1);
    expect(deps.waitUntil).toHaveBeenCalled();
  });

  it("marks a failed resolution uncacheable", async () => {
    const index = vi.fn().mockRejectedValue(new Error("File Search unavailable"));
    const deps = buildDeps({ index });

    const response = await handleResolve(deps, new Request(resolveUrl(Eli.parse("lta/2020/102"), "test-store")));

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "File Search unavailable" });
  });

  it("marks an invalid ELI uncacheable", async () => {
    const deps = buildDeps();

    const response = await handleResolve(deps, new Request("https://lexdania-mcp.internal/resolve-document/not-an-eli"));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(deps.legislationCorpus.find).not.toHaveBeenCalled();
  });

  it("rejects non-idempotent methods without caching", async () => {
    const deps = buildDeps();

    const response = await handleResolve(deps, new Request(resolveUrl(Eli.parse("lta/2020/103"), "test-store"), { method: "POST" }));

    expect(response.status).toBe(405);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("coalesces concurrent resolutions of the same unindexed law into one upload", async () => {
    let finishIndex = (_documentName: string) => {};
    const index = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishIndex = resolve;
        }),
    );
    const deps = buildDeps({ index });
    const request = () => new Request(resolveUrl(Eli.parse("lta/2020/104"), "test-store"));

    const first = handleResolve(deps, request());
    const second = handleResolve(deps, request());
    await vi.waitFor(() => expect(index).toHaveBeenCalledTimes(1));
    finishIndex("fileSearchStores/test/documents/shared");
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(deps.lawSource.fetchPdf).toHaveBeenCalledTimes(1);
    expect(index).toHaveBeenCalledTimes(1);
    expect(await firstResponse.json()).toEqual({ eli: "eli/lta/2020/104", documentName: "fileSearchStores/test/documents/shared" });
    expect(await secondResponse.json()).toEqual({ eli: "eli/lta/2020/104", documentName: "fileSearchStores/test/documents/shared" });
  });
});

describe("requestResolvedDocument", () => {
  it("returns the document name from a successful resolver response", async () => {
    const fetcher = {
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ eli: "eli/lta/2020/105", documentName: "fileSearchStores/test/documents/hit" }))),
    };

    const documentName = await requestResolvedDocument(fetcher, Eli.parse("lta/2020/105"), "test-store");

    expect(documentName).toBe("fileSearchStores/test/documents/hit");
    expect(fetcher.fetch).toHaveBeenCalledWith("https://lexdania-mcp.internal/resolve-document/eli%2Flta%2F2020%2F105?store=test-store");
  });

  it("keys the cache URL by store so a reconfigured store never reuses stale entries", () => {
    const eli = Eli.parse("lta/2020/105");

    expect(resolveUrl(eli, "store-a")).not.toBe(resolveUrl(eli, "store-b"));
  });

  it("surfaces a remote resolution failure as a definitive error, not a fallback signal", async () => {
    const fetcher = {
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "indexing timed out" }), { status: 500 })),
    };

    await expect(requestResolvedDocument(fetcher, Eli.parse("lta/2020/106"), "test-store")).rejects.toThrow("indexing timed out");
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
  });

  it("signals a Cloudflare failsafe response as unavailable", async () => {
    const fetcher = {
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "temporary edge failure" }), { status: 523 })),
    };

    await expect(requestResolvedDocument(fetcher, Eli.parse("lta/2020/110"), "test-store")).rejects.toBeInstanceOf(ResolverUnavailableError);
  });

  it("signals an unstructured non-success response as unavailable", async () => {
    const fetcher = {
      fetch: vi.fn().mockResolvedValue(new Response("Service unavailable", { status: 503 })),
    };

    await expect(requestResolvedDocument(fetcher, Eli.parse("lta/2020/111"), "test-store")).rejects.toBeInstanceOf(ResolverUnavailableError);
  });

  it("signals transport failure as ResolverUnavailableError so callers may fall back", async () => {
    const fetcher = {
      fetch: vi.fn().mockRejectedValue(new Error("binding missing")),
    };

    await expect(requestResolvedDocument(fetcher, Eli.parse("lta/2020/107"), "test-store")).rejects.toBeInstanceOf(ResolverUnavailableError);
  });

  it("signals a response without a document name as ResolverUnavailableError", async () => {
    const fetcher = {
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ eli: "eli/lta/2020/108" }))),
    };

    await expect(requestResolvedDocument(fetcher, Eli.parse("lta/2020/108"), "test-store")).rejects.toBeInstanceOf(ResolverUnavailableError);
  });

  it("does not signal fallback for a remote resolution failure", async () => {
    const fetcher = {
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "indexing timed out" }), { status: 500 })),
    };

    await expect(requestResolvedDocument(fetcher, Eli.parse("lta/2020/109"), "test-store")).rejects.toSatisfy((error) => !(error instanceof ResolverUnavailableError));
  });
});
