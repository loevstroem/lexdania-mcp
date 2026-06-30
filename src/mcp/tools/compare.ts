import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Eli } from "@/services/retsinformation/eli";
import { type CompareStructureDependencies, compareStructureDocument } from "@/services/retsinformation/service";
import { presentMcpResult } from "../result";

/**
 * Registers the `lexdania_compare_structure` tool to the MCP server.
 *
 * @param server - The target MCP server instance.
 * @param deps - Required dependencies for structural comparison operations.
 */
export function registerCompareTool(server: McpServer, deps: CompareStructureDependencies): void {
  server.registerTool(
    "lexdania_compare_structure",
    {
      title: "Compare LexDania Structure",
      description:
        "Diffs structural elements and attributes across 2 or more LexDania XML documents to detect parser drift, showing which tags/attributes are in each, and which are unique to specific documents.",
      inputSchema: {
        elis: z.array(z.string()).min(2).describe("List of 2 or more document ELI paths or URLs to compare."),
      },
      outputSchema: {
        elements: z
          .array(
            z.object({
              tag: z.string().describe("XML element tag name."),
              presentIn: z.array(z.string()).describe("ELIs of documents containing this element."),
            }),
          )
          .describe("Union of all XML elements and where they are present."),
        attributes: z
          .array(
            z.object({
              name: z.string().describe("XML attribute name."),
              presentIn: z.array(z.string()).describe("ELIs of documents containing this attribute."),
            }),
          )
          .describe("Union of all XML attributes and where they are present."),
        onlyIn: z.record(z.string(), z.array(z.string())).describe("Mapping of document ELIs to XML tags unique to that document."),
      },
    },
    (args) =>
      presentMcpResult(async () => {
        return await compareStructureDocument(deps, {
          elis: args.elis.map((eli) => Eli.parse(eli)),
        });
      }),
  );
}
