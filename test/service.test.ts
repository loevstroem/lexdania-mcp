import { describe, expect, it, vi } from "vitest";
import { LexDaniaXmlInspector } from "@/services/lexdania/xml";
import { Eli } from "@/services/retsinformation/eli";
import { askDocument, compareStructureDocument, metadataDocument } from "@/services/retsinformation/service";
import type { LawSource, LegislationCorpus } from "@/services/retsinformation/types";

// Mock JSON-LD response matching a simplified version of eli-48.json
const MOCK_JSON_LD = [
  {
    "@id": "https://retsinformation.dk/eli/lta/2024/48",
    "@type": ["http://data.europa.eu/eli/ontology#LegalResource"],
    "http://data.europa.eu/eli/ontology#type_document": [{ "@id": "http://www.retsinformation.dk/eli/resource/authority/type_document#LBKH" }],
    "http://data.europa.eu/eli/ontology#date_document": [{ "@value": "12-01-2024 00:00:00" }],
    "http://data.europa.eu/eli/ontology#date_publication": [{ "@value": "16-01-2024 00:00:00" }],
    "http://data.europa.eu/eli/ontology#responsibility_of": [{ "@value": "Miljøministeriet" }],
    "http://data.europa.eu/eli/ontology#in_force": [{ "@id": "http://data.europa.eu/eli/ontology#InForce-inForce" }],
    "http://data.europa.eu/eli/ontology#consolidates": [{ "@value": "https://retsinformation.dk/eli/lta/2023/5" }],
    "http://data.europa.eu/eli/ontology#based_on": [{ "@value": "https://retsinformation.dk/eli/lta/2020/123" }],
  },
  {
    "@id": "https://retsinformation.dk/eli/lta/2024/48/dan",
    "@type": ["http://data.europa.eu/eli/ontology#LegalExpression"],
    "http://data.europa.eu/eli/ontology#title": [{ "@value": "Bekendtgørelse af lov om miljøbeskyttelse" }],
  },
];

const XML_DOC1 = `<?xml version="1.0" encoding="UTF-8"?>
<Dokument>
  <Meta><DocumentType>BEKH</DocumentType></Meta>
  <Body>
    <Paragraf nr="1"><Stk>A</Stk></Paragraf>
    <UniqueTag>Diff</UniqueTag>
  </Body>
</Dokument>`;

const XML_DOC2 = `<?xml version="1.0" encoding="UTF-8"?>
<Dokument>
  <Meta><DocumentType>BEKH</DocumentType></Meta>
  <Body>
    <Paragraf nr="2"><Stk>B</Stk></Paragraf>
    <AnotherUniqueTag>Diff2</AnotherUniqueTag>
  </Body>
</Dokument>`;

describe("metadataDocument", () => {
  it("fetches and parses JSON-LD metadata correctly", async () => {
    const mockLawSource = {
      fetchJson: vi.fn().mockResolvedValue(MOCK_JSON_LD),
    } as unknown as LawSource;

    const request = { eli: Eli.parse("lta/2024/48") };
    const result = await metadataDocument({ lawSource: mockLawSource }, request);

    expect(result.eli).toBe("eli/lta/2024/48");
    expect(result.title).toBe("Bekendtgørelse af lov om miljøbeskyttelse");
    expect(result.documentType).toBe("LBKH");
    expect(result.dateDocument).toBe("2024-01-12");
    expect(result.datePublication).toBe("2024-01-16");
    expect(result.ministry).toBe("Miljøministeriet");
    expect(result.inForce).toBe(true);
    expect(result.relationships.consolidates).toEqual(["eli/lta/2023/5"]);
    expect(result.relationships.basedOn).toEqual(["eli/lta/2020/123"]);
    expect(result.relationships.changes).toEqual([]);
    expect(result.relationships.commences).toEqual([]);
  });
});

describe("compareStructureDocument", () => {
  it("diffs elements and attributes across multiple documents correctly", async () => {
    const mockLawSource = {
      fetchXml: vi.fn().mockImplementation(async (eli: Eli) => {
        if (eli.id === "eli/lta/2024/1") return XML_DOC1;
        if (eli.id === "eli/lta/2024/2") return XML_DOC2;
        throw new Error("not found");
      }),
    } as unknown as LawSource;

    const xmlInspector = new LexDaniaXmlInspector();
    const result = await compareStructureDocument({ lawSource: mockLawSource, xmlInspector }, { elis: [Eli.parse("lta/2024/1"), Eli.parse("lta/2024/2")] });

    // Assert onlyIn unique tags
    expect(result.onlyIn["eli/lta/2024/1"]).toContain("UniqueTag");
    expect(result.onlyIn["eli/lta/2024/1"]).not.toContain("AnotherUniqueTag");
    expect(result.onlyIn["eli/lta/2024/2"]).toContain("AnotherUniqueTag");
    expect(result.onlyIn["eli/lta/2024/2"]).not.toContain("UniqueTag");

    // Assert elements union presence
    const paragrafPres = result.elements.find((e) => e.tag === "Paragraf");
    expect(paragrafPres?.presentIn).toContain("eli/lta/2024/1");
    expect(paragrafPres?.presentIn).toContain("eli/lta/2024/2");

    const uniquePres = result.elements.find((e) => e.tag === "UniqueTag");
    expect(uniquePres?.presentIn).toContain("eli/lta/2024/1");
    expect(uniquePres?.presentIn).not.toContain("eli/lta/2024/2");
  });
});

describe("askDocument", () => {
  it("enriches citation titles from metadata Document", async () => {
    const mockLawSource = {
      fetchJson: vi.fn().mockResolvedValue(MOCK_JSON_LD),
    } as unknown as LawSource;

    const mockLegislationCorpus = {
      answer: vi.fn().mockResolvedValue({
        answer: "The environment must be protected.",
        citations: [
          {
            eli: "eli/lta/2024/48",
            title: "eli/lta/2024/48",
            sectionPath: "p.2",
            snippet: "The environment is important",
          },
        ],
      }),
    } as unknown as LegislationCorpus;

    const result = await askDocument({ lawSource: mockLawSource, legislationCorpus: mockLegislationCorpus }, { question: "What is the environment?", maxSources: 5 });

    expect(result.answer).toBe("The environment must be protected.");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.title).toBe("Bekendtgørelse af lov om miljøbeskyttelse");
  });
});
