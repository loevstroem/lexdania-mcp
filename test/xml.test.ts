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
      ancestry: { path: "", elements: [], explicatus: [] },
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
