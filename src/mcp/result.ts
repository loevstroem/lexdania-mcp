import { DocumentTooLargeError } from "@/services/retsinformation/client";
import { InvalidEliError } from "@/services/retsinformation/eli";

/**
 * Executes a tool operation and formats its result as an MCP-compliant response.
 *
 * Translates expected and unexpected internal domain exceptions into clean,
 * user-friendly error messages.
 *
 * @param operation - The asynchronous callback representing the tool execution.
 * @returns A promise resolving to the MCP response content structure.
 */
export async function presentMcpResult(operation: () => Promise<unknown>): Promise<{
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  try {
    const resultData = await operation();
    const serializedResult = JSON.stringify(resultData, null, 2);
    const structuredContent = resultData !== null && typeof resultData === "object" && !Array.isArray(resultData) ? (resultData as Record<string, unknown>) : undefined;
    return { content: [{ type: "text", text: serializedResult }], structuredContent };
  } catch (error) {
    console.error(error);

    let friendlyMessage = "An unexpected error occurred while executing the tool. Please check your query or try again later.";

    if (error instanceof InvalidEliError || error instanceof DocumentTooLargeError) {
      // Both carry an actionable, client-facing message; surface it as-is.
      friendlyMessage = error.message;
    } else if (error instanceof Error) {
      const msg = error.message;
      if (msg.includes("returned 404") || msg.includes("not found")) {
        friendlyMessage = "Danish legislation not found on Retsinformation.dk. Please verify that the publication channel, year, and law number are correct.";
      } else if (msg.includes("Retsinformation returned") || msg.includes("fetch")) {
        friendlyMessage = `Failed to retrieve document from Retsinformation.dk: ${msg}`;
      } else if (msg.includes("GoogleGenAI") || msg.includes("fileSearch") || msg.includes("Gemini")) {
        friendlyMessage = `A temporary error occurred while processing the request with Google Gemini: ${msg}`;
      } else {
        friendlyMessage = `An unexpected error occurred while executing the tool: ${msg}`;
      }
    }

    return { content: [{ type: "text", text: friendlyMessage }], isError: true };
  }
}
