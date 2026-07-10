export const SERVER_PROMPT = `LexDania / Danish legislation query server.

Purpose:
Research and fact-check Danish legal documents on Retsinformation.dk against primary text; inspect their LexDania XML for parsing and ingestion.

Terminology:
- Metadata describes a document's identity, status, dates, and relationships, not its substantive legal text.
- An ELI identifies a legal resource. \`pubMedia\` is its publication channel; \`documentType\` is its document category. Never infer one from the other.
- Common document types: \`LOVH\` act; \`LOVC\` amending act; \`LBKH\` consolidated act; \`BEKH\` statutory order; \`BEKC\` amending statutory order.
- Relationship fields point outward from the returned resource: \`basedOn\` = resources providing its legal basis; \`changes\` = resources it amends or replaces; \`consolidates\` = resources incorporated into its consolidated text; \`commences\` = resources it brings into force. Omitted optional values mean unknown; empty arrays mean none recorded in the source metadata.

ELI inputs:
Use https://www.retsinformation.dk/eli/{pubMedia}/{year}/{number}, e.g. eli/lta/2024/48. Tools also accept bare-host and short paths such as lta/2024/48; the host is normalized automatically.

XML workflow:
LexDania structure and namespaces vary. Profile unfamiliar XML with \`lexdania_profile_document\` before querying it; use the returned prefixes, with a default namespace exposed as \`d:\`. Legacy \`<Dokument>\` roots are unnamespaced.

All documents have XML endpoints, but LexDania content and metadata exist only for documents published after 2007-09-24.

Q&A workflow:
Unscoped Q&A searches the configured indexed corpus, not all of Retsinformation. Use Q&A for discovery and synthesis; verify material claims against returned citations, metadata, or exact XML queries.`;
