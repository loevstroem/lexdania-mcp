import type { CustomMetadata, GoogleGenAI, Interactions } from "@google/genai";
import type { Eli } from "@/services/retsinformation/eli";
import type { Citation, GroundedAnswer, LegislationCorpus } from "@/services/retsinformation/types";

/**
 * Configuration options for the Gemini-backed legislation corpus.
 */
export interface GeminiAnswerStoreConfig {
  /** Resource name of the persistent File Search store, e.g. "fileSearchStores/abc". */
  storeName: string;
  /** Generation model, e.g. "gemini-3.5-flash". */
  model: string;
}

const ELI_METADATA_KEY = "eli";
const POLL_INTERVAL_MS = 5000;
// Cap the ingest poll so a stuck operation can't hold the Worker request open
// indefinitely (and keep billing duration). The caller surfaces this as a tool error.
const MAX_INGEST_MS = 120_000;

// Best-effort, per-isolate cache of ingested ELIs. NOT shared across isolates and
// never invalidated — treat it as an optimization over has(), not a source of truth.
const knownIngested = new Set<string>();

/**
 * An implementation of the `LegislationCorpus` interface backed by
 * Gemini File Search and the Google GenAI Interactions API.
 *
 * Serves as the anti-corruption layer for Gemini, encapsulating file uploading,
 * status polling, and conversion of API annotations to domain citations.
 */
export class GeminiLegislationCorpus implements LegislationCorpus {
  /**
   * Constructs a new GeminiLegislationCorpus instance.
   *
   * @param ai - The Google GenAI client instance.
   * @param config - The config options containing storeName and model.
   */
  constructor(
    private readonly ai: GoogleGenAI,
    private readonly config: GeminiAnswerStoreConfig,
  ) {}

  /**
   * Checks if a document (ELI) is already present in the File Search store.
   * Uses a local per-isolate set cache as an initial quick check.
   *
   * @param eli - The normalized ELI identifier of the document.
   * @returns A promise resolving to true if the document exists in the store, false otherwise.
   */
  async has(eli: Eli): Promise<boolean> {
    if (knownIngested.has(eli.id)) return true;
    const pager = await this.ai.fileSearchStores.documents.list({
      parent: this.config.storeName,
      config: { pageSize: 20 },
    });
    for await (const doc of pager) {
      const storedEliId = doc.customMetadata?.find((m) => m.key === ELI_METADATA_KEY)?.stringValue;
      if (doc.displayName === eli.id || storedEliId === eli.id) {
        knownIngested.add(eli.id);
        return true;
      }
    }
    return false;
  }

  /**
   * Ingests a PDF document by uploading it to the Gemini File Search store.
   * Blocks and polls the operation until processing completes or the deadline is reached.
   *
   * @param eli - The normalized ELI identifier of the document.
   * @param pdf - The document PDF binary as a Blob.
   * @throws An error if ingestion does not complete within the maximum timeout duration.
   */
  async ingest(eli: Eli, pdf: Blob): Promise<void> {
    const customMetadata: CustomMetadata[] = [{ key: ELI_METADATA_KEY, stringValue: eli.id }];
    let operation = await this.ai.fileSearchStores.uploadToFileSearchStore({
      file: pdf,
      fileSearchStoreName: this.config.storeName,
      config: { displayName: eli.id, customMetadata },
    });
    const deadline = Date.now() + MAX_INGEST_MS;
    while (!operation.done) {
      if (Date.now() > deadline) {
        throw new Error(`Ingestion of ${eli.id} did not finish within ${MAX_INGEST_MS}ms`);
      }
      await sleep(POLL_INTERVAL_MS);
      operation = await this.ai.operations.get({ operation });
    }
    knownIngested.add(eli.id);
  }

  /**
   * Answers a free-text question against the corpus using Gemini File Search.
   *
   * @param question - The natural language query.
   * @param scopedEli - Optional ELI identifier to restrict search to a single document.
   * @param maxSources - Maximum number of unique citations to return.
   * @returns A promise resolving to the grounded response containing text and citations.
   */
  async answer(question: string, scopedEli: Eli | undefined, maxSources: number): Promise<GroundedAnswer> {
    const fileSearch = {
      type: "file_search" as const,
      file_search_store_names: [this.config.storeName],
      ...(scopedEli ? { metadata_filter: `${ELI_METADATA_KEY} = ${JSON.stringify(scopedEli.id)}` } : {}),
    };

    const interaction = await this.ai.interactions.create({
      model: this.config.model,
      input: question,
      tools: [fileSearch],
    });

    let answer = "";
    const citations: Citation[] = [];
    const seenCitations = new Set<string>();
    for (const step of interaction.steps) {
      if (step.type !== "model_output") continue;
      for (const block of step.content ?? []) {
        if (block.type !== "text") continue;
        answer += block.text;
        for (const fileCitation of block.annotations ?? []) {
          if (fileCitation.type !== "file_citation") continue;
          const citation = toDomainCitation(fileCitation);
          // Gemini repeats the same file_citation per text span; dedup so identical
          // citations don't consume the maxSources budget and crowd out other laws.
          const key = `${citation.eli} ${citation.sectionPath ?? ""} ${citation.snippet ?? ""}`;
          if (seenCitations.has(key)) continue;
          if (citations.length >= maxSources) break;
          seenCitations.add(key);
          citations.push(citation);
        }
      }
    }

    return { answer, citations };
  }
}

/**
 * Translates a raw Gemini file citation annotation into a domain-specific Citation.
 *
 * @param annotation - The file citation annotation from the Interactions API.
 * @returns A normalized Citation object.
 */
function toDomainCitation(annotation: Interactions.FileCitation): Citation {
  const storedEliId = annotation.custom_metadata?.[ELI_METADATA_KEY];
  return {
    eli: typeof storedEliId === "string" ? storedEliId : (annotation.file_name ?? ""),
    title: annotation.file_name,
    sectionPath: annotation.page_number !== undefined ? `p.${annotation.page_number}` : undefined,
    snippet: annotation.source,
  };
}

/**
 * Utility helper to pause execution for a given number of milliseconds.
 *
 * @param ms - Milliseconds to sleep.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
