/**
 * Represents the structured result of an XPath query evaluation.
 */
export interface QueryResult {
  /** The total number of matched nodes in the document. */
  count: number;
  /** Serialized matching nodes, truncated to the requested limit. */
  nodes: string[];
  /** Plain-text content of each matched node, same order as nodes. */
  text: string[];
  /** The scalar value result of evaluated XPath expressions (e.g. counts, string values). */
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
   * @param limit - The maximum number of serialized nodes to return.
   * @returns The query execution results.
   */
  query(xml: string, xpath: string, limit: number): QueryResult;

  /**
   * Profiles the structural element and attribute composition of the XML document.
   *
   * @param xml - The raw LexDania XML payload.
   * @param top - The maximum number of frequent tags to include in frequencies.
   * @returns The structural metadata profile.
   */
  profile(xml: string, top: number): StructureProfile;
}
