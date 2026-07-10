# Query Response Controls Design

## Goal

Make `lexdania_query_document` responses compact, safely bounded per hit, and directly citable without follow-up queries.

## Public contract

The tool accepts two new parameters:

- `format?: "text" | "xml" | "both"`, defaulting to `"both"`.
- `maxNodeBytes?: number`, a positive integer defaulting to `32768`.

Node-set expressions return `{ count, matches }`. Scalar expressions return `{ count: 0, matches: [], value }`. The existing parallel `nodes` and `text` arrays are removed.

Each item in `matches` is a discriminated union:

```ts
type QueryMatch = FullQueryMatch | OversizeQueryMatch;

interface FullQueryMatch {
  kind: "match";
  tag: string;
  xml?: string;
  text?: string;
  ancestry: QueryAncestry;
}

interface OversizeQueryMatch {
  kind: "stub";
  tag: string;
  approxBytes: number;
  childTagCounts: Record<string, number>;
  hint: string;
  ancestry: QueryAncestry;
}
```

`format: "text"` includes `text` and omits `xml`; `format: "xml"` includes `xml` and omits `text`; `format: "both"` includes both. A stub contains neither representation.

## Size guard

The inspector serializes each selected node once and measures its UTF-8 byte length. A node exceeding `maxNodeBytes` becomes a stub in every format. This prevents a broad XPath from bypassing the guard through text-only output. Raising `maxNodeBytes` above the measured size restores the full result.

`approxBytes` reports the measured serialized byte length. `childTagCounts` counts direct element children by qualified tag name, which keeps the diagnostic compact while showing how to narrow the XPath. `hint` is:

> Matched node exceeds maxNodeBytes; narrow the XPath or raise maxNodeBytes.

For elements, `tag` is the qualified tag name. Attribute, text, and CDATA matches use `@<name>`, `#text`, and `#cdata-section` respectively.

## Ancestry metadata

Every full hit and stub includes:

```ts
interface QueryAncestry {
  path: string;
  elements: QueryAncestor[];
  explicatus: string[];
}

interface QueryAncestor {
  tag: string;
  ordinal: number;
  id?: string;
  localId?: string;
}
```

`elements` runs from the document root through the matched element, or through the owning element for attribute/text/CDATA hits. `ordinal` is one-based among same-qualified-tag element siblings. The rendered `path` omits the root's redundant `[1]` and includes ordinals on every descendant, for example `Dokument > Kapitel[4] > Paragraf[12] > Stk[5]`.

Attributes whose local names are exactly `id` or `localId` populate the corresponding optional fields. Namespace prefixes do not prevent identifier collection.

`explicatus` preserves document order while walking ancestor-or-self elements. For each element, it collects the unnormalized text content of direct `Explicatus` children; if the element itself is `Explicatus`, it collects that element's text. This supplies section and subsection labels without interpreting them or duplicating labels from deeper descendants.

## Internal flow

The MCP layer validates and defaults the new parameters, then passes a query options object through `queryDocument` to `LexDaniaXmlInspector.query`. The inspector evaluates XPath, applies `limit`, constructs each ordered match, and returns the domain result. The MCP layer only renames internal `scalarValue` to public `value`.

Serialization, byte measurement, ancestry extraction, and stub construction remain deterministic DOM operations. No legal interpretation or content inference is introduced.

## Validation

Tests cover:

- all three formats and the `"both"` default;
- omission of unrequested representations;
- default guarding, UTF-8 byte measurement, compact stub fields, and explicit override;
- ancestry paths, same-tag ordinals, `id`/`localId`, and verbatim `Explicatus` values;
- element, attribute, text, namespace-qualified, scalar, limit, and count-only queries;
- MCP input defaults, schema rejection, and public output shape;
- full tests, type checking, and linting.

