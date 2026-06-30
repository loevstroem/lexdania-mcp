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

/**
 * A corpus of law text that can answer questions with citations. The law for a
 * scoped question is ingested on demand (deduplicated by ELI identity).
 */
export interface LegislationCorpus {
  has(eli: Eli): Promise<boolean>;
  ingest(eli: Eli, pdf: Blob): Promise<void>;
  answer(question: string, scopedEli: Eli | undefined, maxSources: number): Promise<GroundedAnswer>;
}
