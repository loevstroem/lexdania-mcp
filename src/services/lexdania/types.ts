/**
 * Selects the node representation returned by an XPath query.
 */
export type QueryFormat = "text" | "xml" | "both";

/**
 * Configures XPath query result selection.
 */
export interface QueryOptions {
  /** Maximum number of matches to return. */
  limit: number;
  /** Node representation to include. */
  format: QueryFormat;
  /** Maximum serialized node size in bytes. */
  maxNodeBytes: number;
}

/**
 * Identifies an ancestor element in a query match path.
 */
export interface QueryAncestor {
  /** Element tag name. */
  tag: string;
  /** Element ordinal among matching siblings. */
  ordinal: number;
  /** Element identifier. */
  id?: string;
  /** Element local identifier. */
  localId?: string;
}

/**
 * Describes the ancestry of a query match.
 */
export interface QueryAncestry {
  /** XPath-like ancestry path. */
  path: string;
  /** Ancestor elements in document order. */
  elements: QueryAncestor[];
  /** Explicatus identifiers in the ancestry. */
  explicatus: string[];
}

/**
 * Represents a complete XPath node match.
 */
export interface FullQueryMatch {
  kind: "match";
  tag: string;
  xml?: string;
  text?: string;
  ancestry: QueryAncestry;
}

/**
 * Represents an XPath node omitted because of its serialized size.
 */
export interface OversizeQueryMatch {
  kind: "stub";
  tag: string;
  approxBytes: number;
  childTagCounts: Record<string, number>;
  hint: string;
  ancestry: QueryAncestry;
}

/**
 * Represents a complete or size-limited XPath node match.
 */
export type QueryMatch = FullQueryMatch | OversizeQueryMatch;

/**
 * Represents the structured result of an XPath query evaluation.
 */
export interface QueryResult {
  /** Total number of matched nodes in the document. */
  count: number;
  /** Matching nodes truncated to the requested limit. */
  matches: QueryMatch[];
  /** Scalar value produced by a non-node XPath expression. */
  scalarValue?: number | string | boolean;
}

/**
 * Represents the structural metadata profile of an XML document.
 */
export interface StructureProfile {
  /** The XML root element tag name. */
  root: string;
  /** The detected LexDania schema version/variant. */
  schemaVariant: string;
  /** The Danish publication document type (e.g. LOV, BEKH). */
  documentType: string;
  /** The total number of XML elements in the document. */
  totalElements: number;
  /** The maximum element nesting depth. */
  maxDepth: number;
  /** Frequencies of elements, keyed by tag name and sorted descending by frequency. */
  tagFrequencies: Record<string, number>;
  /** Unique XML attributes present in the document, sorted alphabetically. */
  attributes: string[];
  /** Prefix-to-URI mapping for document namespaces. */
  namespaces: Record<string, string>;
}

/**
 * Deterministic inspector that queries and profiles LexDania XML structures.
 */
export interface XmlInspector {
  /**
   * Evaluates an XPath expression against the provided XML content.
   *
   * @param xml - The raw LexDania XML payload.
   * @param xpath - The namespace-aware XPath query string.
   * @param options - Query result selection options
   * @returns Query execution results
   */
  query(xml: string, xpath: string, options: QueryOptions): QueryResult;

  /**
   * Profiles the structural element and attribute composition of the XML document.
   *
   * @param xml - The raw LexDania XML payload.
   * @param top - The maximum number of frequent tags to include in frequencies.
   * @returns The structural metadata profile.
   */
  profile(xml: string, top: number): StructureProfile;
}
