import { GoogleGenAI } from "@google/genai";
import { GeminiLegislationCorpus } from "@/services/gemini/store";
import { RetsinformationClient } from "@/services/retsinformation/client";
import type { LawSource, LegislationCorpus } from "@/services/retsinformation/types";

/**
 * Creates the law source backed by retsinformation.dk with edge caching.
 *
 * @param ctx - The execution context of the current invocation
 * @returns A LawSource reading through the shared origin cache
 */
export function createLawSource(ctx: ExecutionContext): LawSource {
  // Namespaced handle instead of `caches.default`: keeps entries isolated and
  // sidesteps lib.dom's CacheStorage typing (pulled in by xpath), which lacks `default`.
  return new RetsinformationClient({
    cache: caches.open("retsinformation"),
    waitUntil: (promise) => ctx.waitUntil(promise),
  });
}

/**
 * Creates the Gemini-backed legislation corpus from Worker environment settings.
 *
 * @param env - The Cloudflare Worker environment variables
 * @returns A LegislationCorpus bound to the configured File Search store
 */
export function createLegislationCorpus(env: Env): LegislationCorpus {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return new GeminiLegislationCorpus(ai, {
    storeName: env.FILE_SEARCH_STORE,
    model: env.GEMINI_MODEL,
  });
}
