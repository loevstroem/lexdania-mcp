/**
 * Domain value object: a Danish-legislation ELI identifier.
 *
 * Accepts a full URL, a bare-host path, or a short path and normalizes them to
 * a single host-independent identity. `pubMedia` is the publication channel
 * (lta/ltb/ltc/mt/ft/...), NOT the document type — the document type is separate
 * metadata and is never inferred here.
 */

export type ResourceFormat = "xml" | "pdf" | "json";

const FETCH_HOST = "https://www.retsinformation.dk";

export class InvalidEliError extends Error {
  constructor(input: unknown) {
    super(`Invalid ELI: ${JSON.stringify(input)}. Expected a Retsinformation ELI such as "eli/lta/2024/48", "lta/2024/48", or "https://www.retsinformation.dk/eli/lta/2024/48".`);
    this.name = "InvalidEliError";
  }
}

export class Eli {
  private constructor(
    readonly publicationChannel: string,
    readonly year: number,
    readonly lawNumber: string,
  ) {}

  /** Parse and normalize any accepted ELI form. Throws {@link InvalidEliError} on malformed input. */
  static parse(input: string): Eli {
    if (typeof input !== "string") throw new InvalidEliError(input);

    let normalized = input.trim();
    normalized = normalized.split(/[?#]/)[0] ?? "";
    // Strip scheme, host (www to bare), optional prefixes, suffix, formats, languages, and stray slashes.
    normalized = normalized.replace(/^https?:\/\//i, "");
    normalized = normalized.replace(/^(www\.)?retsinformation\.dk\//i, "");
    normalized = normalized.replace(/^eli\//i, "");
    normalized = normalized.replace(/\.json$/i, "");
    normalized = normalized.replace(/\/(xml|pdf)$/i, "");
    normalized = normalized.replace(/\/dan$/i, "");
    normalized = normalized.replace(/^\/+|\/+$/g, "");

    const match = /^([a-zA-Z]+)\/(\d{4})\/(\d+)$/.exec(normalized);
    const publicationChannel = match?.[1];
    const year = match?.[2];
    const lawNumber = match?.[3];
    if (publicationChannel === undefined || year === undefined || lawNumber === undefined) {
      throw new InvalidEliError(input);
    }

    // Strip leading zeros so "048" and "48" share one identity / dedup key.
    return new Eli(publicationChannel.toLowerCase(), Number(year), lawNumber.replace(/^0+(?=\d)/, ""));
  }

  /** Host-independent identity / dedup key, e.g. "eli/lta/2024/48". */
  get id(): string {
    return `eli/${this.publicationChannel}/${this.year}/${this.lawNumber}`;
  }

  /** Canonical fetch URL for a resource format on retsinformation.dk. */
  fetchUrl(format: ResourceFormat): string {
    const base = `${FETCH_HOST}/${this.id}`;
    return format === "json" ? `${base}.json` : `${base}/${format}`;
  }

  toString(): string {
    return this.id;
  }
}
