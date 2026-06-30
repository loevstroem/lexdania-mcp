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

  it("counts and serializes matching nodes", () => {
    const result = inspector.query(LEGACY, "//Paragraf", 20);
    expect(result.count).toBe(2);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toContain("<Paragraf");
    expect(result.text).toHaveLength(2);
    expect(result.text[0]).toBe("A");
    expect(result.text[1]).toBe("BC");
  });

  it("treats limit 0 as count-only", () => {
    const result = inspector.query(LEGACY, "//Stk", 0);
    expect(result.count).toBe(3);
    expect(result.nodes).toEqual([]);
  });

  it("truncates to the limit", () => {
    const result = inspector.query(LEGACY, "//Stk", 1);
    expect(result.count).toBe(3);
    expect(result.nodes).toHaveLength(1);
  });

  it("resolves declared namespace prefixes", () => {
    const result = inspector.query(LEX, "//lex:Paragraf", 20);
    expect(result.count).toBe(2);
  });

  it("resolves namespace prefixes declared on nested elements", () => {
    const nestedXml = `<?xml version="1.0" encoding="UTF-8"?>
    <root>
      <child xmlns:foo="http://example.com/foo">
        <foo:item>Test</foo:item>
      </child>
    </root>`;
    const result = inspector.query(nestedXml, "//foo:item", 20);
    expect(result.count).toBe(1);
    expect(result.nodes[0]).toBe('<foo:item xmlns:foo="http://example.com/foo">Test</foo:item>');
  });

  it("surfaces a scalar value for value expressions instead of miscounting", () => {
    const result = inspector.query(LEGACY, "count(//Paragraf)", 20);
    expect(result.scalarValue).toBe(2);
    expect(result.count).toBe(0);
    expect(result.nodes).toEqual([]);
  });

  it("escapes special characters in serialized attribute values", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><r><e a='x &amp; &quot;y&quot; &lt;z'/></r>`;
    const result = inspector.query(xml, "//@a", 20);
    expect(result.nodes[0]).toBe('a="x &amp; &quot;y&quot; &lt;z"');
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
