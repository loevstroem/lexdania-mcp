import type { Eli } from "./eli";

/** Retrieves a single law's primary resources from the source of record. */
export interface LawSource {
  fetchXml(eli: Eli): Promise<string>;
  fetchPdf(eli: Eli): Promise<Blob>;
  fetchJson(eli: Eli): Promise<unknown>;
}

/** A reference to primary legal text supporting an answer. */
export interface Citation {
  eli: string;
  title?: string;
  /** Location within the law, e.g. a §/Stk path or page marker. */
  sectionPath?: string;
  snippet?: string;
}

export interface GroundedAnswer {
  answer: string;
  citations: Citation[];
}

// Poll budget for one on-demand indexing; indexing fails once exceeded.
// Shared so progress reporting stays in sync with the corpus implementation.
export const INDEX_BUDGET_MS = 120_000;

/** A snapshot of on-demand index progress, reported once per poll iteration. */
export interface IndexProgress {
  /** Milliseconds elapsed since the document upload completed. */
  elapsedMs: number;
  /** The total poll budget in milliseconds; indexing fails once exceeded. */
  totalMs: number;
  /** Human-readable status suitable for client display. */
  message: string;
}

export type IndexProgressReporter = (progress: IndexProgress) => void;

/**
 * A corpus of law text that can answer questions with citations. The law for a
 * scoped question is indexed on demand (deduplicated by ELI identity).
 * `find` resolves membership through the backing store, while `index` returns
 * the created document name.
 */
export interface LegislationCorpus {
  find(eli: Eli): Promise<string | undefined>;
  index(eli: Eli, pdf: Blob, onProgress?: IndexProgressReporter): Promise<string>;
  answer(question: string, scopedEli: Eli | undefined, maxSources: number): Promise<GroundedAnswer>;
}
