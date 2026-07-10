import type { GoogleGenAI } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiLegislationCorpus } from "@/services/gemini/store";
import { Eli } from "@/services/retsinformation/eli";

describe("GeminiLegislationCorpus.index", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports progress while a slow index operation is polled", async () => {
    vi.useFakeTimers();

    const uploadToFileSearchStore = vi.fn().mockResolvedValue({ done: false });
    const get = vi
      .fn()
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValueOnce({ done: true, response: { documentName: "fileSearchStores/test/documents/doc-48" } });
    const mockAi = {
      fileSearchStores: { uploadToFileSearchStore },
      operations: { get },
    } as unknown as GoogleGenAI;

    const corpus = new GeminiLegislationCorpus(mockAi, {
      storeName: "test-store",
      model: "gemini-3.5-flash",
    });

    const onProgress = vi.fn();
    const indexing = corpus.index(Eli.parse("lta/2024/48"), new Blob(["%PDF"]), onProgress);
    await vi.advanceTimersByTimeAsync(10_000);
    await indexing;

    expect(get).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(2);

    const reports = onProgress.mock.calls.map(([report]) => report);
    for (const report of reports) {
      expect(report.totalMs).toBe(120_000);
      expect(report.message).toContain("eli/lta/2024/48");
    }
    const elapsed = reports.map((report) => report.elapsedMs);
    expect(elapsed).toEqual([...elapsed].sort((a, b) => a - b));
    expect(elapsed.at(-1)).toBeGreaterThan(0);
  });

  it("reports accurate completion progress after a late successful poll", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const uploadToFileSearchStore = vi.fn().mockResolvedValue({ done: false });
    const get = vi.fn().mockImplementation(async () => {
      vi.setSystemTime(121_000);
      return { done: true, response: { documentName: "fileSearchStores/test/documents/doc-49" } };
    });
    const mockAi = {
      fileSearchStores: { uploadToFileSearchStore },
      operations: { get },
    } as unknown as GoogleGenAI;
    const corpus = new GeminiLegislationCorpus(mockAi, {
      storeName: "test-store",
      model: "gemini-3.5-flash",
    });
    const onProgress = vi.fn();

    const indexing = corpus.index(Eli.parse("lta/2024/49"), new Blob(["%PDF"]), onProgress);
    await vi.advanceTimersByTimeAsync(5_000);
    await indexing;

    expect(onProgress).toHaveBeenLastCalledWith({
      elapsedMs: 120_000,
      totalMs: 120_000,
      message: "Indexed eli/lta/2024/49 into File Search",
    });
  });

  it("rejects a terminal failed operation", async () => {
    const mockAi = {
      fileSearchStores: {
        uploadToFileSearchStore: vi.fn().mockResolvedValue({ done: true, error: { message: "indexing failed" } }),
      },
    } as unknown as GoogleGenAI;
    const corpus = new GeminiLegislationCorpus(mockAi, { storeName: "test-store", model: "gemini-3.5-flash" });

    await expect(corpus.index(Eli.parse("lta/2024/50"), new Blob(["%PDF"]))).rejects.toThrow("indexing failed");
  });

  it("rejects a completed operation without a document name", async () => {
    const mockAi = {
      fileSearchStores: {
        uploadToFileSearchStore: vi.fn().mockResolvedValue({ done: true, response: {} }),
      },
    } as unknown as GoogleGenAI;
    const corpus = new GeminiLegislationCorpus(mockAi, { storeName: "test-store", model: "gemini-3.5-flash" });

    await expect(corpus.index(Eli.parse("lta/2024/51"), new Blob(["%PDF"]))).rejects.toThrow(/document name/i);
  });
});

describe("GeminiLegislationCorpus.answer", () => {
  it("formats metadata_filter with spaces when scopedEli is provided", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      steps: [
        {
          type: "model_output",
          content: [{ type: "text", text: "Some answer", annotations: [] }],
        },
      ],
    });

    const mockAi = {
      interactions: {
        create: mockCreate,
      },
    } as unknown as GoogleGenAI;

    const corpus = new GeminiLegislationCorpus(mockAi, {
      storeName: "test-store",
      model: "gemini-3.5-flash",
    });

    const scopedEli = Eli.parse("lta/2024/48");
    const result = await corpus.answer("What is the penalty?", scopedEli, 5);

    expect(result.answer).toBe("Some answer");
    expect(mockCreate).toHaveBeenCalledWith({
      model: "gemini-3.5-flash",
      input: "What is the penalty?",
      tools: [
        {
          type: "file_search",
          file_search_store_names: ["test-store"],
          metadata_filter: 'eli = "eli/lta/2024/48"',
        },
      ],
    });
  });
});

describe("GeminiLegislationCorpus.find", () => {
  it("resolves the document name by listing the configured store", async () => {
    const list = vi.fn().mockResolvedValue(
      (async function* () {
        yield { name: "fileSearchStores/test/documents/other", displayName: "eli/lta/2019/1" };
        yield { name: "fileSearchStores/test/documents/target", customMetadata: [{ key: "eli", stringValue: "eli/lta/2019/2" }] };
      })(),
    );
    const mockAi = { fileSearchStores: { documents: { list } } } as unknown as GoogleGenAI;
    const corpus = new GeminiLegislationCorpus(mockAi, { storeName: "test-store", model: "gemini-3.5-flash" });

    await expect(corpus.find(Eli.parse("lta/2019/2"))).resolves.toBe("fileSearchStores/test/documents/target");
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("does not reuse membership from another store", async () => {
    const eli = Eli.parse("lta/2019/20");
    const listA = vi.fn().mockResolvedValue(
      (async function* () {
        yield { name: "fileSearchStores/a/documents/target", displayName: eli.id };
      })(),
    );
    const listB = vi.fn().mockResolvedValue((async function* () {})());
    const corpusA = new GeminiLegislationCorpus({ fileSearchStores: { documents: { list: listA } } } as unknown as GoogleGenAI, {
      storeName: "store-a",
      model: "gemini-3.5-flash",
    });
    const corpusB = new GeminiLegislationCorpus({ fileSearchStores: { documents: { list: listB } } } as unknown as GoogleGenAI, {
      storeName: "store-b",
      model: "gemini-3.5-flash",
    });

    await expect(corpusA.find(eli)).resolves.toBe("fileSearchStores/a/documents/target");
    await expect(corpusB.find(eli)).resolves.toBeUndefined();
    expect(listB).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when the store does not contain the law", async () => {
    const list = vi.fn().mockResolvedValue((async function* () {})());
    const mockAi = { fileSearchStores: { documents: { list } } } as unknown as GoogleGenAI;
    const corpus = new GeminiLegislationCorpus(mockAi, { storeName: "test-store", model: "gemini-3.5-flash" });

    await expect(corpus.find(Eli.parse("lta/2019/3"))).resolves.toBeUndefined();
    expect(list).toHaveBeenCalledTimes(1);
  });
});
