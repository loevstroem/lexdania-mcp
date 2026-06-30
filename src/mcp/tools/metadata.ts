import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Eli } from "@/services/retsinformation/eli";
import { type MetadataDocumentDependencies, metadataDocument } from "@/services/retsinformation/service";
import { presentMcpResult } from "../result";

/**
 * Registers the `lexdania_metadata` tool to the MCP server.
 *
 * @param server - The target MCP server instance.
 * @param deps - Required dependencies for metadata retrieval operations.
 */
export function registerMetadataTool(server: McpServer, deps: MetadataDocumentDependencies): void {
  server.registerTool(
    "lexdania_metadata",
    {
      title: "Get Document Metadata",
      description:
        "Fetches and parses JSON-LD metadata for a Danish legislation document by its ELI path or URL. Returns facts such as title, document type, dates, ministry, status, and relationship edges (consolidates, basedOn, changes, commences).",
      inputSchema: {
        eli: z.string().describe("Document ELI path or URL (e.g. 'eli/lta/2024/48')."),
      },
      outputSchema: {
        eli: z.string().describe("Normalized ELI identifier."),
        title: z.string().optional().describe("Danish document title."),
        documentType: z.string().describe("Danish legislation type (e.g., LOV, LBKH, BEKH)."),
        dateDocument: z.string().optional().describe("Date of document signature/issue."),
        datePublication: z.string().optional().describe("Date of document publication."),
        ministry: z.string().optional().describe("Responsible ministry."),
        inForce: z.boolean().optional().describe("Whether the document is in force."),
        relationships: z
          .object({
            basedOn: z.array(z.string()).describe("ELIs of documents this resource is based on."),
            changes: z.array(z.string()).describe("ELIs of documents this resource changes."),
            consolidates: z.array(z.string()).describe("ELIs of documents this resource consolidates."),
            commences: z.array(z.string()).describe("ELIs of documents this resource commences (sets into force)."),
          })
          .describe("Cross-document relationship edges parsed from JSON-LD."),
      },
    },
    (args) =>
      presentMcpResult(async () => {
        return await metadataDocument(deps, {
          eli: Eli.parse(args.eli),
        });
      }),
  );
}
