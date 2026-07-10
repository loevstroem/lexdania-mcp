import type { QueryResult, StructureProfile, XmlInspector } from "@/services/lexdania/types";
import { Eli } from "./eli";
import { ResolverUnavailableError, resolveDocument } from "./resolver";
import { type GroundedAnswer, INDEX_BUDGET_MS, type IndexProgressReporter, type LawSource, type LegislationCorpus } from "./types";

export interface AskDocumentDependencies {
  lawSource: LawSource;
  legislationCorpus: LegislationCorpus;
  /**
   * Resolves membership/indexing through the edge-cached loopback entrypoint.
   * Omitted or failing: resolution falls back to the in-process corpus path.
   */
  resolveRemote?: (eli: Eli) => Promise<string>;
  /** Extends the runtime beyond the response, e.g. `ctx.waitUntil` on Workers. */
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface AskDocumentRequest {
  question: string;
  /** When set, only this law is searched; otherwise the whole corpus. */
  scopedEli?: Eli;
  maxSources: number;
  /** Receives indexing progress while a cold scoped ask fetches and processes the law. */
  onIndexProgress?: IndexProgressReporter;
}

const HEARTBEAT_INTERVAL_MS = 5_000;
// Upper bound for one remote resolution: the indexing poll budget plus a margin
// for fetching the PDF from the origin.
const HEARTBEAT_TOTAL_MS = INDEX_BUDGET_MS + 30_000;

/**
 * Answers a free-text question against legislation, with citations.
 * A scoped law is fetched and indexed on demand if the store doesn't have it yet.
 *
 * @param deps - Dependencies including the law source and legislation corpus
 * @param request - Query parameters and optional scoped ELI
 * @returns A promise resolving to the grounded answer with citations
 */
export async function askDocument(deps: AskDocumentDependencies, request: AskDocumentRequest): Promise<GroundedAnswer> {
  const { lawSource, legislationCorpus } = deps;

  const scopedEli = request.scopedEli;
  if (scopedEli) {
    await prepareDocument(deps, scopedEli, request.onIndexProgress);
  }

  const result = await legislationCorpus.answer(request.question, scopedEli, request.maxSources);

  // Post-process citations to enrich their titles from JSON-LD metadata in parallel
  const distinctElis = [...new Set(result.citations.map((citation) => citation.eli))];
  const titlesByEli = new Map(
    await Promise.all(
      distinctElis.map(async (rawEli): Promise<[string, string | undefined]> => {
        try {
          const metadata = await metadataDocument({ lawSource }, { eli: Eli.parse(rawEli) });
          return [rawEli, metadata.title];
        } catch {
          // Fallback to existing title (typically the ELI ID) on any fetch/parse error
          return [rawEli, undefined];
        }
      }),
    ),
  );

  const enrichedCitations = result.citations.map((citation) => ({
    ...citation,
    title: titlesByEli.get(citation.eli) || citation.title,
  }));

  return {
    answer: result.answer,
    citations: enrichedCitations,
  };
}

/**
 * Guarantees the scoped law is present in the corpus before answering.
 * Uses the cached resolver first so a cache hit skips the store listing, and
 * resolves in-process only when the cached transport is absent or unavailable.
 *
 * @param deps - Ask-flow dependencies including the optional cached resolver
 * @param eli - The normalized ELI identifier of the scoped law
 * @param [onProgress] - Reporter kept alive during cold resolutions
 * @throws An error surfaced from the remote resolution when it ran and failed; re-running it in-process could duplicate the index
 */
async function prepareDocument(deps: AskDocumentDependencies, eli: Eli, onProgress?: IndexProgressReporter): Promise<void> {
  const { resolveRemote } = deps;
  let lastProgress = -1;
  const reportProgress: IndexProgressReporter | undefined = onProgress
    ? (progress) => {
        if (progress.elapsedMs <= lastProgress) return;
        lastProgress = progress.elapsedMs;
        onProgress(progress);
      }
    : undefined;
  if (resolveRemote) {
    const resolution = resolveRemote(eli);
    // Backstop so a remote index can finish even if the client disconnects.
    deps.waitUntil(resolution.catch(() => {}));
    const stopHeartbeat = reportProgress ? startHeartbeat(eli, reportProgress) : undefined;
    try {
      await resolution;
      return;
    } catch (error) {
      if (!(error instanceof ResolverUnavailableError)) throw error;
      console.warn(`cached resolver unavailable for ${eli.id}; resolving in-process`, error);
    } finally {
      stopHeartbeat?.();
    }
  }
  await resolveDocument(deps, { eli, onProgress: reportProgress });
}

/**
 * Emits periodic progress while a remote resolution is in flight. The cached
 * resolver indexes out-of-band, so per-poll progress cannot cross the loopback
 * boundary; the heartbeat keeps cold scoped asks reporting activity.
 *
 * @param eli - The normalized ELI identifier of the scoped law
 * @param reportProgress - Reporter invoked once per heartbeat interval
 * @returns A function stopping the heartbeat
 */
function startHeartbeat(eli: Eli, reportProgress: IndexProgressReporter): () => void {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= HEARTBEAT_TOTAL_MS) {
      // MCP requires the progress value to increase per notification; go
      // silent rather than repeat the capped value for an overlong resolution.
      clearInterval(timer);
      return;
    }
    reportProgress({
      elapsedMs,
      totalMs: HEARTBEAT_TOTAL_MS,
      message: `Ensuring ${eli.id} is indexed into File Search`,
    });
  }, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}

