# LexDania MCP Server

A Model Context Protocol (MCP) server running on Cloudflare Workers. It enables AI models to query, structurally inspect, and perform RAG-based Q&A over Danish legislation published on Retsinformation.dk using their underlying LexDania XML.

## Getting Started

### Prerequisites
- Node.js & `pnpm`
- Cloudflare Wrangler CLI (`pnpm install -g wrangler`)
- Gemini API Key

### Installation
```bash
pnpm install
```

### Local Development
1. Create a `.dev.vars` file in the root:
   ```env
   GEMINI_API_KEY=your-gemini-api-key
   FILE_SEARCH_STORE=fileSearchStores/your-store-id
   MCP_AUTH_TOKEN=your-secret-bearer-token
   ```
2. Start the development server:
   ```bash
   pnpm dev
   ```

### Deployment
```bash
pnpm deploy
```

## Connection

Add the following to your MCP client configuration (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lexdania": {
      "url": "https://lexdania.pacmate.dk/mcp",
      "headers": {
        "Authorization": "Bearer <your-mcp-auth-token>"
      }
    }
  }
}
```

## Features & Tools

Exposes the following tools to MCP clients:
- **`lexdania_ask_document`**: Free-text Q&A over Danish legislative documents using Gemini File Search.
- **`lexdania_query_document`**: Execute exact, namespace-aware XPath queries against a law's LexDania XML. Returns matched XML structures and aligned plain-text strings. The default (unprefixed) namespace is mapped to `d:`.
- **`lexdania_profile_document`**: Get a structural profile (root tag, schema variant, tag counts, depth, and namespaces) of a law's XML.
- **`lexdania_metadata`**: Fetch and parse JSON-LD metadata for a Danish legislation document by its ELI path or URL (returns title, document type, dates, ministry, status, and relationship edges).
- **`lexdania_compare_structure`**: Diff elements and attributes across multiple documents to identify parser drift and schema variants.

## Project Structure
```text
├── src/
│   ├── index.ts        # Worker entrypoint (routing & auth)
│   ├── http/           # HTTP authentication logic
│   ├── mcp/            # MCP server composition & tools
│   │   └── tools/      # Tool implementations (ask, query, structure, metadata, compare)
│   └── services/       # Core services (Gemini store, XML parsing)
├── test/               # Vitest suite
└── wrangler.jsonc      # Cloudflare Workers configuration
```

## License
MIT
