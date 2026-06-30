import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentMcpResult } from "@/mcp/result";
import { InvalidEliError } from "@/services/retsinformation/eli";

describe("presentMcpResult (error handling & formatting)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns content and structuredContent on success", async () => {
    const successAction = async () => ({ hello: "world" });
    const res = await presentMcpResult(successAction);

    expect(res.isError).toBeUndefined();
    expect(res.content).toEqual([{ type: "text", text: JSON.stringify({ hello: "world" }, null, 2) }]);
    expect(res.structuredContent).toEqual({ hello: "world" });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("logs full error to console.error and returns error message on InvalidEliError", async () => {
    const err = new InvalidEliError("bad-eli-string");
    const failAction = async () => {
      throw err;
    };

    const res = await presentMcpResult(failAction);

    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Invalid ELI:");
    expect(consoleErrorSpy).toHaveBeenCalledWith(err);
  });

  it("logs full error and returns friendly message on Retsinformation 404", async () => {
    const err = new Error("Retsinformation returned 404 Not Found for url");
    const failAction = async () => {
      throw err;
    };

    const res = await presentMcpResult(failAction);

    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toBe("Danish legislation not found on Retsinformation.dk. Please verify that the publication channel, year, and law number are correct.");
    expect(consoleErrorSpy).toHaveBeenCalledWith(err);
  });

  it("logs full error and returns friendly message on Retsinformation fetch failure", async () => {
    const err = new Error("Retsinformation returned 500 Internal Server Error");
    const failAction = async () => {
      throw err;
    };

    const res = await presentMcpResult(failAction);

    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toBe("Failed to retrieve document from Retsinformation.dk: Retsinformation returned 500 Internal Server Error");
    expect(consoleErrorSpy).toHaveBeenCalledWith(err);
  });

  it("logs full error and returns friendly message on Google Gemini failure", async () => {
    const err = new Error("GoogleGenAI error: rate limit exceeded");
    const failAction = async () => {
      throw err;
    };

    const res = await presentMcpResult(failAction);

    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toBe("A temporary error occurred while processing the request with Google Gemini: GoogleGenAI error: rate limit exceeded");
    expect(consoleErrorSpy).toHaveBeenCalledWith(err);
  });

  it("logs full error and returns generic message on general errors", async () => {
    const err = new Error("Some unknown database exception");
    const failAction = async () => {
      throw err;
    };

    const res = await presentMcpResult(failAction);

    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toBe("An unexpected error occurred while executing the tool: Some unknown database exception");
    expect(consoleErrorSpy).toHaveBeenCalledWith(err);
  });
});
