import { describe, expect, it } from "vitest";
import { LexDaniaXmlInspector } from "@/services/lexdania/xml";

const LEGACY = `<?xml version="1.0" encoding="UTF-8"?>
<Dokument>
  <Meta><DocumentType>BEKH</DocumentType></Meta>
  <Body>
    <Paragraf nr="1"><Stk>A</Stk></Paragraf>
    <Paragraf nr="2"><Stk>B</Stk><Stk>C</Stk></Paragraf>
    <Bilag/>
  </Body>
</Dokument>`;

const LEX = `<?xml version="1.0" encoding="UTF-8"?>
<lex:LexDaniaDokument xmlns:lex="http://www.retsinformation.dk/eli/lex">
  <lex:Paragraf>1</lex:Paragraf>
  <lex:Paragraf>2</lex:Paragraf>
</lex:LexDaniaDokument>`;

const ANCESTRY = `<?xml version="1.0" encoding="UTF-8"?>
<lex:Dokument xmlns:lex="urn:lex" xmlns:meta="urn:metadata" meta:ID="ignored-root-id">
  <lex:Kapitel xml:id="chapter-1">
    <lex:Explicatus>Kapitel I</lex:Explicatus>
    <lex:Paragraf><lex:Stk/></lex:Paragraf>
  </lex:Kapitel>
  <lex:Kapitel xml:id="chapter-2" meta:localId="chapter-local-2">
    <lex:Explicatus>Kapitel   II</lex:Explicatus>
    <lex:Paragraf meta:localID="ignored-paragraph-local-id"><lex:Stk/></lex:Paragraf>
    <lex:Paragraf xml:id="paragraph-2" meta:localID="ignored-paragraph-local-id">
      <lex:Explicatus>§  2.</lex:Explicatus>
      <lex:Stk/>
      <lex:Stk xml:id="subsection-2" meta:localId="subsection-local-2">
        <lex:Explicatus>Stk.   <lex:Number>2</lex:Number>.</lex:Explicatus>
        <lex:Linea>First line</lex:Linea>
        <lex:Linea target="yes">Owner <lex:Emphasis>text</lex:Emphasis> tail</lex:Linea>
      </lex:Stk>
    </lex:Paragraf>
  </lex:Kapitel>
</lex:Dokument>`;

const TARGET_STK_ANCESTRY = {
  path: "lex:Dokument > lex:Kapitel[2] > lex:Paragraf[2] > lex:Stk[2]",
  elements: [
    { tag: "lex:Dokument", ordinal: 1 },
    { tag: "lex:Kapitel", ordinal: 2, id: "chapter-2", localId: "chapter-local-2" },
    { tag: "lex:Paragraf", ordinal: 2, id: "paragraph-2" },
    { tag: "lex:Stk", ordinal: 2, id: "subsection-2", localId: "subsection-local-2" },
  ],
  explicatus: ["Kapitel   II", "§  2.", "Stk.   2."],
};

const TARGET_LINEA_ANCESTRY = {
  ...TARGET_STK_ANCESTRY,
  path: `${TARGET_STK_ANCESTRY.path} > lex:Linea[2]`,
  elements: [...TARGET_STK_ANCESTRY.elements, { tag: "lex:Linea", ordinal: 2 }],
};

