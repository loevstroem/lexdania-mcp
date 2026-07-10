import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Eli } from "@/services/retsinformation/eli";
import { type QueryDocumentDependencies, queryDocument } from "@/services/retsinformation/service";
import { presentMcpResult } from "../result";

const DEFAULT_MAX_NODE_BYTES = 32 * 1024;

const queryAncestrySchema = z.object({
  path: z.string().describe("XPath-like ancestry path."),
  elements: z.array(
    z.object({
      tag: z.string().describe("Element tag name."),
      ordinal: z.number().int().positive().describe("Element ordinal among matching siblings."),
      id: z.string().optional().describe("Element identifier."),
      localId: z.string().optional().describe("Element local identifier."),
    }),
  ),
  explicatus: z.array(z.string()).describe("Explicatus identifiers in the ancestry."),
});

const queryMatchSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("match"),
    tag: z.string().describe("Matched node tag."),
    xml: z.string().optional().describe("Serialized XML when requested by format."),
    text: z.string().optional().describe("Plain-text content when requested by format."),
    ancestry: queryAncestrySchema,
  }),
  z.object({
    kind: z.literal("stub"),
    tag: z.string().describe("Matched node tag."),
    approxBytes: z.number().int().positive().describe("Approximate serialized node size in bytes."),
    childTagCounts: z.record(z.string(), z.number().int().nonnegative()).describe("Direct child tag frequencies."),
    hint: z.string().describe("Guidance for retrieving a bounded full match."),
    ancestry: queryAncestrySchema,
  }),
]);

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
        "Exact, namespace-aware XPath query against one document's LexDania XML. Deterministic — use for precise counts/extraction. Returns { count, matches, value? }; scalar expressions like count()/string() return value with no matches. Use `format` to select text, XML, or both; matches over `maxNodeBytes` become bounded stubs. Every match includes ancestry metadata. Most laws use the legacy `<Dokument>` root with no namespace — query unprefixed (`//Paragraf`). Newer `<lex:…>` docs declare namespaces; call `profile` first and use the prefixes it returns (default ns, if any, exposed as `d:`). Find a § by label: `//Paragraf[.//Explicatus[normalize-space(.)='§ 35.']]`. Scope text search to leaf tags: `//Linea[contains(., 'term')]`. Always set `limit`; broad `contains(.)` also matches ancestor containers.",
      inputSchema: {
        eli: z.string().describe("Document ELI path or URL."),
        xpath: z.string().min(1).describe("Namespace-aware XPath expression."),
        limit: z.number().int().min(0).optional().describe("Max returned matches (default: 20, 0 = count only)."),
        format: z.enum(["text", "xml", "both"]).optional().describe("Node representation (default: both)."),
        maxNodeBytes: z.number().int().positive().optional().describe("Maximum serialized bytes per full node (default: 32768)."),
      },
      outputSchema: {
        count: z.number().int().describe("Total matched nodes."),
        matches: z.array(queryMatchSchema).describe("Bounded node matches in document order."),
        value: z.union([z.number(), z.string(), z.boolean()]).optional().describe("Scalar result of evaluated XPath expression."),
      },
    },
    (args) =>
      presentMcpResult(async () => {
        const result = await queryDocument(deps, {
          eli: Eli.parse(args.eli),
          xpath: args.xpath,
          options: {
            limit: args.limit ?? 20,
            format: args.format ?? "both",
            maxNodeBytes: args.maxNodeBytes ?? DEFAULT_MAX_NODE_BYTES,
          },
        });
        return {
          count: result.count,
          matches: result.matches,
          value: result.scalarValue,
        };
      }),
  );
}
