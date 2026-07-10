import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { registerAskTool } from "@/mcp/tools/ask";
import type { Eli } from "@/services/retsinformation/eli";
import type { IngestProgress, LawSource, LegislationCorpus } from "@/services/retsinformation/types";

/** A corpus whose cold ingest emits two progress reports before completing. */
function createSlowIngestCorpus(): LegislationCorpus {
  return {
    has: vi.fn().mockResolvedValue(false),
    ingest: vi.fn().mockImplementation(async (eli: Eli, _pdf: Blob, onProgress?: (progress: IngestProgress) => void) => {
      onProgress?.({ elapsedMs: 0, totalMs: 120_000, message: `Uploaded ${eli.id}; awaiting File Search processing` });
      onProgress?.({ elapsedMs: 5_000, totalMs: 120_000, message: `Ingesting ${eli.id}` });
    }),
    answer: vi.fn().mockResolvedValue({ answer: "ok", citations: [] }),
  } as unknown as LegislationCorpus;
}

async function connectAskTool(legislationCorpus: LegislationCorpus): Promise<Client> {
  const lawSource = { fetchPdf: vi.fn().mockResolvedValue(new Blob(["%PDF"])) } as unknown as LawSource;

  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerAskTool(server, { lawSource, legislationCorpus, waitUntil: vi.fn() });

  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("lexdania_ask_document progress notifications", () => {
  it("emits notifications/progress during a cold ingest when the request carries a progress token", async () => {
    const client = await connectAskTool(createSlowIngestCorpus());

    const progressUpdates: { progress: number; total?: number; message?: string }[] = [];
    const result = await client.callTool({ name: "lexdania_ask_document", arguments: { question: "Hvad siger loven?", eli: "lta/2024/48" } }, undefined, {
      onprogress: (progress) => progressUpdates.push(progress),
    });

    expect(result.isError).toBeFalsy();
    expect(progressUpdates).toEqual([
      { progress: 0, total: 120_000, message: expect.stringContaining("eli/lta/2024/48") },
      { progress: 5_000, total: 120_000, message: expect.stringContaining("eli/lta/2024/48") },
    ]);
  });

  it("completes a cold ingest ask without progress when no progress token is sent", async () => {
    const client = await connectAskTool(createSlowIngestCorpus());

    const result = await client.callTool({ name: "lexdania_ask_document", arguments: { question: "Hvad siger loven?", eli: "lta/2024/48" } });

    expect(result.isError).toBeFalsy();
  });
});

describe("lexdania_ask_document maxSources", () => {
  function createAnswerCorpus(): LegislationCorpus {
    return {
      has: vi.fn().mockResolvedValue(true),
      ingest: vi.fn(),
      answer: vi.fn().mockResolvedValue({ answer: "ok", citations: [] }),
    } as unknown as LegislationCorpus;
  }

  it("rejects maxSources above 25 with a schema error", async () => {
    const client = await connectAskTool(createAnswerCorpus());

    const result = await client.callTool({ name: "lexdania_ask_document", arguments: { question: "Hvad siger loven?", maxSources: 26 } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("maxSources");
  });

  it("accepts maxSources at the cap", async () => {
    const legislationCorpus = createAnswerCorpus();
    const client = await connectAskTool(legislationCorpus);

    const result = await client.callTool({ name: "lexdania_ask_document", arguments: { question: "Hvad siger loven?", maxSources: 25 } });

    expect(result.isError).toBeFalsy();
    expect(legislationCorpus.answer).toHaveBeenCalledWith("Hvad siger loven?", undefined, 25);
  });

  it("defaults maxSources to 8 when omitted", async () => {
    const legislationCorpus = createAnswerCorpus();
    const client = await connectAskTool(legislationCorpus);

    const result = await client.callTool({ name: "lexdania_ask_document", arguments: { question: "Hvad siger loven?" } });

    expect(result.isError).toBeFalsy();
    expect(legislationCorpus.answer).toHaveBeenCalledWith("Hvad siger loven?", undefined, 8);
  });
});
