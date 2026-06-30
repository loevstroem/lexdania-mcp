import type { GoogleGenAI } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { GeminiLegislationCorpus } from "@/services/gemini/store";
import { Eli } from "@/services/retsinformation/eli";

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
