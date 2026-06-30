import { describe, expect, it } from "vitest";
import { Eli, InvalidEliError } from "@/services/retsinformation/eli";

describe("Eli.parse", () => {
  it.each([
    "https://www.retsinformation.dk/eli/lta/2024/48",
    "https://retsinformation.dk/eli/lta/2024/48",
    "www.retsinformation.dk/eli/lta/2024/48",
    "retsinformation.dk/eli/lta/2024/48",
    "eli/lta/2024/48",
    "lta/2024/48",
    "https://www.retsinformation.dk/eli/lta/2024/48/xml",
    "https://www.retsinformation.dk/eli/lta/2024/48/pdf",
    "https://www.retsinformation.dk/eli/lta/2024/48.json",
    "https://www.retsinformation.dk/eli/lta/2024/48/dan",
    "  LTA/2024/48  ",
    "https://www.retsinformation.dk/eli/lta/2024/48?id=123",
    "https://www.retsinformation.dk/eli/lta/2024/48#section-2",
    "lta/2024/48?foo=bar#baz",
    "lta/2024/048",
  ])("normalizes %s to one identity", (input) => {
    expect(Eli.parse(input).id).toBe("eli/lta/2024/48");
  });

  it("exposes components, lowercasing the channel", () => {
    const eli = Eli.parse("LTA/2024/48");
    expect(eli.publicationChannel).toBe("lta");
    expect(eli.year).toBe(2024);
    expect(eli.lawNumber).toBe("48");
  });

  it("builds fetch URLs per format (slash for xml/pdf, dot for json)", () => {
    const eli = Eli.parse("lta/2023/4");
    expect(eli.fetchUrl("xml")).toBe("https://www.retsinformation.dk/eli/lta/2023/4/xml");
    expect(eli.fetchUrl("pdf")).toBe("https://www.retsinformation.dk/eli/lta/2023/4/pdf");
    expect(eli.fetchUrl("json")).toBe("https://www.retsinformation.dk/eli/lta/2023/4.json");
  });

  it("does not carry a document type (publicationChannel is the channel, not the type)", () => {
    expect(Eli.parse("ltc/2025/12")).not.toHaveProperty("documentType");
  });

  it.each(["", "nonsense", "lta/2024", "lta/24/48", "/2024/48", "lta//48", "2024/48/1"])("rejects %s", (invalidEli) => {
    expect(() => Eli.parse(invalidEli)).toThrow(InvalidEliError);
  });
});
