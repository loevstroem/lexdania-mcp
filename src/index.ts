import { createMcpHandler } from "agents/mcp";
import { validateBearerAuth } from "@/http/auth";
import { createServer } from "@/mcp/server";

/**
 * Worker entry. Routing and auth are transport concerns; everything below /mcp
 * is delegated to the MCP handler, which serves Streamable HTTP statelessly.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/") {
      return new Response("lexdania MCP server. Connect an MCP client to /mcp with a Bearer token.\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (pathname === "/mcp") {
      const authErrorResponse = validateBearerAuth(request, env.MCP_AUTH_TOKEN);
      if (authErrorResponse) return authErrorResponse;
      return createMcpHandler(createServer(env, ctx), { route: "/mcp" })(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
