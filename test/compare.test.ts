import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { registerCompareTool } from "@/mcp/tools/compare";
import { LexDaniaXmlInspector } from "@/services/lexdania/xml";
import type { LawSource } from "@/services/retsinformation/types";

const TINY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Dokument><Meta AccessionNr="A1"/></Dokument>`;

async function connectCompareTool(): Promise<Client> {
  const lawSource = { fetchXml: vi.fn().mockResolvedValue(TINY_XML) } as unknown as LawSource;

  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerCompareTool(server, { lawSource, xmlInspector: new LexDaniaXmlInspector() });

  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("lexdania_compare_structure elis validation", () => {
  it("rejects more than 5 ELIs with a schema error", async () => {
    const client = await connectCompareTool();
    const elis = Array.from({ length: 6 }, (_, i) => `lta/2024/${i + 1}`);

    const result = await client.callTool({ name: "lexdania_compare_structure", arguments: { elis } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("too_big");
  });

  it("accepts 5 ELIs", async () => {
    const client = await connectCompareTool();
    const elis = Array.from({ length: 5 }, (_, i) => `lta/2024/${i + 1}`);

    const result = await client.callTool({ name: "lexdania_compare_structure", arguments: { elis } });

    expect(result.isError).toBeFalsy();
  });

  it("rejects fewer than 2 ELIs with a schema error", async () => {
    const client = await connectCompareTool();

    const result = await client.callTool({ name: "lexdania_compare_structure", arguments: { elis: ["lta/2024/1"] } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("too_small");
  });
});