export interface QueryDocumentDependencies {
  lawSource: LawSource;
  xmlInspector: XmlInspector;
}

export interface QueryDocumentRequest {
  eli: Eli;
  xpath: string;
  limit: number;
}

/** Run an exact, namespace-aware XPath query against one law's LexDania XML. */
export async function queryDocument(deps: QueryDocumentDependencies, request: QueryDocumentRequest): Promise<QueryResult> {
  const xml = await deps.lawSource.fetchXml(request.eli);
  return deps.xmlInspector.query(xml, request.xpath, request.limit);
}

export interface ProfileDocumentDependencies {
  lawSource: LawSource;
  xmlInspector: XmlInspector;
}

export interface ProfileDocumentRequest {
  eli: Eli;
  top: number;
}

/** Produce a compact structural profile of one law's LexDania XML. */
export async function profileDocument(deps: ProfileDocumentDependencies, request: ProfileDocumentRequest): Promise<StructureProfile> {
  const xml = await deps.lawSource.fetchXml(request.eli);
  return deps.xmlInspector.profile(xml, request.top);
}

export interface MetadataDocumentDependencies {
  lawSource: LawSource;
}

export interface MetadataDocumentRequest {
  eli: Eli;
}

export interface DocumentMetadata {
  eli: string;
  title?: string;
  documentType: string;
  dateDocument?: string;
  datePublication?: string;
  ministry?: string;
  inForce?: boolean;
  relationships: {
    basedOn: string[];
    changes: string[];
    consolidates: string[];
    commences: string[];
  };
}

export async function metadataDocument(deps: MetadataDocumentDependencies, request: MetadataDocumentRequest): Promise<DocumentMetadata> {
  const jsonLd = await deps.lawSource.fetchJson(request.eli);
  if (!Array.isArray(jsonLd)) {
    throw new Error("Invalid metadata format received from Retsinformation.dk");
  }

  const legalResource = jsonLd.find((item) => hasType(item, "http://data.europa.eu/eli/ontology#LegalResource"));
  const legalExpression = jsonLd.find((item) => hasType(item, "http://data.europa.eu/eli/ontology#LegalExpression"));

  if (!legalResource) {
    throw new Error("LegalResource metadata fragment not found");
  }

  const documentTypeUri = getFirstId(legalResource, "http://data.europa.eu/eli/ontology#type_document");
  const documentType = documentTypeUri ? extractFragment(documentTypeUri) : "unknown";

  const inForceId = getFirstId(legalResource, "http://data.europa.eu/eli/ontology#in_force");
  const inForce = inForceId ? inForceId.toLowerCase().endsWith("inforce-inforce") : undefined;

  const dateDocument = normalizeDateToIso(getFirstValue(legalResource, "http://data.europa.eu/eli/ontology#date_document"));
  const datePublication = normalizeDateToIso(getFirstValue(legalResource, "http://data.europa.eu/eli/ontology#date_publication"));
  const ministry = getFirstValue(legalResource, "http://data.europa.eu/eli/ontology#responsibility_of");

  const title = legalExpression ? getFirstValue(legalExpression, "http://data.europa.eu/eli/ontology#title") : undefined;

  return {
    eli: request.eli.id,
    title,
    documentType,
    dateDocument,
    datePublication,
    ministry,
    inForce,
    relationships: {
      basedOn: getElisArray(legalResource, "http://data.europa.eu/eli/ontology#based_on"),
      changes: getElisArray(legalResource, "http://data.europa.eu/eli/ontology#changes"),
      consolidates: getElisArray(legalResource, "http://data.europa.eu/eli/ontology#consolidates"),
      commences: getElisArray(legalResource, "http://data.europa.eu/eli/ontology#commences"),
    },
  };
}

