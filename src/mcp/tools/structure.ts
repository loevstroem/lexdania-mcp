import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Eli } from "@/services/retsinformation/eli";
import { type ProfileDocumentDependencies, profileDocument } from "@/services/retsinformation/service";
import { presentMcpResult } from "../result";

const DEFAULT_TOP = 30;

/**
 * Registers the `lexdania_profile_document` tool to the MCP server.
 *
 * @param server - The target MCP server instance.
 * @param deps - Required dependencies for structural profiling operations.
 */
export function registerStructureTool(server: McpServer, deps: ProfileDocumentDependencies): void {
  server.registerTool(
    "lexdania_profile_document",
    {
      title: "Profile LexDania structure",
      description: "Compact structural profile of one document's LexDania XML: root, schema variant, document type, element/attribute counts, max depth, tag frequencies, and namespaces.",
      inputSchema: {
        eli: z.string().describe("Document ELI path or URL."),
        top: z.number().int().positive().optional().describe("Max tag frequencies to return (default: 30)."),
      },
      outputSchema: {
        root: z.string().describe("XML root element name."),
        schemaVariant: z.string().describe("LexDania schema variant name."),
        documentType: z.string().describe("Danish legislation type (e.g., LOV, BEKH)."),
        totalElements: z.number().int().describe("Total XML elements counted."),
        maxDepth: z.number().int().describe("Max element nesting depth."),
        tags: z.record(z.string(), z.number()).describe("Most frequent element tags and counts."),
        attributes: z.array(z.string()).describe("Unique XML attributes present."),
        namespaces: z.record(z.string(), z.string()).describe("Prefix-to-URI mapping for document namespaces."),
      },
    },
    (args) =>
      presentMcpResult(async () => {
        const result = await profileDocument(deps, {
          eli: Eli.parse(args.eli),
          top: args.top ?? DEFAULT_TOP,
        });
        return {
          root: result.root,
          schemaVariant: result.schemaVariant,
          documentType: result.documentType,
          totalElements: result.totalElements,
          maxDepth: result.maxDepth,
          tags: result.tagFrequencies,
          attributes: result.attributes,
          namespaces: result.namespaces,
        };
      }),
  );
}
