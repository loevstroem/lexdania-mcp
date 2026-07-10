import type { QueryResult, StructureProfile, XmlInspector } from "@/services/lexdania/types";
import { Eli } from "./eli";
import type { GroundedAnswer, IngestProgressReporter, LawSource, LegislationCorpus } from "./types";

export interface AskDocumentDependencies {
  lawSource: LawSource;
  legislationCorpus: LegislationCorpus;
  /** Extends the runtime beyond the response, e.g. `ctx.waitUntil` on Workers. */
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface AskDocumentRequest {
  question: string;
  /** When set, only this law is searched; otherwise the whole corpus. */
  scopedEli?: Eli;
  maxSources: number;
  /** Receives ingest progress while a cold scoped ask fetches and processes the law. */
  onIngestProgress?: IngestProgressReporter;
}

// Coalesces concurrent ingestions of the same law within one isolate so parallel
// tool calls don't upload it twice. Best-effort: requests served by different
// isolates can still race — store.has() is the durable guard against re-ingesting.
interface PendingIngestion {
  promise: Promise<void>;
  progressReporters: Set<IngestProgressReporter>;
}

const pendingIngestions = new Map<string, PendingIngestion>();

/**
 * Answer a free-text question against legislation, with citations.
 * A scoped law is fetched and ingested on demand if the store doesn't have it yet.
 */
export async function askDocument(deps: AskDocumentDependencies, request: AskDocumentRequest): Promise<GroundedAnswer> {
  const { lawSource, legislationCorpus } = deps;

  const scopedEli = request.scopedEli;
  if (scopedEli) {
    const eliId = scopedEli.id;
    let pendingIngestion = pendingIngestions.get(eliId);
    if (!pendingIngestion) {
      const progressReporters = new Set<IngestProgressReporter>();
      if (request.onIngestProgress) progressReporters.add(request.onIngestProgress);
      // Clean up inside the awaited promise; a detached `.finally(...)` would be a
      // second, unhandled promise that rejects on every failed ingest.
      const ingestionPromise = Promise.resolve().then(async () => {
        try {
          if (!(await legislationCorpus.has(scopedEli))) {
            const pdf = await lawSource.fetchPdf(scopedEli);
            await legislationCorpus.ingest(scopedEli, pdf, (progress) => {
              for (const reportProgress of progressReporters) reportProgress(progress);
            });
          }
        } finally {
          pendingIngestions.delete(eliId);
        }
      });
      pendingIngestion = { promise: ingestionPromise, progressReporters };
      pendingIngestions.set(eliId, pendingIngestion);
    } else if (request.onIngestProgress) {
      pendingIngestion.progressReporters.add(request.onIngestProgress);
    }
    deps.waitUntil(pendingIngestion.promise);
    await pendingIngestion.promise;
  }

  const result = await legislationCorpus.answer(request.question, scopedEli, request.maxSources);

  // Post-process citations to enrich their titles from JSON-LD metadata in parallel
  const enrichedCitations = await Promise.all(
    result.citations.map(async (citation) => {
      try {
        const eli = Eli.parse(citation.eli);
        const metadata = await metadataDocument({ lawSource }, { eli });
        return {
          ...citation,
          title: metadata.title || citation.title,
        };
      } catch {
        // Fallback to existing title (typically the ELI ID) on any fetch/parse error
        return citation;
      }
    }),
  );

  return {
    answer: result.answer,
    citations: enrichedCitations,
  };
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

  const profiles = await Promise.all(
    request.elis.map(async (eli) => {
      const profile = await profileDocument(deps, { eli, top: 0 });
      return { eliId: eli.id, profile };
    }),
  );

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
