import { WorkerEntrypoint } from "cloudflare:workers";
import { createMcpHandler } from "agents/mcp";
import { createLawSource, createLegislationCorpus } from "@/composition";
import { validateBearerAuth } from "@/http/auth";
import { handleResolve } from "@/http/resolver";
import { createServer } from "@/mcp/server";

/**
 * Internal membership/indexing resolver served through Workers Caching (see the
 * `exports` map in wrangler.jsonc). A cache hit answers membership without
 * listing the File Search store; concurrent misses for the same ELI collapse
 * onto a single indexing operation. Reachable only via `ctx.exports`, never routed publicly.
 */
export class DocumentResolver extends WorkerEntrypoint<Env> {
  /**
   * Resolves a `resolve-document/<eli>` loopback request to the corpus document name.
   *
   * @param request - The loopback GET request identifying the ELI
   * @returns A promise resolving to the resolver response with explicit cacheability headers
   */
  override async fetch(request: Request): Promise<Response> {
    return handleResolve(
      {
        lawSource: createLawSource(this.ctx),
        legislationCorpus: createLegislationCorpus(this.env),
        waitUntil: (promise) => this.ctx.waitUntil(promise),
      },
      request,
    );
  }
}

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
