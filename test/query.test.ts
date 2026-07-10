import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { registerQueryTool } from "@/mcp/tools/query";
import { LexDaniaXmlInspector } from "@/services/lexdania/xml";
import type { LawSource } from "@/services/retsinformation/types";

const OVERSIZE_TEXT = "x".repeat(32 * 1024);
const SMALL_LINES = Array.from({ length: 21 }, (_, index) => `<Linea id="small-${index + 1}">Small ${index + 1}</Linea>`).join("");
const QUERY_XML = `<Dokument><Body><Linea id="oversize">${OVERSIZE_TEXT}</Linea>${SMALL_LINES}</Body></Dokument>`;

type QueryMatchOutput = Record<string, unknown> & { kind: "match" | "stub" };

type QueryOutput = {
  count: number;
  matches: QueryMatchOutput[];
  value?: number | string | boolean;
};

type CallToolResponse = Awaited<ReturnType<Client["callTool"]>>;

/** Connects an MCP client to an in-memory query tool backed by the XML fixture. */
async function connectQueryTool(): Promise<Client> {
  const lawSource = { fetchXml: vi.fn().mockResolvedValue(QUERY_XML) } as unknown as LawSource;
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerQueryTool(server, { lawSource, xmlInspector: new LexDaniaXmlInspector() });

  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** Extracts a successful query tool's structured response. */
function structuredQueryOutput(result: CallToolResponse): QueryOutput {
  if (!("content" in result)) throw new Error("Expected a synchronous MCP tool response.");
  const response = result as { isError?: boolean; structuredContent?: Record<string, unknown> };
  expect(response.isError).toBeFalsy();
  expect(response.structuredContent).toBeDefined();
  return response.structuredContent as QueryOutput;
}

describe("lexdania_query_document response controls", () => {
  it("defaults to 20 both-format matches and guards nodes over 32768 bytes", async () => {
    const client = await connectQueryTool();

    const result = await client.callTool({ name: "lexdania_query_document", arguments: { eli: "lta/2024/48", xpath: "//Linea" } });
    const output = structuredQueryOutput(result);

    expect(output.count).toBe(22);
    expect(output.matches).toHaveLength(20);
    expect(output.matches[0]).toMatchObject({
      kind: "stub",
      tag: "Linea",
      approxBytes: expect.any(Number),
      childTagCounts: {},
      hint: expect.stringContaining("maxNodeBytes"),
    });
    expect(output.matches[1]).toMatchObject({
      kind: "match",
      tag: "Linea",
      xml: '<Linea id="small-1">Small 1</Linea>',
      text: "Small 1",
    });
  });

  it("omits every xml key in text format", async () => {
    const client = await connectQueryTool();

    const result = await client.callTool({
      name: "lexdania_query_document",
      arguments: { eli: "lta/2024/48", xpath: "//Linea[@id='small-1']", format: "text" },
    });
    const output = structuredQueryOutput(result);

    expect(output.matches).toHaveLength(1);
    expect(output.matches[0]).toMatchObject({ kind: "match", tag: "Linea", text: "Small 1" });
    expect(JSON.stringify(output)).not.toContain('"xml":');
  });

  it("returns a full node when maxNodeBytes is raised explicitly", async () => {
    const client = await connectQueryTool();

    const result = await client.callTool({
      name: "lexdania_query_document",
      arguments: { eli: "lta/2024/48", xpath: "//Linea[@id='oversize']", maxNodeBytes: 40_000 },
    });
    const output = structuredQueryOutput(result);

    expect(output.matches).toHaveLength(1);
    expect(output.matches[0]).toMatchObject({
      kind: "match",
      tag: "Linea",
      xml: `<Linea id="oversize">${OVERSIZE_TEXT}</Linea>`,
      text: OVERSIZE_TEXT,
    });
  });

  it.each(["raw", "TEXT"])("rejects invalid format %s", async (format) => {
    const client = await connectQueryTool();

    const result = await client.callTool({
      name: "lexdania_query_document",
      arguments: { eli: "lta/2024/48", xpath: "//Linea", format },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("format");
  });

  it.each([0, 1.5, -1])("rejects invalid maxNodeBytes value %s", async (maxNodeBytes) => {
    const client = await connectQueryTool();

    const result = await client.callTool({
      name: "lexdania_query_document",
      arguments: { eli: "lta/2024/48", xpath: "//Linea", maxNodeBytes },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("maxNodeBytes");
  });

  it("maps scalar results to value with no matches", async () => {
    const client = await connectQueryTool();

    const result = await client.callTool({ name: "lexdania_query_document", arguments: { eli: "lta/2024/48", xpath: "count(//Linea)" } });
    const output = structuredQueryOutput(result);

    expect(output).toEqual({ count: 0, matches: [], value: 22 });
  });
});
