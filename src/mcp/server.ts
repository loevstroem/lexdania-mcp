import { GoogleGenAI } from "@google/genai";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GeminiLegislationCorpus } from "@/services/gemini/store";
import { LexDaniaXmlInspector } from "@/services/lexdania/xml";
import { RetsinformationClient } from "@/services/retsinformation/client";
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
 * @param env - The Cloudflare Worker environment variables.
 * @param ctx - The execution context of the current request.
 * @returns The configured McpServer instance.
 */
export function createServer(env: Env, ctx: ExecutionContext): McpServer {
  const lawSource = new RetsinformationClient();
  const xmlInspector = new LexDaniaXmlInspector();
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const legislationCorpus = new GeminiLegislationCorpus(ai, {
    storeName: env.FILE_SEARCH_STORE,
    model: env.GEMINI_MODEL,
  });

  const server = new McpServer({ name: "lexdania", version: "0.1.0" }, { instructions: SERVER_PROMPT });

  registerAskTool(server, { lawSource, legislationCorpus, waitUntil: (promise) => ctx.waitUntil(promise) });
  registerMetadataTool(server, { lawSource });
  registerCompareTool(server, { lawSource, xmlInspector });
  registerQueryTool(server, { lawSource, xmlInspector });
  registerStructureTool(server, { lawSource, xmlInspector });

  return server;
}
