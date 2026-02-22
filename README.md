# Latvian Law MCP

[![npm](https://img.shields.io/npm/v/@ansvar/latvian-law-mcp)](https://www.npmjs.com/package/@ansvar/latvian-law-mcp)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/Ansvar-Systems/Latvian-law-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/Latvian-law-mcp/actions/workflows/ci.yml)

A Model Context Protocol (MCP) server providing access to Latvian legislation covering data protection, cybersecurity, e-commerce, and criminal law provisions.

**MCP Registry:** `eu.ansvar/latvian-law-mcp`
**npm:** `@ansvar/latvian-law-mcp`

## Quick Start

### Claude Desktop / Cursor (stdio)

```json
{
  "mcpServers": {
    "latvian-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/latvian-law-mcp"]
    }
  }
}
```

### Remote (Streamable HTTP)

```
latvian-law-mcp.vercel.app/mcp
```

## Data Sources

| Source | Authority | License |
|--------|-----------|---------|
| [Likumi.lv](https://likumi.lv) | Latvijas Vēstnesis (Official Gazette of Latvia) | Latvian Government Open Data (public domain under Latvian Copyright Law Art. 6) |

> Full provenance: [`sources.yml`](./sources.yml)

## Tools

| Tool | Description |
|------|-------------|
| `search_legislation` | Full-text search across provisions |
| `get_provision` | Retrieve specific article/section |
| `validate_citation` | Validate legal citation |
| `check_currency` | Check if statute is in force |
| `get_eu_basis` | EU legal basis cross-references |
| `get_latvian_implementations` | National EU implementations |
| `search_eu_implementations` | Search EU documents |
| `validate_eu_compliance` | EU compliance check |
| `build_legal_stance` | Comprehensive legal research |
| `format_citation` | Citation formatting |
| `list_sources` | Data provenance |
| `about` | Server metadata |

## License

Apache-2.0


---

## Important Disclaimers

### Not Legal Advice

> **THIS TOOL IS NOT LEGAL ADVICE**
>
> Statute text is sourced from official government publications. However:
> - This is a **research tool**, not a substitute for professional legal counsel
> - **Coverage may be incomplete** — verify critical provisions against primary sources
> - **Verify all citations** against the official legal portal before relying on them professionally
> - Laws change — check the `about` tool for database freshness date

### Client Confidentiality

When using the remote endpoint, queries are processed by third-party infrastructure
(Vercel, Claude API). For privileged or confidential legal matters, use the local
npm package or on-premise deployment.

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [PRIVACY.md](PRIVACY.md)

---

## Open Law

This server is part of **Ansvar Open Law** — free, structured access to legislation
from 70+ jurisdictions worldwide via the Model Context Protocol.

**Browse all jurisdictions ->** [ansvar.eu/open-law](https://ansvar.eu/open-law)

## Ansvar MCP Network

Ansvar Open Law is part of the broader **Ansvar MCP Network** — 80+ servers covering
global legislation, EU/US compliance frameworks, and cybersecurity standards.

| Category | Coverage |
|----------|----------|
| **Legislation** | 70+ jurisdictions worldwide |
| **EU Compliance** | 49 regulations, 2,693 articles |
| **US Compliance** | 15 federal & state regulations |
| **Security Frameworks** | 261 frameworks, 1,451 controls |
| **Cybersecurity** | 200K+ CVEs, STRIDE patterns, sanctions |

**Explore the full network ->** [ansvar.ai/mcp](https://ansvar.ai/mcp)

---

Built by [Ansvar Systems](https://ansvar.eu) | [ansvar.eu/open-law](https://ansvar.eu/open-law)
