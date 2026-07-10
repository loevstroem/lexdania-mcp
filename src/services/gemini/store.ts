import type { CustomMetadata, GoogleGenAI, Interactions } from "@google/genai";
import type { Eli } from "@/services/retsinformation/eli";
import { type Citation, type GroundedAnswer, INDEX_BUDGET_MS, type IndexProgressReporter, type LegislationCorpus } from "@/services/retsinformation/types";

/**
 * Configuration options for the Gemini-backed legislation corpus.
 */
export interface GeminiLegislationCorpusConfig {
  /** Resource name of the persistent File Search store, e.g. "fileSearchStores/abc". */
  storeName: string;
  /** Generation model, e.g. "gemini-3.5-flash". */
  model: string;
}

const ELI_METADATA_KEY = "eli";
const POLL_INTERVAL_MS = 5000;
// The shared budget caps the index poll to bound client-facing tool latency
// (Workers bill CPU time, not wall time, so the polling itself is essentially free).
const MAX_INDEX_MS = INDEX_BUDGET_MS;

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
    private readonly config: GeminiLegislationCorpusConfig,
  ) {}

  /**
   * Resolves a document (ELI) to its File Search document name if present.
   *
   * @param eli - The normalized ELI identifier of the document
   * @returns A promise resolving to the document resource name, or undefined when absent
   */
  async find(eli: Eli): Promise<string | undefined> {
    const pager = await this.ai.fileSearchStores.documents.list({
      parent: this.config.storeName,
      config: { pageSize: 20 },
    });
    for await (const doc of pager) {
      const storedEliId = doc.customMetadata?.find((meta) => meta.key === ELI_METADATA_KEY)?.stringValue;
      if (doc.displayName === eli.id || storedEliId === eli.id) {
        // The API guarantees a resource name; fall back to the ELI id so a
        // matched document is never mistaken for a missing one.
        const documentName = doc.name ?? eli.id;
        return documentName;
      }
    }
    return undefined;
  }

  /**
   * Indexes a PDF document by uploading it to the Gemini File Search store.
   * Blocks and polls the operation until processing completes or the deadline is reached.
   *
   * @param eli - The normalized ELI identifier of the document
   * @param pdf - The document PDF binary as a Blob
   * @param [onProgress] - Optional reporter invoked once per poll iteration
   * @returns A promise resolving to the created document resource name
   * @throws An error if indexing fails or does not complete within the maximum timeout duration
   */
  async index(eli: Eli, pdf: Blob, onProgress?: IndexProgressReporter): Promise<string> {
    const customMetadata: CustomMetadata[] = [{ key: ELI_METADATA_KEY, stringValue: eli.id }];
    let operation = await this.ai.fileSearchStores.uploadToFileSearchStore({
      file: pdf,
      fileSearchStoreName: this.config.storeName,
      config: { displayName: eli.id, customMetadata },
    });
    const startedAt = Date.now();
    const deadline = startedAt + MAX_INDEX_MS;
    onProgress?.({ elapsedMs: 0, totalMs: MAX_INDEX_MS, message: `Uploaded ${eli.id}; awaiting File Search processing` });
    while (!operation.done) {
      if (Date.now() >= deadline) {
        throw new Error(`Indexing of ${eli.id} did not finish within ${MAX_INDEX_MS}ms`);
      }
      await sleep(POLL_INTERVAL_MS);
      operation = await this.ai.operations.get({ operation });
      onProgress?.({
        elapsedMs: Math.min(Date.now() - startedAt, MAX_INDEX_MS),
        totalMs: MAX_INDEX_MS,
        message: operation.done ? `Indexed ${eli.id} into File Search` : `Indexing ${eli.id} into File Search`,
      });
    }
    if (operation.error) {
      const message = typeof operation.error.message === "string" ? operation.error.message : JSON.stringify(operation.error);
      throw new Error(`Indexing of ${eli.id} failed: ${message}`);
    }
    const documentName = operation.response?.documentName;
    if (!documentName) throw new Error(`Indexing of ${eli.id} completed without a document name`);
    return documentName;
  }

  /**
   * Answers a free-text question against the corpus using Gemini File Search.
   *
   * @param question - The natural language query
   * @param [scopedEli] - Optional ELI identifier to restrict search to a single document
   * @param maxSources - Maximum number of unique citations to return
   * @returns A promise resolving to the grounded response containing text and citations
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
 * @param fileCitation - The file citation annotation from the Interactions API
 * @returns A normalized Citation object
 */
function toDomainCitation(fileCitation: Interactions.FileCitation): Citation {
  const storedEliId = fileCitation.custom_metadata?.[ELI_METADATA_KEY];
  return {
    eli: typeof storedEliId === "string" ? storedEliId : (fileCitation.file_name ?? ""),
    title: fileCitation.file_name,
    sectionPath: fileCitation.page_number !== undefined ? `p.${fileCitation.page_number}` : undefined,
    snippet: fileCitation.source,
  };
}

/**
 * Utility helper to pause execution for a given number of milliseconds.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
