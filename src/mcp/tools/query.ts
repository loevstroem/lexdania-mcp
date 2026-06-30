import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Eli } from "@/services/retsinformation/eli";
import { type QueryDocumentDependencies, queryDocument } from "@/services/retsinformation/service";
import { presentMcpResult } from "../result";

const DEFAULT_LIMIT = 20;

/**
 * Registers the `lexdania_query_document` tool to the MCP server.
 *
 * @param server - The target MCP server instance.
 * @param deps - Required dependencies for XML XPath query operations.
 */
export function registerQueryTool(server: McpServer, deps: QueryDocumentDependencies): void {
  server.registerTool(
    "lexdania_query_document",
    {
      title: "Query LexDania XML",
      description:
        "Exact, namespace-aware XPath query against one document's LexDania XML. Deterministic — use for precise counts/extraction. Returns { count, nodes }; value expressions like count()/string() return { value }. Most laws use the legacy `<Dokument>` root with no namespace — query unprefixed (`//Paragraf`). Newer `<lex:…>` docs declare namespaces; call `profile` first and use the prefixes it returns (default ns, if any, exposed as `d:`).",
      inputSchema: {
        eli: z.string().describe("Document ELI path or URL."),
        xpath: z.string().min(1).describe("Namespace-aware XPath expression."),
        limit: z.number().int().min(0).optional().describe("Max serialized nodes (default: 20, 0 = count only)."),
      },
      outputSchema: {
        count: z.number().int().describe("Total matched nodes."),
        nodes: z.array(z.string()).describe("Serialized matched nodes (raw XML)."),
        text: z.array(z.string()).describe("Plain-text content of each matched node, same order as nodes."),
        value: z.union([z.number(), z.string(), z.boolean()]).optional().describe("Scalar result of evaluated XPath expression."),
      },
    },
    (args) =>
      presentMcpResult(async () => {
        const result = await queryDocument(deps, {
          eli: Eli.parse(args.eli),
          xpath: args.xpath,
          limit: args.limit ?? DEFAULT_LIMIT,
        });
        return {
          count: result.count,
          nodes: result.nodes,
          text: result.text,
          value: result.scalarValue,
        };
      }),
  );
}
