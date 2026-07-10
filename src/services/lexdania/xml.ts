import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import * as xpath from "xpath";
import { ATTRIBUTE_NODE, CDATA_NODE, ELEMENT_NODE, TEXT_NODE, type XmlAttr, type XmlDocument, type XmlElement, type XmlNode } from "./dom";
import type { FullQueryMatch, QueryOptions, QueryResult, StructureProfile, XmlInspector } from "./types";

type Selector = (expression: string, node: unknown) => unknown;

/**
 * Namespace-aware XPath parser and structural profiling inspector for LexDania XML.
 * Implements {@link XmlInspector}.
 */
export class LexDaniaXmlInspector implements XmlInspector {
  /**
   * Evaluates an XPath expression against the XML payload.
   *
   * @param xml - The raw XML string of the document
   * @param expression - The namespace-aware XPath expression to evaluate
   * @param options - Query result selection options
   * @returns Query results containing matches or a scalar value
   */
  query(xml: string, expression: string, options: QueryOptions): QueryResult {
    const doc = parse(xml);
    const select = xpath.useNamespaces(namespacesOf(doc)) as unknown as Selector;
    const result = select(expression, doc);

    // count()/string()/number()/boolean() XPath expressions evaluate to a scalar,
    // not a node-set — surface it as `scalarValue` instead of miscounting it as one node.
    if (typeof result === "number" || typeof result === "string" || typeof result === "boolean") {
      return { count: 0, matches: [], scalarValue: result };
    }

    const nodes: unknown[] = Array.isArray(result) ? result : result == null ? [] : [result];

    const count = nodes.length;
    const sliceLimit = options.limit <= 0 ? 0 : options.limit;
    const serializer = new XMLSerializer();
    const matches = nodes.slice(0, sliceLimit).map((node): FullQueryMatch => {
      const xmlNode = node as Partial<XmlAttr> & Partial<XmlElement> & { nodeName?: string };
      const match: FullQueryMatch = {
        kind: "match",
        tag: xmlNode.tagName ?? xmlNode.name ?? xmlNode.nodeName ?? "",
        ancestry: { path: "", elements: [], explicatus: [] },
      };
      if (options.format !== "text") match.xml = serializeNode(node, serializer);
      if (options.format !== "xml") match.text = collapseWhitespace(getNodeText(node));
      return match;
    });

    return { count, matches };
  }

  /**
   * Generates a structural element/attribute distribution profile of the document.
   *
   * @param xml - The raw XML string of the document.
   * @param top - The maximum number of frequent element tags to include in frequencies.
   * @returns The generated StructureProfile object.
   */
  profile(xml: string, top: number): StructureProfile {
    const doc = parse(xml);
    const root = doc.documentElement;
    if (!root) {
      return {
        root: "",
        schemaVariant: "unknown",
        documentType: "unknown",
        totalElements: 0,
        maxDepth: 0,
        tagFrequencies: {},
        attributes: [],
        namespaces: {},
      };
    }

    const tags: Record<string, number> = {};
    const attributes = new Set<string>();
    let totalElements = 0;
    let maxDepth = 0;

    const visit = (element: XmlElement, depth: number): void => {
      totalElements++;
      if (depth > maxDepth) maxDepth = depth;
      tags[element.tagName] = (tags[element.tagName] ?? 0) + 1;

      for (const attribute of attributesOf(element)) attributes.add(attribute.name);
      for (const child of childElements(element)) visit(child, depth + 1);
    };
    visit(root, 1);

    return {
      root: root.tagName,
      schemaVariant: detectSchemaVariant(root),
      documentType: detectDocumentType(root),
      totalElements,
      maxDepth,
      tagFrequencies: topTags(tags, top),
      attributes: [...attributes].sort(),
      namespaces: namespacesOf(doc),
    };
  }
}

/**
 * Parses a raw XML string into an XML Document.
 *
 * @param xml - The raw XML content string.
 * @returns The parsed XmlDocument.
 */
function parse(xml: string): XmlDocument {
  return new DOMParser().parseFromString(xml, "text/xml") as unknown as XmlDocument;
}

/**
 * Extracts child elements of a given element in document order.
 *
 * @param element - The parent XML element.
 * @returns An array of child elements.
 */
function childElements(element: XmlElement): XmlElement[] {
  const children: XmlElement[] = [];
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes.item(i);
    if (child && child.nodeType === ELEMENT_NODE) children.push(child as XmlElement);
  }
  return children;
}

/**
 * Extracts attributes of an element in declaration order.
 *
 * @param element - The XML element.
 * @returns An array of XmlAttr objects.
 */
function attributesOf(element: XmlElement): XmlAttr[] {
  const attributes: XmlAttr[] = [];
  for (let i = 0; i < element.attributes.length; i++) {
    const attribute = element.attributes.item(i);
    if (attribute) attributes.push(attribute);
  }
  return attributes;
}

/**
 * Collects namespace declarations from all elements in the DOM.
 * Defers to the root's default namespace on conflicts, prefixing it as "d:".
 *
 * @param document - The XML document.
 * @returns A mapping of namespace prefixes to URI values.
 */
