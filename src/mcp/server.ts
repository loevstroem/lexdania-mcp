import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLawSource, createLegislationCorpus } from "@/composition";
import { requestResolvedDocument } from "@/http/resolver";
import { LexDaniaXmlInspector } from "@/services/lexdania/xml";
import { SERVER_PROMPT } from "./prompt";
import { registerAskTool } from "./tools/ask";
import { registerCompareTool } from "./tools/compare";
import { registerMetadataTool } from "./tools/metadata";
import { registerQueryTool } from "./tools/query";
import { registerStructureTool } from "./tools/structure";

/**
 * Composition root for the MCP server.
 * A fresh server is constructed per request to prevent cross-client instance sharing.
 *
 * @param env - The Cloudflare Worker environment variables
 * @param ctx - The execution context of the current request
 * @returns The configured McpServer instance
 */
export function createServer(env: Env, ctx: ExecutionContext): McpServer {
  const lawSource = createLawSource(ctx);
  const xmlInspector = new LexDaniaXmlInspector();
  const legislationCorpus = createLegislationCorpus(env);

  const server = new McpServer({ name: "lexdania", version: "0.1.0" }, { instructions: SERVER_PROMPT });

  registerAskTool(server, {
    lawSource,
    legislationCorpus,
    // Loopback through the cached DocumentResolver entrypoint: hits skip the
    // store listing; concurrent misses collapse onto one indexing operation.
    resolveRemote: (eli) => requestResolvedDocument(ctx.exports.DocumentResolver, eli, env.FILE_SEARCH_STORE),
    waitUntil: (promise) => ctx.waitUntil(promise),
  });
  registerMetadataTool(server, { lawSource });
  registerCompareTool(server, { lawSource, xmlInspector });
  registerQueryTool(server, { lawSource, xmlInspector });
  registerStructureTool(server, { lawSource, xmlInspector });

  return server;
}
