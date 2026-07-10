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

/** A snapshot of on-demand ingest progress, reported once per poll iteration. */
export interface IngestProgress {
  /** Milliseconds elapsed since the document upload completed. */
  elapsedMs: number;
  /** The total poll budget in milliseconds; ingestion fails once exceeded. */
  totalMs: number;
  /** Human-readable status suitable for client display. */
  message: string;
}

export type IngestProgressReporter = (progress: IngestProgress) => void;

/**
 * A corpus of law text that can answer questions with citations. The law for a
 * scoped question is ingested on demand (deduplicated by ELI identity).
 */
export interface LegislationCorpus {
  has(eli: Eli): Promise<boolean>;
  ingest(eli: Eli, pdf: Blob, onProgress?: IngestProgressReporter): Promise<void>;
  answer(question: string, scopedEli: Eli | undefined, maxSources: number): Promise<GroundedAnswer>;
}
