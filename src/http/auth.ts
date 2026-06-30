/**
 * Validates the bearer token in the request's Authorization header.
 *
 * @param request - The incoming HTTP request.
 * @param expectedToken - The expected bearer token value.
 * @returns A 401 Response if validation fails, or null if the request may proceed.
 */
export function validateBearerAuth(request: Request, expectedToken: string | undefined): Response | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const providedToken = match?.[1]?.trim() ?? "";

  // `!expectedToken` fails closed when the secret is unset (undefined/empty) — a
  // missing token must 401, not throw a 500 on `.length` of undefined.
  if (!expectedToken || !constantTimeEqual(providedToken, expectedToken)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="lexdania-mcp"' },
    });
  }
  return null;
}

/**
 * Compares two strings in constant time to prevent timing attacks.
 * Note that string length is allowed to leak.
 *
 * @param a - The first string to compare.
 * @param b - The second string to compare.
 * @returns True if the strings are identical, false otherwise.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
