import { CACHE_TTL_SECONDS } from "@/services/retsinformation/client";
import { Eli } from "@/services/retsinformation/eli";
import { type ResolverDependencies, ResolverUnavailableError, resolveDocument } from "@/services/retsinformation/resolver";

export const RESOLVE_PATH_PREFIX = "/resolve-document/";

// Loopback requests never leave the Worker; the host only satisfies URL parsing
// and is excluded from the cache key (path + query form the URL component).
const INTERNAL_ORIGIN = "https://lexdania-mcp.internal";

/** Minimal fetch surface of the DocumentResolver loopback binding. */
export interface ResolverFetcher {
  fetch(url: string): Promise<Response>;
}

/**
 * Builds the loopback URL resolving membership/indexing for one ELI.
 * The store name is part of the query so a cached positive answer never
 * outlives a FILE_SEARCH_STORE reconfiguration (path + query form the cache key).
 *
 * @param eli - The normalized ELI identifier of the document
 * @param storeName - Resource name of the File Search store resolved against
 * @returns The internal resolver URL keyed by ELI id and store
 */
export function resolveUrl(eli: Eli, storeName: string): string {
  return `${INTERNAL_ORIGIN}${RESOLVE_PATH_PREFIX}${encodeURIComponent(eli.id)}?store=${encodeURIComponent(storeName)}`;
}

/**
 * Resolves a law's corpus document name through the cached loopback entrypoint.
 *
 * @param resolver - Loopback binding for the DocumentResolver entrypoint
 * @param eli - The normalized ELI identifier of the document
 * @param storeName - Resource name of the File Search store resolved against
 * @returns A promise resolving to the corpus document name
 * @throws ResolverUnavailableError - When the transport fails or the response body is unusable; falling back is safe
 * @throws Error - When the remote resolver ran the resolution and it failed
 */
export async function requestResolvedDocument(resolver: ResolverFetcher, eli: Eli, storeName: string): Promise<string> {
  let response: Response;
  try {
    response = await resolver.fetch(resolveUrl(eli, storeName));
  } catch (error) {
    throw new ResolverUnavailableError(`document resolver unreachable for ${eli.id}`, { cause: error });
  }
  if (!response.ok) {
    const errorMessage = await readErrorMessage(response);
    if ((response.status >= 520 && response.status <= 526) || !errorMessage) {
      throw new ResolverUnavailableError(`document resolver unavailable for ${eli.id}: HTTP ${response.status}`);
    }
    // The remote resolver already ran the resolution and failed; surface that
    // failure rather than signalling fallback, which would re-run the index.
    throw new Error(`document resolver failed for ${eli.id}: ${errorMessage}`);
  }
  let body: { documentName?: string };
  try {
    body = (await response.json()) as { documentName?: string };
  } catch (error) {
    throw new ResolverUnavailableError(`document resolver returned a malformed body for ${eli.id}`, { cause: error });
  }
  if (!body.documentName) throw new ResolverUnavailableError(`document resolver returned no document name for ${eli.id}`);
  return body.documentName;
}

/**
 * Serves the internal `resolve-document/<eli>` membership/indexing resolver.
 * Only a successful resolution carries a fresh window, letting Workers Caching
 * store and collapse it; every other outcome is explicitly uncacheable so a
 * law keeps being re-checked until it indexes.
 *
 * @param deps - Law source, legislation corpus, and runtime-extension hook
 * @param request - The loopback GET request identifying the ELI
 * @returns A promise resolving to the resolver response with explicit cacheability headers
 */
export async function handleResolve(deps: ResolverDependencies, request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse(405, { error: "Method not allowed" }, "no-store");
  }
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(RESOLVE_PATH_PREFIX)) {
    return jsonResponse(404, { error: "Not found" }, "no-store");
  }
  let eli: Eli;
  try {
    eli = Eli.parse(decodeURIComponent(pathname.slice(RESOLVE_PATH_PREFIX.length)));
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : "Invalid ELI" }, "no-store");
  }
  try {
    const documentName = await resolveDocument(deps, { eli });
    // `public` + explicit max-age marks the response cacheable and collapsible;
    // the TTL mirrors the origin cache window for immutable-per-ELI legislation.
    return jsonResponse(200, { eli: eli.id, documentName }, `public, max-age=${CACHE_TTL_SECONDS}, stale-if-error=0`);
  } catch (error) {
    // Errors stay uncacheable (no-store) so the law is re-checked until it indexes.
    return jsonResponse(500, { error: error instanceof Error ? error.message : String(error) }, "no-store");
  }
}

/** Reads a structured resolver error body, or returns undefined when unusable. */
async function readErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Only the resolver's JSON error envelope proves the resolution ran.
  }
  return undefined;
}

function jsonResponse(status: number, body: Record<string, unknown>, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cacheControl },
  });
}
