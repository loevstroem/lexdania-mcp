import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Eli } from "@/services/retsinformation/eli";
import { type AskDocumentDependencies, askDocument } from "@/services/retsinformation/service";
import type { IngestProgress } from "@/services/retsinformation/types";
import { presentMcpResult } from "../result";

const DEFAULT_MAX_SOURCES = 8;

/**
 * Registers the `lexdania_ask_document` tool to the MCP server.
 *
 * @param server - The target MCP server instance.
 * @param deps - Required dependencies for document Q&A operations.
 */
export function registerAskTool(server: McpServer, deps: AskDocumentDependencies): void {
  server.registerTool(
    "lexdania_ask_document",
    {
      title: "Ask Danish legislation",
      description: "Free-text Q&A over Danish legislative documents; for deep research and fact-checking. Returns a synthesized answer plus citations to primary text.",
      inputSchema: {
        question: z.string().min(1).describe("Natural language query."),
        eli: z.string().optional().describe("Filter to single document (URI/path) or omit for entire corpus."),
        maxSources: z.number().int().positive().optional().describe("Max citations to return (default: 8)."),
      },
      outputSchema: {
        answer: z.string().describe("Answer grounded in document text."),
        citations: z
          .array(
            z.object({
              eli: z.string().describe("Canonical ELI identifier."),
              title: z.string().optional().describe("Document title."),
              path: z.string().optional().describe("Section/page indicator within document."),
              snippet: z.string().optional().describe("Relevant text excerpt."),
            }),
          )
          .describe("Supporting text citations."),
      },
    },
    (args, extra) => {
      const progressToken = extra._meta?.progressToken;
      const onIngestProgress =
        progressToken === undefined
          ? undefined
          : (progress: IngestProgress) => {
              extra
                .sendNotification({
                  method: "notifications/progress",
                  params: { progressToken, progress: progress.elapsedMs, total: progress.totalMs, message: progress.message },
                })
                .catch(() => {});
            };
      return presentMcpResult(async () => {
        const result = await askDocument(deps, {
          question: args.question,
          scopedEli: args.eli ? Eli.parse(args.eli) : undefined,
          maxSources: args.maxSources ?? DEFAULT_MAX_SOURCES,
          onIngestProgress,
        });
        return {
          answer: result.answer,
          citations: result.citations.map((c) => ({
            eli: c.eli,
            title: c.title,
            path: c.sectionPath,
            snippet: c.snippet,
          })),
        };
      });
    },
  );
}