function hasType(item: Record<string, unknown>, typeUri: string): boolean {
  const type = item["@type"];
  if (Array.isArray(type)) return type.includes(typeUri);
  return type === typeUri;
}

function getFirstValue(item: Record<string, unknown>, predicate: string): string | undefined {
  const values = item[predicate];
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const first = values[0] as Record<string, unknown> | undefined;
  return first?.["@value"] as string | undefined;
}

function getFirstId(item: Record<string, unknown>, predicate: string): string | undefined {
  const values = item[predicate];
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const first = values[0] as Record<string, unknown> | undefined;
  return first?.["@id"] as string | undefined;
}

function extractFragment(uri: string): string {
  const hashIndex = uri.indexOf("#");
  if (hashIndex >= 0) return uri.slice(hashIndex + 1);
  const slashIndex = uri.lastIndexOf("/");
  if (slashIndex >= 0) return uri.slice(slashIndex + 1);
  return uri;
}

function getElisArray(item: Record<string, unknown>, predicate: string): string[] {
  const values = item[predicate];
  if (!Array.isArray(values)) return [];
  const elis: string[] = [];
  for (const valObj of values) {
    if (typeof valObj === "object" && valObj !== null) {
      const obj = valObj as Record<string, unknown>;
      const rawVal = obj["@value"] || obj["@id"];
      if (typeof rawVal === "string") {
        try {
          elis.push(Eli.parse(rawVal).id);
        } catch {
          // Skip invalid/non-Danish ELIs
        }
      }
    }
  }
  return elis;
}

export const MAX_COMPARE_ELIS = 5;

export interface CompareStructureDependencies {
  lawSource: LawSource;
  xmlInspector: XmlInspector;
}

export interface CompareStructureRequest {
  elis: Eli[];
}

export interface TagPresence {
  tag: string;
  presentIn: string[];
}

export interface AttributePresence {
  name: string;
  presentIn: string[];
}

export interface StructureComparison {
  elements: TagPresence[];
  attributes: AttributePresence[];
  onlyIn: Record<string, string[]>;
}

export async function compareStructureDocument(deps: CompareStructureDependencies, request: CompareStructureRequest): Promise<StructureComparison> {
  if (request.elis.length < 2) {
    throw new Error("Must provide at least 2 ELIs for structure comparison");
  }
  if (request.elis.length > MAX_COMPARE_ELIS) {
    throw new Error(`Must provide at most ${MAX_COMPARE_ELIS} ELIs for structure comparison`);
  }

  const profiles: { eliId: string; profile: StructureProfile }[] = [];
  for (const eli of request.elis) {
    profiles.push({ eliId: eli.id, profile: await profileDocument(deps, { eli, top: 0 }) });
  }

  const allElements = new Set<string>();
  const allAttributes = new Set<string>();

  for (const { profile } of profiles) {
    for (const tag of Object.keys(profile.tagFrequencies)) {
      allElements.add(tag);
    }
    for (const attr of profile.attributes) {
      allAttributes.add(attr);
    }
  }

  const elements: TagPresence[] = [];
  for (const tag of [...allElements].sort()) {
    const presentIn = profiles.filter(({ profile }) => tag in profile.tagFrequencies).map(({ eliId }) => eliId);
    elements.push({ tag, presentIn });
  }

  const attributes: AttributePresence[] = [];
  for (const attr of [...allAttributes].sort()) {
    const presentIn = profiles.filter(({ profile }) => profile.attributes.includes(attr)).map(({ eliId }) => eliId);
    attributes.push({ name: attr, presentIn });
  }

  const onlyIn: Record<string, string[]> = {};
  for (const { eliId, profile } of profiles) {
    const uniqueTags: string[] = [];
    for (const tag of Object.keys(profile.tagFrequencies)) {
      const isUnique = profiles.every((other) => other.eliId === eliId || !(tag in other.profile.tagFrequencies));
      if (isUnique) {
        uniqueTags.push(tag);
      }
    }
    onlyIn[eliId] = uniqueTags.sort();
  }

  return {
    elements,
    attributes,
    onlyIn,
  };
}

function normalizeDateToIso(dateStr: string | undefined): string | undefined {
  if (!dateStr) return undefined;
  const match = /^(\d{2})-(\d{2})-(\d{4})/.exec(dateStr.trim());
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}
