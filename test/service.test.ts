import { describe, expect, it, vi } from "vitest";
import { LexDaniaXmlInspector } from "@/services/lexdania/xml";
import { Eli } from "@/services/retsinformation/eli";
import { ResolverUnavailableError } from "@/services/retsinformation/resolver";
import { askDocument, compareStructureDocument, metadataDocument } from "@/services/retsinformation/service";
import type { IndexProgressReporter, LawSource, LegislationCorpus } from "@/services/retsinformation/types";

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

function metadataWithTitle(title: string): unknown[] {
  return MOCK_JSON_LD.map((fragment, index) => (index === 1 ? { ...fragment, "http://data.europa.eu/eli/ontology#title": [{ "@value": title }] } : fragment));
}

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

describe("compareStructureDocument limits", () => {
  it("rejects more than 5 ELIs", async () => {
    const elis = Array.from({ length: 6 }, (_, i) => Eli.parse(`lta/2024/${i + 1}`));

    await expect(compareStructureDocument({ lawSource: {} as LawSource, xmlInspector: new LexDaniaXmlInspector() }, { elis })).rejects.toThrow(/at most 5/i);
  });

  it("profiles each document before fetching the next to bound memory", async () => {
    const events: string[] = [];
    const mockLawSource = {
      fetchXml: vi.fn().mockImplementation(async (eli: Eli) => {
        events.push(`fetch:${eli.id}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
        return XML_DOC1.replace("<Dokument>", `<Dokument source="${eli.id}">`);
      }),
    } as unknown as LawSource;

    const xmlInspector = new LexDaniaXmlInspector();
    const profile = xmlInspector.profile.bind(xmlInspector);
    vi.spyOn(xmlInspector, "profile").mockImplementation((xml, top) => {
      const eliId = /source="([^"]+)"/.exec(xml)?.[1];
      if (!eliId) throw new Error("Missing source ELI in XML fixture");
      events.push(`profile:${eliId}`);
      return profile(xml, top);
    });
    await compareStructureDocument({ lawSource: mockLawSource, xmlInspector }, { elis: [Eli.parse("lta/2024/1"), Eli.parse("lta/2024/2"), Eli.parse("lta/2024/3")] });

    expect(events).toEqual(["fetch:eli/lta/2024/1", "profile:eli/lta/2024/1", "fetch:eli/lta/2024/2", "profile:eli/lta/2024/2", "fetch:eli/lta/2024/3", "profile:eli/lta/2024/3"]);
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

    const result = await askDocument({ lawSource: mockLawSource, legislationCorpus: mockLegislationCorpus, waitUntil: vi.fn() }, { question: "What is the environment?", maxSources: 5 });

    expect(result.answer).toBe("The environment must be protected.");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.title).toBe("Bekendtgørelse af lov om miljøbeskyttelse");
  });

  it("fetches metadata once per distinct citation ELI and preserves citation order", async () => {
    const mockLawSource = {
      fetchJson: vi.fn().mockImplementation(async (eli: Eli) => {
        if (eli.id === "eli/lta/2024/48") return metadataWithTitle("Title 48");
        if (eli.id === "eli/lta/2023/5") return metadataWithTitle("Title 5");
        throw new Error(`Unexpected ELI: ${eli.id}`);
      }),
    } as unknown as LawSource;

    const citations = [
      { eli: "eli/lta/2024/48", title: "eli/lta/2024/48", sectionPath: "p.1", snippet: "a" },
      { eli: "eli/lta/2023/5", title: "eli/lta/2023/5", sectionPath: "p.3", snippet: "c" },
      { eli: "eli/lta/2024/48", title: "eli/lta/2024/48", sectionPath: "p.2", snippet: "b" },
    ];
    const mockLegislationCorpus = {
      answer: vi.fn().mockResolvedValue({
        answer: "ok",
        citations,
      }),
    } as unknown as LegislationCorpus;

    const result = await askDocument({ lawSource: mockLawSource, legislationCorpus: mockLegislationCorpus, waitUntil: vi.fn() }, { question: "What is the environment?", maxSources: 5 });

    expect(mockLawSource.fetchJson).toHaveBeenCalledTimes(2);
    expect(result.citations).toEqual([
      { ...citations[0], title: "Title 48" },
      { ...citations[1], title: "Title 5" },
      { ...citations[2], title: "Title 48" },
    ]);
  });

  it("preserves citation titles when metadata enrichment cannot provide one", async () => {
    const mockLawSource = {
      fetchJson: vi.fn().mockImplementation(async (eli: Eli) => {
        if (eli.id === "eli/lta/2024/1") throw new Error("fetch failed");
        if (eli.id === "eli/lta/2024/2") return {};
        if (eli.id === "eli/lta/2024/3") return metadataWithTitle("");
        throw new Error(`Unexpected ELI: ${eli.id}`);
      }),
    } as unknown as LawSource;

    const citations = [
      { eli: "not-an-eli", title: "Malformed ELI", sectionPath: "p.1" },
      { eli: "eli/lta/2024/1", title: "Fetch failure", sectionPath: "p.2" },
      { eli: "eli/lta/2024/2", title: "Invalid metadata", sectionPath: "p.3" },
      { eli: "eli/lta/2024/3", title: "Empty metadata title", sectionPath: "p.4" },
    ];
    const mockLegislationCorpus = {
      answer: vi.fn().mockResolvedValue({ answer: "ok", citations }),
    } as unknown as LegislationCorpus;

    const result = await askDocument({ lawSource: mockLawSource, legislationCorpus: mockLegislationCorpus, waitUntil: vi.fn() }, { question: "What is the environment?", maxSources: 5 });

    expect(mockLawSource.fetchJson).toHaveBeenCalledTimes(3);
    expect(result.citations).toEqual(citations);
  });

  it("registers a cold indexing with waitUntil and forwards indexing progress", async () => {
    const pdf = new Blob(["%PDF"]);
    const mockLawSource = {
      fetchPdf: vi.fn().mockResolvedValue(pdf),
      fetchJson: vi.fn().mockRejectedValue(new Error("no metadata")),
    } as unknown as LawSource;

    const mockLegislationCorpus = {
      find: vi.fn().mockResolvedValue(undefined),
      index: vi.fn().mockImplementation(async (_eli: Eli, _pdf: Blob, onProgress?: (progress: unknown) => void) => {
        onProgress?.({ elapsedMs: 5_000, totalMs: 120_000, message: "Indexing eli/lta/2024/48" });
        return "fileSearchStores/test/documents/doc-48";
      }),
      answer: vi.fn().mockResolvedValue({ answer: "ok", citations: [] }),
    } as unknown as LegislationCorpus;

    const waitUntil = vi.fn();
    const onIndexProgress = vi.fn();

    await askDocument(
      { lawSource: mockLawSource, legislationCorpus: mockLegislationCorpus, waitUntil },
      { question: "What is the environment?", scopedEli: Eli.parse("lta/2024/48"), maxSources: 5, onIndexProgress },
    );

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
    expect(mockLegislationCorpus.index).toHaveBeenCalledWith(expect.objectContaining({ id: "eli/lta/2024/48" }), pdf, expect.any(Function));
    expect(onIndexProgress).toHaveBeenCalledWith({ elapsedMs: 5_000, totalMs: 120_000, message: "Indexing eli/lta/2024/48" });
  });

  it("forwards shared indexing progress to every waiting caller", async () => {
    const pdf = new Blob(["%PDF"]);
    let reportProgress: IndexProgressReporter | undefined;
    let finishIndex = () => {};
    const indexPending = new Promise<void>((resolve) => {
      finishIndex = resolve;
    });
    const mockLawSource = {
      fetchPdf: vi.fn().mockResolvedValue(pdf),
      fetchJson: vi.fn().mockRejectedValue(new Error("no metadata")),
    } as unknown as LawSource;
    const mockLegislationCorpus = {
      find: vi.fn().mockResolvedValue(undefined),
      index: vi.fn().mockImplementation(async (_eli: Eli, _pdf: Blob, onProgress?: IndexProgressReporter) => {
        reportProgress = onProgress;
        await indexPending;
        return "fileSearchStores/test/documents/doc-49";
      }),
      answer: vi.fn().mockResolvedValue({ answer: "ok", citations: [] }),
    } as unknown as LegislationCorpus;
    const eli = Eli.parse("lta/2024/49");
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();
    const deps = { lawSource: mockLawSource, legislationCorpus: mockLegislationCorpus, waitUntil: vi.fn() };

    const firstAsk = askDocument(deps, { question: "First", scopedEli: eli, maxSources: 5, onIndexProgress: firstProgress });
    await vi.waitUntil(() => reportProgress !== undefined);
    const secondAsk = askDocument(deps, { question: "Second", scopedEli: eli, maxSources: 5, onIndexProgress: secondProgress });

    const progress = { elapsedMs: 5_000, totalMs: 120_000, message: "Indexing eli/lta/2024/49" };
    reportProgress?.(progress);
    finishIndex();
    await Promise.all([firstAsk, secondAsk]);

    expect(mockLegislationCorpus.index).toHaveBeenCalledTimes(1);
    expect(firstProgress).toHaveBeenCalledWith(progress);
    expect(secondProgress).toHaveBeenCalledWith(progress);
  });

  it("resolves scoped membership through the cached resolver without consulting the corpus", async () => {
    const mockLawSource = {
      fetchPdf: vi.fn(),
      fetchJson: vi.fn().mockRejectedValue(new Error("no metadata")),
    } as unknown as LawSource;
    const mockLegislationCorpus = {
      find: vi.fn(),
      index: vi.fn(),
      answer: vi.fn().mockResolvedValue({ answer: "ok", citations: [] }),
    } as unknown as LegislationCorpus;
    const resolveRemote = vi.fn().mockResolvedValue("fileSearchStores/test/documents/doc-50");
    const waitUntil = vi.fn();

    await askDocument(
      { lawSource: mockLawSource, legislationCorpus: mockLegislationCorpus, resolveRemote, waitUntil },
      { question: "What is the environment?", scopedEli: Eli.parse("lta/2024/50"), maxSources: 5 },
    );

    expect(resolveRemote).toHaveBeenCalledWith(expect.objectContaining({ id: "eli/lta/2024/50" }));
    expect(mockLegislationCorpus.find).not.toHaveBeenCalled();
    expect(mockLegislationCorpus.index).not.toHaveBeenCalled();
    expect(mockLawSource.fetchPdf).not.toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("falls back to in-process resolution when the cached resolver fails", async () => {
    const pdf = new Blob(["%PDF"]);
    const mockLawSource = {
      fetchPdf: vi.fn().mockResolvedValue(pdf),
      fetchJson: vi.fn().mockRejectedValue(new Error("no metadata")),
    } as unknown as LawSource;
    const mockLegislationCorpus = {
      find: vi.fn().mockResolvedValue(undefined),
      index: vi.fn().mockResolvedValue("fileSearchStores/test/documents/doc-51"),
      answer: vi.fn().mockResolvedValue({ answer: "ok", citations: [] }),
    } as unknown as LegislationCorpus;
    const resolveRemote = vi.fn().mockRejectedValue(new ResolverUnavailableError("resolver unreachable"));

    await askDocument(
      { lawSource: mockLawSource, legislationCorpus: mockLegislationCorpus, resolveRemote, waitUntil: vi.fn() },
      { question: "What is the environment?", scopedEli: Eli.parse("lta/2024/51"), maxSources: 5 },
    );

    expect(resolveRemote).toHaveBeenCalledTimes(1);
    expect(mockLegislationCorpus.find).toHaveBeenCalledWith(expect.objectContaining({ id: "eli/lta/2024/51" }));
    expect(mockLawSource.fetchPdf).toHaveBeenCalledTimes(1);
    expect(mockLegislationCorpus.index).toHaveBeenCalledTimes(1);
  });

  it("propagates a definitive remote resolution failure without re-running it in-process", async () => {
    const mockLawSource = { fetchPdf: vi.fn() } as unknown as LawSource;
    const mockLegislationCorpus = {
      find: vi.fn(),
      index: vi.fn(),
      answer: vi.fn(),
    } as unknown as LegislationCorpus;
    const resolveRemote = vi.fn().mockRejectedValue(new Error("document resolver failed for eli/lta/2024/54: indexing timed out"));

    await expect(
      askDocument(
        { lawSource: mockLawSource, legislationCorpus: mockLegislationCorpus, resolveRemote, waitUntil: vi.fn() },
        { question: "What is the environment?", scopedEli: Eli.parse("lta/2024/54"), maxSources: 5 },
      ),
    ).rejects.toThrow("indexing timed out");

    expect(mockLegislationCorpus.find).not.toHaveBeenCalled();
    expect(mockLawSource.fetchPdf).not.toHaveBeenCalled();
    expect(mockLegislationCorpus.index).not.toHaveBeenCalled();
  });

  it("emits heartbeat progress while the cached resolver is in flight and stops after it settles", async () => {
    vi.useFakeTimers();
    try {
      let finishResolution = (_documentName: string) => {};
      const resolveRemote = vi.fn().mockReturnValue(
        new Promise<string>((resolve) => {
          finishResolution = resolve;
        }),
      );
      const mockLegislationCorpus = {
        answer: vi.fn().mockResolvedValue({ answer: "ok", citations: [] }),
      } as unknown as LegislationCorpus;
      const onIndexProgress = vi.fn();

      const ask = askDocument(
        { lawSource: {} as LawSource, legislationCorpus: mockLegislationCorpus, resolveRemote, waitUntil: vi.fn() },
        { question: "What is the environment?", scopedEli: Eli.parse("lta/2024/52"), maxSources: 5, onIndexProgress },
      );

      await vi.advanceTimersByTimeAsync(11_000);
      expect(onIndexProgress).toHaveBeenCalledTimes(2);
      expect(onIndexProgress).toHaveBeenLastCalledWith({ elapsedMs: 10_000, totalMs: 150_000, message: "Ensuring eli/lta/2024/52 is indexed into File Search" });

      finishResolution("fileSearchStores/test/documents/doc-52");
      await ask;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(onIndexProgress).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps progress monotonic when cached resolution falls back after heartbeats", async () => {
    vi.useFakeTimers();
    try {
      const mockLawSource = {
        fetchPdf: vi.fn().mockResolvedValue(new Blob(["%PDF"])),
      } as unknown as LawSource;
      const mockLegislationCorpus = {
        find: vi.fn().mockResolvedValue(undefined),
        index: vi.fn().mockImplementation(async (_eli: Eli, _pdf: Blob, reportProgress?: IndexProgressReporter) => {
          reportProgress?.({ elapsedMs: 0, totalMs: 120_000, message: "Uploaded document" });
          reportProgress?.({ elapsedMs: 5_000, totalMs: 120_000, message: "Indexing document" });
          reportProgress?.({ elapsedMs: 15_000, totalMs: 120_000, message: "Indexed document" });
          return "fileSearchStores/test/documents/doc-55";
        }),
        answer: vi.fn().mockResolvedValue({ answer: "ok", citations: [] }),
      } as unknown as LegislationCorpus;
      const resolveRemote = vi.fn().mockImplementation(
        () =>
          new Promise<string>((_resolve, reject) => {
            setTimeout(() => reject(new ResolverUnavailableError("resolver unreachable")), 11_000);
          }),
      );
      const onIndexProgress = vi.fn();

      const ask = askDocument(
        { lawSource: mockLawSource, legislationCorpus: mockLegislationCorpus, resolveRemote, waitUntil: vi.fn() },
        { question: "What is the environment?", scopedEli: Eli.parse("lta/2024/55"), maxSources: 5, onIndexProgress },
      );

      await vi.advanceTimersByTimeAsync(11_000);
      await ask;

      expect(onIndexProgress.mock.calls.map(([progress]) => progress.elapsedMs)).toEqual([5_000, 10_000, 15_000]);
    } finally {
      vi.useRealTimers();
    }
  });
});
