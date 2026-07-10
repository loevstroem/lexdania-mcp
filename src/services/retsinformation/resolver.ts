import type { Eli } from "./eli";
import type { IndexProgressReporter, LawSource, LegislationCorpus } from "./types";

/**
 * Dependencies required to resolve a law into the corpus.
 */
export interface ResolverDependencies {
  lawSource: LawSource;
  legislationCorpus: LegislationCorpus;
  /** Extends the runtime beyond the response, e.g. `ctx.waitUntil` on Workers. */
  waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * A request to resolve one law to its corpus document name.
 */
export interface ResolverRequest {
  eli: Eli;
  /** Receives indexing progress while a cold document is fetched and processed. */
  onProgress?: IndexProgressReporter;
}

/**
 * Signals that the cached resolver transport could not produce a resolution,
 * as opposed to the resolution itself having run and failed. Callers may fall
 * back to in-process resolution without risking a duplicate index.
 */
export class ResolverUnavailableError extends Error {
  /**
   * Constructs a new ResolverUnavailableError instance.
   *
   * @param message - Description of the transport failure
   * @param [options] - Standard error options, e.g. `cause`
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResolverUnavailableError";
  }
}

// Coalesces concurrent indexing of the same law within one isolate so parallel
// callers don't upload it twice. Best-effort: requests served by different
// isolates can still race — corpus.find() is the durable guard against indexing again.
interface PendingResolution {
  promise: Promise<string>;
  progressReporters: Set<IndexProgressReporter>;
}

const pendingResolutions = new Map<string, PendingResolution>();

/**
 * Resolves a law to its corpus document name, indexing it on demand when missing.
 * Concurrent calls for the same ELI within one isolate share a single resolution.
 *
 * @param deps - Law source, legislation corpus, and runtime-extension hook
 * @param request - Target ELI and optional progress reporter
 * @returns A promise resolving to the corpus document name
 * @throws An error when the PDF cannot be fetched or indexing fails.
 */
export async function resolveDocument(deps: ResolverDependencies, request: ResolverRequest): Promise<string> {
  const { lawSource, legislationCorpus } = deps;
  const eliId = request.eli.id;
  let pendingResolution = pendingResolutions.get(eliId);
  if (!pendingResolution) {
    const progressReporters = new Set<IndexProgressReporter>();
    if (request.onProgress) progressReporters.add(request.onProgress);
    // Clean up inside the awaited promise; a detached `.finally(...)` would be a
    // second, unhandled promise that rejects on every failed index.
    const resolutionPromise = Promise.resolve().then(async () => {
      try {
        const existing = await legislationCorpus.find(request.eli);
        if (existing) return existing;
        const pdf = await lawSource.fetchPdf(request.eli);
        return await legislationCorpus.index(request.eli, pdf, (progress) => {
          for (const reportProgress of progressReporters) reportProgress(progress);
        });
      } finally {
        pendingResolutions.delete(eliId);
      }
    });
    pendingResolution = { promise: resolutionPromise, progressReporters };
    pendingResolutions.set(eliId, pendingResolution);
  } else if (request.onProgress) {
    pendingResolution.progressReporters.add(request.onProgress);
  }
  deps.waitUntil(pendingResolution.promise);
  return pendingResolution.promise;
}
