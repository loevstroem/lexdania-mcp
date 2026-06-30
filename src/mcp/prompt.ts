export const SERVER_PROMPT = `LexDania / Danish legislation query server.
Tools to query, fact-check, and structurally inspect Danish laws published on Retsinformation.dk and their underlying LexDania XML.

LexDania is the official XML format for Danish legislation; its markup drifts across schema versions and years (e.g. BEKH 2016, LBKH 2022, LOVC 2025; older docs use a <Dokument> root, newer ones <lex:LexDaniaDokument>). Treat structure as version-dependent, not fixed.

Most laws use the legacy \`<Dokument>\` root with no namespace — query unprefixed (\`//Paragraf\`). Newer \`<lex:…>\` docs declare namespaces; call \`profile\` first and use the prefixes it returns (default ns, if any, exposed as \`d:\`).

Laws are addressed by ELI URI — https://retsinformation.dk/eli/{pubMedia}/{year}/{number}, e.g. eli/lta/2024/48. pubMedia is the publication channel (lta/ltb/ltc = Lovtidende A/B/C, mt, ft, ...), NOT the document type. The document type (LOV/LBKH/BEKH/...) is separate metadata — never infer it from the URI. Tools accept the full URI, bare-host, or short path (lta/2024/48); host is normalized automatically.

Use for: fact-checking a legal claim against primary text; deep research across the corpus; inspecting a law's XML shape when working on parsing/ingestion. Answers carry citations to primary text; structural tools return deterministic facts. Machine-readable XML exists only for documents from 2007-09-24 onward.`;