describe("LexDaniaXmlInspector.query", () => {
  const inspector = new LexDaniaXmlInspector();

  it("counts and returns matching nodes", () => {
    const result = inspector.query(LEGACY, "//Paragraf", {
      limit: 20,
      format: "both",
      maxNodeBytes: 32768,
    });
    expect(result.count).toBe(2);
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({ kind: "match", tag: "Paragraf", text: "A" });
    expect(result.matches[0]).toHaveProperty("xml", expect.stringContaining("<Paragraf"));
    expect(result.matches[1]).toMatchObject({ kind: "match", tag: "Paragraf", text: "BC" });
  });

  it("treats limit 0 as count-only", () => {
    const result = inspector.query(LEGACY, "//Stk", {
      limit: 0,
      format: "both",
      maxNodeBytes: 32768,
    });
    expect(result).toEqual({ count: 3, matches: [] });
  });

  it("truncates to the limit", () => {
    const result = inspector.query(LEGACY, "//Stk", {
      limit: 1,
      format: "both",
      maxNodeBytes: 32768,
    });
    expect(result.count).toBe(3);
    expect(result.matches).toHaveLength(1);
  });

  it("resolves declared namespace prefixes", () => {
    const result = inspector.query(LEX, "//lex:Paragraf", {
      limit: 20,
      format: "both",
      maxNodeBytes: 32768,
    });
    expect(result.count).toBe(2);
  });

  it("resolves namespace prefixes declared on nested elements", () => {
    const nestedXml = `<?xml version="1.0" encoding="UTF-8"?>
    <root>
      <child xmlns:foo="http://example.com/foo">
        <foo:item>Test</foo:item>
      </child>
    </root>`;
    const result = inspector.query(nestedXml, "//foo:item", {
      limit: 20,
      format: "both",
      maxNodeBytes: 32768,
    });
    expect(result.count).toBe(1);
    expect(result.matches[0]).toHaveProperty("xml", '<foo:item xmlns:foo="http://example.com/foo">Test</foo:item>');
  });

  it("surfaces a scalar value for value expressions instead of miscounting", () => {
    const result = inspector.query(LEGACY, "count(//Paragraf)", {
      limit: 20,
      format: "both",
      maxNodeBytes: 32768,
    });
    expect(result).toEqual({ count: 0, matches: [], scalarValue: 2 });
  });

  it("escapes special characters in serialized attribute values", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><r><e a='x &amp; &quot;y&quot; &lt;z'/></r>`;
    const result = inspector.query(xml, "//@a", {
      limit: 20,
      format: "both",
      maxNodeBytes: 32768,
    });
    expect(result.matches[0]).toHaveProperty("xml", 'a="x &amp; &quot;y&quot; &lt;z"');
  });

  it("returns only text for text format", () => {
    const result = inspector.query(LEGACY, "//Stk", {
      limit: 20,
      format: "text",
      maxNodeBytes: 32768,
    });

    expect(result.matches[0]).toMatchObject({ kind: "match", tag: "Stk", text: "A" });
    expect(result.matches[0]).not.toHaveProperty("xml");
  });

  it("returns only XML for xml format", () => {
    const result = inspector.query(LEGACY, "//Stk", {
      limit: 20,
      format: "xml",
      maxNodeBytes: 32768,
    });

    expect(result.matches[0]).toHaveProperty("xml", "<Stk>A</Stk>");
    expect(result.matches[0]).not.toHaveProperty("text");
  });

  it("returns text and XML for both format", () => {
    const result = inspector.query(LEGACY, "//Stk", {
      limit: 20,
      format: "both",
      maxNodeBytes: 32768,
    });

    expect(result.matches[0]).toMatchObject({ kind: "match", tag: "Stk", text: "A", xml: "<Stk>A</Stk>" });
  });

  it("builds ancestry with qualified same-tag ordinals and exact local-name identifiers for element hits", () => {
    const result = inspector.query(ANCESTRY, "//lex:Stk[lex:Linea/@target='yes']", {
      limit: 1,
      format: "both",
      maxNodeBytes: 32768,
    });

    expect(result.matches[0]).toMatchObject({ kind: "match", ancestry: TARGET_STK_ANCESTRY });
  });

  it("uses the owner element ancestry for attribute and text-node hits", () => {
    const options = { limit: 1, format: "both" as const, maxNodeBytes: 32768 };
    const attribute = inspector.query(ANCESTRY, "//lex:Linea[@target='yes']/@target", options);
    const text = inspector.query(ANCESTRY, "//lex:Linea[@target='yes']/text()[1]", options);

    expect(attribute.matches[0]).toMatchObject({ kind: "match", tag: "@target", ancestry: TARGET_LINEA_ANCESTRY });
    expect(text.matches[0]).toMatchObject({ kind: "match", tag: "#text", ancestry: TARGET_LINEA_ANCESTRY });
  });

  it("preserves direct and self Explicatus text without descendant-label duplication", () => {
    const result = inspector.query(ANCESTRY, "//lex:Stk[lex:Linea/@target='yes']/lex:Explicatus", {
      limit: 1,
      format: "text",
      maxNodeBytes: 32768,
    });

    expect(result.matches[0]).toMatchObject({
      kind: "match",
      ancestry: {
        path: `${TARGET_STK_ANCESTRY.path} > lex:Explicatus[1]`,
        elements: [...TARGET_STK_ANCESTRY.elements, { tag: "lex:Explicatus", ordinal: 1 }],
        explicatus: ["Kapitel   II", "§  2.", "Stk.   2."],
      },
    });
  });

  it("attaches identical ancestry to full hits and size stubs", () => {
    const full = inspector.query(ANCESTRY, "//lex:Linea[@target='yes']", {
      limit: 1,
      format: "both",
      maxNodeBytes: 32768,
    });
    const stub = inspector.query(ANCESTRY, "//lex:Linea[@target='yes']", {
      limit: 1,
      format: "both",
      maxNodeBytes: 1,
    });

    expect(full.matches[0]?.kind).toBe("match");
    expect(stub.matches[0]?.kind).toBe("stub");
    expect(full.matches[0]?.ancestry).toEqual(TARGET_LINEA_ANCESTRY);
    expect(stub.matches[0]?.ancestry).toEqual(TARGET_LINEA_ANCESTRY);
  });

  it("returns an ordered UTF-8 size stub before text extraction", () => {
    const serializedXml = "<Section>æøå<Child/><Child/><Other><Child/></Other></Section>";
    const xml = `<Root>${serializedXml}<Tail>ok</Tail><Later>ignored</Later></Root>`;
    const approxBytes = new TextEncoder().encode(serializedXml).byteLength;

    const result = inspector.query(xml, "/*/*", {
      limit: 2,
      format: "text",
      maxNodeBytes: approxBytes - 1,
    });

    expect(result.count).toBe(3);
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toEqual({
      kind: "stub",
      tag: "Section",
      approxBytes,
      childTagCounts: { Child: 2, Other: 1 },
      hint: "Matched node exceeds maxNodeBytes; narrow the XPath or raise maxNodeBytes.",
      ancestry: {
        path: "Root > Section[1]",
        elements: [
          { tag: "Root", ordinal: 1 },
          { tag: "Section", ordinal: 1 },
        ],
        explicatus: [],
      },
    });
    expect(result.matches[0]).not.toHaveProperty("xml");
    expect(result.matches[0]).not.toHaveProperty("text");
    expect(result.matches[1]).toMatchObject({ kind: "match", tag: "Tail", text: "ok" });
  });

  it("returns a full hit when size equals the override", () => {
    const serializedXml = "<Section>æøå<Child/><Child/><Other><Child/></Other></Section>";
    const approxBytes = new TextEncoder().encode(serializedXml).byteLength;

    const result = inspector.query(`<Root>${serializedXml}</Root>`, "//Section", {
      limit: 1,
      format: "text",
      maxNodeBytes: approxBytes,
    });

    expect(result.matches[0]).toMatchObject({ kind: "match", tag: "Section", text: "æøå" });
  });

  it("keeps a synthetic large-root stub below 2 KB", () => {
    const xml = `<Root>${"<Section><Nested/></Section>".repeat(5_000)}</Root>`;

    const result = inspector.query(xml, "/*", {
      limit: 1,
      format: "both",
      maxNodeBytes: 1_024,
    });

    expect(result.matches[0]).toMatchObject({
      kind: "stub",
      tag: "Root",
      childTagCounts: { Section: 5_000 },
    });
    expect(new TextEncoder().encode(JSON.stringify(result.matches[0])).byteLength).toBeLessThan(2_048);
  });

  it("returns empty child tag counts for a non-element stub", () => {
    const result = inspector.query('<Root note="æøå"/>', "//@note", {
      limit: 1,
      format: "both",
      maxNodeBytes: 1,
    });

    expect(result.matches[0]).toMatchObject({ kind: "stub", childTagCounts: {} });
  });

  it("counts prototype-named direct children in a stub", () => {
    const xml = "<Root><constructor/><constructor/><toString/><__proto__/><__proto__/><__proto__/></Root>";
    const result = inspector.query(xml, "/*", {
      limit: 1,
      format: "both",
      maxNodeBytes: 1,
    });
    const match = result.matches[0];

    expect(match?.kind).toBe("stub");
    if (match?.kind !== "stub") throw new Error("Expected an oversize stub");
    expect(Object.entries(match.childTagCounts)).toEqual([
      ["constructor", 2],
      ["toString", 1],
      ["__proto__", 3],
    ]);
  });
});

describe("LexDaniaXmlInspector.profile", () => {
  const inspector = new LexDaniaXmlInspector();

  it("profiles the legacy <Dokument> variant", () => {
    const profile = inspector.profile(LEGACY, 30);
    expect(profile.root).toBe("Dokument");
    expect(profile.documentType).toBe("BEKH");
    expect(profile.tagFrequencies.Paragraf).toBe(2);
    expect(profile.tagFrequencies.Stk).toBe(3);
    expect(profile.maxDepth).toBeGreaterThanOrEqual(3);
    expect(profile.attributes).toContain("nr");
  });

  it("detects the lex schema variant", () => {
    const profile = inspector.profile(LEX, 30);
    expect(profile.root).toBe("lex:LexDaniaDokument");
    expect(profile.schemaVariant.toLowerCase()).toContain("lex");
    expect(profile.namespaces).toBeDefined();
    expect(profile.namespaces.lex).toBe("http://www.retsinformation.dk/eli/lex");
  });
});