function namespacesOf(document: XmlDocument): Record<string, string> {
  const namespaces: Record<string, string> = {};
  const root = document.documentElement;
  if (!root) return namespaces;

  const visit = (element: XmlElement): void => {
    for (const attribute of attributesOf(element)) {
      if (attribute.name === "xmlns") {
        // A flat prefix→URI map can't represent scoped namespaces; let the root's
        // default namespace win (first write) so a deeper re-declaration can't
        // clobber the prefix most XPath targets. Addressable as the "d:" prefix.
        namespaces.d ??= attribute.value;
      } else if (attribute.name.startsWith("xmlns:")) {
        namespaces[attribute.name.slice("xmlns:".length)] = attribute.value;
      }
    }
    for (const child of childElements(element)) visit(child);
  };

  visit(root);
  return namespaces;
}

/**
 * Serializes an XML node back to its string representation.
 *
 * @param node - The XML node (attribute, element, text, or cdata) or a scalar value.
 * @param serializer - The XMLSerializer instance.
 * @returns The serialized XML string.
 */
function serializeNode(node: unknown, serializer: XMLSerializer): string {
  const xmlNode = node as Partial<XmlAttr> & Partial<XmlNode>;
  if (xmlNode.nodeType === ATTRIBUTE_NODE) return `${xmlNode.name ?? ""}="${escapeAttribute(xmlNode.value ?? "")}"`;
  if (xmlNode.nodeType === TEXT_NODE || xmlNode.nodeType === CDATA_NODE) {
    return (xmlNode.data ?? xmlNode.nodeValue ?? "").trim();
  }
  if (xmlNode.nodeType === undefined) return String(node); // scalar result
  return serializer.serializeToString(node as never);
}

/**
 * Escapes special characters for safe inclusion in serialized attribute values.
 *
 * @param value - The raw attribute value.
 * @returns The escaped attribute value.
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/**
 * Detects the LexDania XML schema variant from the root element.
 *
 * @param root - The XML root element.
 * @returns The schema variant name or string identifier.
 */
function detectSchemaVariant(root: XmlElement): string {
  // Newer docs root at <lex:LexDaniaDokument>; the legacy format used <Dokument>.
  return root.tagName === "Dokument" ? "Dokument (legacy)" : root.tagName;
}

/**
 * Searches the XML tree to extract the Danish document type.
 *
 * @param root - The XML root element.
 * @returns The detected document type abbreviation, or 'unknown'.
 */
function detectDocumentType(root: XmlElement): string {
  const node = findFirstByLocalName(root, "DocumentType");
  const text = node ? textContent(node).trim() : "";
  if (text) return text;

  for (const attribute of attributesOf(root)) {
    if (localNameOf(attribute.name) === "DocumentType") return attribute.value;
  }
  return "unknown";
}

/**
 * Extracts the local name of a qualified XML tag or attribute name.
 *
 * @param qualifiedName - The qualified name (e.g. "prefix:name" or "name").
 * @returns The local name.
 */
function localNameOf(qualifiedName: string): string {
  const i = qualifiedName.indexOf(":");
  return i >= 0 ? qualifiedName.slice(i + 1) : qualifiedName;
}

/**
 * Performs a depth-first search to find the first element matching the local name.
 *
 * @param element - The XML element to start searching from.
 * @param localName - The target local name.
 * @returns The matched element, or null if not found.
 */
function findFirstByLocalName(element: XmlElement, localName: string): XmlElement | null {
  if (localNameOf(element.tagName) === localName) return element;
  for (const child of childElements(element)) {
    const found = findFirstByLocalName(child, localName);
    if (found) return found;
  }
  return null;
}

/**
 * Recursively extracts and concatenates the text content of an XML element.
 *
 * @param element - The XML element.
 * @returns The concatenated text content.
 */
function textContent(element: XmlElement): string {
  let accumulatedText = "";
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes.item(i);
    if (!child) continue;
    if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_NODE) {
      accumulatedText += child.data ?? child.nodeValue ?? "";
    } else if (child.nodeType === ELEMENT_NODE) {
      accumulatedText += textContent(child as XmlElement);
    }
  }
  return accumulatedText;
}

/**
 * Filters and limits tag frequencies to the top N entries by occurrences.
 *
 * @param tags - A record mapping tag names to frequency counts.
 * @param top - The maximum number of entries to return.
 * @returns The filtered and sorted tag frequencies record.
 */
function topTags(tags: Record<string, number>, top: number): Record<string, number> {
  const entries = Object.entries(tags).sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(top > 0 ? entries.slice(0, top) : entries);
}

/**
 * Extract plain text content of a node, handling element, attribute, text/cdata, and scalar.
 */
function getNodeText(node: unknown): string {
  const xmlNode = node as Partial<XmlAttr> & Partial<XmlNode>;
  if (xmlNode.nodeType === ATTRIBUTE_NODE) {
    return xmlNode.value ?? "";
  }
  if (xmlNode.nodeType === TEXT_NODE || xmlNode.nodeType === CDATA_NODE) {
    return xmlNode.data ?? xmlNode.nodeValue ?? "";
  }
  if (xmlNode.nodeType === ELEMENT_NODE) {
    return textContent(xmlNode as XmlElement);
  }
  if (xmlNode.nodeType === undefined) {
    return String(node); // scalar fallback
  }
  return "";
}

/**
 * Collapses all consecutive whitespace characters to a single space and trims.
 */
function collapseWhitespace(str: string): string {
  return str.trim().replace(/\s+/g, " ");
}
