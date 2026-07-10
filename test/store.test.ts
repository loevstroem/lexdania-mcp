import type { GoogleGenAI } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiLegislationCorpus } from "@/services/gemini/store";
import { Eli } from "@/services/retsinformation/eli";

describe("GeminiLegislationCorpus.ingest", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports progress while a slow ingest operation is polled", async () => {
    vi.useFakeTimers();

    const uploadToFileSearchStore = vi.fn().mockResolvedValue({ done: false });
    const get = vi.fn().mockResolvedValueOnce({ done: false }).mockResolvedValueOnce({ done: true });
    const mockAi = {
      fileSearchStores: { uploadToFileSearchStore },
      operations: { get },
    } as unknown as GoogleGenAI;

    const corpus = new GeminiLegislationCorpus(mockAi, {
      storeName: "test-store",
      model: "gemini-3.5-flash",
    });

    const onProgress = vi.fn();
    const ingestion = corpus.ingest(Eli.parse("lta/2024/48"), new Blob(["%PDF"]), onProgress);
    await vi.advanceTimersByTimeAsync(10_000);
    await ingestion;

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
      return { done: true };
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

    const ingestion = corpus.ingest(Eli.parse("lta/2024/49"), new Blob(["%PDF"]), onProgress);
    await vi.advanceTimersByTimeAsync(5_000);
    await ingestion;

    expect(onProgress).toHaveBeenLastCalledWith({
      elapsedMs: 120_000,
      totalMs: 120_000,
      message: "Ingested eli/lta/2024/49 into File Search",
    });
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
