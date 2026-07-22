# Latvian Law MCP Server

<!-- ANSVAR-CTA-BEGIN -->
> **The Latvian law corpus is now served through the Ansvar Gateway.** Connect your AI assistant (Claude, Copilot, Cursor, custom MCP client) to `https://gateway.ansvar.eu/mcp` — one OAuth connection, free tier available, covering this corpus plus EU regulations, national law across dozens of audited jurisdictions (Europe + the US), and CVE/security intelligence, every result with a verbatim source citation. Start at https://ansvar.eu/docs/quickstart

### Connect

**Claude Code** (one line):

```bash
claude mcp add ansvar --transport http https://gateway.ansvar.eu/mcp
```

**Claude Desktop / Cursor** — add to `claude_desktop_config.json` (or `mcp.json`):

```json
{
  "mcpServers": {
    "ansvar": {
      "type": "url",
      "url": "https://gateway.ansvar.eu/mcp"
    }
  }
}
```

**Claude.ai** — Settings → Connectors → Add custom connector → paste `https://gateway.ansvar.eu/mcp`

First request opens an OAuth signup flow (setup details: [ansvar.eu/docs/quickstart](https://ansvar.eu/docs/quickstart)). After signup, your client is bound to your account; tier (free / premium / team / company) determines fan-out, quota, and which downstream MCPs are reachable.

---

## Self-host this MCP

You can also clone this repo and build the corpus yourself. The schema,
fetcher, and tool implementations all live here. What is not in the repo is
the pre-built database — TDM and standards-licensing constraints on the
upstream sources mean we host the corpus on Ansvar infrastructure rather
than redistribute it as a public artifact.

Build your own: run this repo's ingestion script (entry-point varies per
repo — typically `scripts/ingest.sh`, `npm run ingest`, or `make ingest`;
check the repo root).
<!-- ANSVAR-CTA-END -->


**The Latvijas Vēstnesis alternative for the AI age.**

[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub stars](https://img.shields.io/github/stars/Ansvar-Systems/Latvian-law-mcp?style=social)](https://github.com/Ansvar-Systems/Latvian-law-mcp)
[![CI](https://github.com/Ansvar-Systems/Latvian-law-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/Latvian-law-mcp/actions/workflows/ci.yml)
[![Daily Data Check](https://github.com/Ansvar-Systems/Latvian-law-mcp/actions/workflows/check-updates.yml/badge.svg)](https://github.com/Ansvar-Systems/Latvian-law-mcp/actions/workflows/check-updates.yml)
[![Database](https://img.shields.io/badge/database-pre--built-green)](docs/EU_INTEGRATION_GUIDE.md)
[![Provisions](https://img.shields.io/badge/provisions-57%2C679-blue)](docs/EU_INTEGRATION_GUIDE.md)

Query **2,249 Latvian statutes** -- from the Fizisko personu datu apstrādes likums and Krimināllikums to the Civillikums, Darba likums, and more -- directly from Claude, Cursor, or any MCP-compatible client.

If you're building legal tech, compliance tools, or doing Latvian legal research, this is your verified reference database.

Built by [Ansvar Systems](https://ansvar.eu) -- Stockholm, Sweden

---

## Why This Exists

Latvian legal research means navigating likumi.lv, the Latvijas Vēstnesis official gazette, and EUR-Lex for EU implementation status -- across a comprehensive system of codes and regulations. Whether you're:

- A **lawyer** validating citations before the Augstākā tiesa (Supreme Court) or Satversmes tiesa (Constitutional Court)
- A **compliance officer** checking GDPR implementation under Fizisko personu datu apstrādes likums or NIS2 requirements
- A **legal tech developer** building tools on Latvian law
- A **researcher** tracing EU directive transposition across 2,249 statutes

...you shouldn't need dozens of browser tabs and manual cross-referencing. Ask Claude. Get the exact provision. With context.

This MCP server makes Latvian law **searchable, cross-referenceable, and AI-readable**.

---

## Example Queries

Once connected, just ask naturally:

- *"Ko nosaka Fizisko personu datu apstrādes likuma 25. pants par datu apstrādi?"*
- *"Vai Krimināllikums ir spēkā?"*
- *"Meklēt 'personas datu aizsardzība' Latvijas tiesību aktos"*
- *"Kādi ES tiesību akti ir Darba likuma pamatā?"*
- *"Kuri Latvijas likumi īsteno NIS2 direktīvu?"*
- *"Ko paredz Civillikuma 1785. pants par saistību tiesībām?"*
- *"Validēt citātu 'Fizisko personu datu apstrādes likums, 25. pants'"*
- *"Salīdzināt datu aizsardzības prasības dažādās NIS2 Latvijas implementācijās"*

---

## What's Included

| Category | Count | Details |
|----------|-------|---------|
| **Statutes** | 2,249 statutes | Comprehensive Latvian legislation from likumi.lv |
| **Provisions** | 57,679 sections | Full-text searchable with FTS5 |
| **Premium: Case Law** | 127,042 decisions | Augstākā tiesa, Satversmes tiesa, Administratīvā tiesa (Premium tier) |
| **Premium: Preparatory Works** | 29,516 documents | Saeima anotācijas and explanatory reports (Premium tier) |
| **Database Size** | 131 MB | Optimized SQLite, portable |
| **Daily Updates** | Automated | Freshness checks against likumi.lv |

**Verified data only** -- every citation is validated against official sources (likumi.lv, Latvijas Vēstnesis). Zero LLM-generated content.

The premium dataset is substantial: 127,042 court decisions from Latvia's three levels of courts plus 29,516 preparatory works.

---

## See It In Action

### Why This Works

**Verbatim Source Text (No LLM Processing):**
- All statute text is ingested from likumi.lv (the official consolidated legislation portal, maintained by the Republic of Latvia)
- Provisions are returned **unchanged** from SQLite FTS5 database rows
- Zero LLM summarization or paraphrasing -- the database contains statute text, not AI interpretations

**Smart Context Management:**
- Search returns ranked provisions with BM25 scoring (safe for context)
- Provision retrieval gives exact text by statute identifier + section number
- Cross-references help navigate without loading everything at once

**Technical Architecture:**
```
likumi.lv --> Parse --> SQLite --> FTS5 snippet() --> MCP response
               ^                        ^
        Provision parser         Verbatim database query
```

### Traditional Research vs. This MCP

| Traditional Approach | This MCP Server |
|---------------------|-----------------|
| Search likumi.lv by statute name | Search by plain Latvian: *"personas datu apstrāde piekrišana"* |
| Navigate multi-section statutes manually | Get the exact provision with context |
| Manual cross-referencing between laws | `build_legal_stance` aggregates across sources |
| "Vai šis likums ir spēkā?" -- check manually | `check_currency` tool -- answer in seconds |
| Find EU basis -- dig through EUR-Lex | `get_eu_basis` -- linked EU directives instantly |
| No API, no integration | MCP protocol -- AI-native |

**Traditional:** Meklēt likumi.lv --> Pārvietoties daudzpantu likumos --> Ctrl+F --> Salīdzināt ar ES direktīvām --> Atkārtot

**This MCP:** *"Kāds ES tiesību akts ir Fizisko personu datu apstrādes likuma 25. panta pamatā?"* --> Done.

---

## Available Tools (13)

### Core Legal Research Tools (8)

| Tool | Description |
|------|-------------|
| `search_legislation` | FTS5 full-text search across 57,679 provisions with BM25 ranking. Supports Latvian, quoted phrases, boolean operators, prefix wildcards |
| `get_provision` | Retrieve specific provision by statute identifier + section (e.g., "Fizisko personu datu apstrādes likums" + "25") |
| `check_currency` | Check if a statute is in force, amended, or repealed |
| `validate_citation` | Validate citation against database -- zero-hallucination check |
| `build_legal_stance` | Aggregate citations from multiple statutes for a legal topic |
| `format_citation` | Format citations per Latvian conventions (full/short/pinpoint) |
| `list_sources` | List all available statutes with metadata, coverage scope, and data provenance |
| `about` | Server info, capabilities, dataset statistics, and coverage summary |

### EU Law Integration Tools (5)

| Tool | Description |
|------|-------------|
| `get_eu_basis` | Get EU directives/regulations for a Latvian statute |
| `get_latvian_implementations` | Find Latvian laws implementing a specific EU act |
| `search_eu_implementations` | Search EU documents with Latvian implementation counts |
| `get_provision_eu_basis` | Get EU law references for a specific provision |
| `validate_eu_compliance` | Check implementation status (future, requires EU MCP) |

---

## EU Law Integration

Latvia joined the EU on 1 May 2004. All EU regulations apply directly; directives require transposition into Latvian law.

| Metric | Value |
|--------|-------|
| **EU Membership** | Since 1 May 2004 |
| **Acquis communautaire** | Full EU legal order applies |
| **GDPR** | Implemented via Fizisko personu datu apstrādes likums |
| **NIS2** | Transposed via Informācijas tehnoloģiju drošības likums |
| **AML5** | Implemented via Noziedzīgi iegūtu līdzekļu legalizācijas un terorisma finansēšanas novēršanas likums |
| **EUR-Lex Integration** | Cross-references link Latvian statutes to source EU acts |

### Key EU-Derived Latvian Legislation

1. **Fizisko personu datu apstrādes likums** -- GDPR implementation (Regulation 2016/679)
2. **Informācijas tehnoloģiju drošības likums** -- NIS2 transposition (Directive 2022/2555)
3. **Finanšu instrumentu tirgus likums** -- MiFID II transposition
4. **Elektronisko sakaru likums** -- Electronic Communications Code transposition
5. **Noziedzīgi iegūtu līdzekļu likums** -- AML directive transposition

See [EU_INTEGRATION_GUIDE.md](docs/EU_INTEGRATION_GUIDE.md) for detailed documentation and [EU_USAGE_EXAMPLES.md](docs/EU_USAGE_EXAMPLES.md) for practical examples.

---

## Data Sources & Freshness

All content is sourced from authoritative Latvian legal databases:

- **[likumi.lv](https://likumi.lv/)** -- Official consolidated legislation, Republic of Latvia
- **[Latvijas Vēstnesis](https://www.vestnesis.lv/)** -- Official Gazette of the Republic of Latvia
- **[EUR-Lex](https://eur-lex.europa.eu/)** -- Official EU law database (cross-reference metadata)

### Data Provenance

| Field | Value |
|-------|-------|
| **Authority** | Republic of Latvia (Latvijas Republika) |
| **Languages** | Latvian (sole official legislative language) |
| **Coverage** | All national Latvian legislation; EU regulations apply directly |
| **Source** | likumi.lv |

### Automated Freshness Checks (Daily)

A [daily GitHub Actions workflow](.github/workflows/check-updates.yml) monitors likumi.lv for changes:

| Check | Method |
|-------|--------|
| **Statute amendments** | likumi.lv API date comparison against all 2,249 statutes |
| **New statutes** | likumi.lv index comparison (90-day window) |
| **Repealed statutes** | Status change detection |
| **EU reference staleness** | Flagged if >90 days old |

**Verified data only** -- every citation is validated against official sources. Zero LLM-generated content.

---

## Security

This project uses multiple layers of automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **CodeQL** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Semgrep** | SAST scanning (OWASP top 10, secrets, TypeScript) | Every push |
| **Gitleaks** | Secret detection across git history | Every push |
| **Trivy** | CVE scanning on filesystem and npm dependencies | Daily |
| **Socket.dev** | Supply chain attack detection | PRs |
| **Dependabot** | Automated dependency updates | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Legal Advice

> **THIS TOOL IS NOT LEGAL ADVICE**
>
> Statute text is sourced from likumi.lv (official consolidated legislation). However:
> - This is a **research tool**, not a substitute for professional legal counsel
> - **Court case coverage** in the free tier is not included -- consult the Augstākā tiesa (AT) and Satversmes tiesa databases directly; 127,042 decisions are available in the Premium tier
> - **Verify critical citations** against primary sources before court filings
> - **EU cross-references** are derived from statute text, not EUR-Lex full text analysis
> - **Consolidated versions** on likumi.lv are authoritative but verify promulgation dates against Latvijas Vēstnesis for court proceedings

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [PRIVACY.md](PRIVACY.md)

### Client Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment. Consult Latvijas Zvērinātu advokātu padome (Latvian Council of Sworn Advocates) guidelines on AI use in legal practice.

---

## Development

### Setup

```bash
git clone https://github.com/Ansvar-Systems/Latvian-law-mcp
cd Latvian-law-mcp
npm install
npm run build
npm test
```

### Running Locally

```bash
npm run dev                                       # Start MCP server
npx @anthropic/mcp-inspector node dist/index.js   # Test with MCP Inspector
```

### Data Management

```bash
npm run ingest                    # Ingest statutes from likumi.lv
npm run ingest:linked             # Ingest linked legislation
npm run ingest:corpus             # Full corpus ingestion
npm run build:db                  # Rebuild SQLite database
npm run drift:detect              # Run drift detection against anchors
npm run check-updates             # Check for amendments
```

### Performance

- **Search Speed:** <100ms for most FTS5 queries
- **Database Size:** 131 MB (optimized, portable)
- **Reliability:** 100% ingestion success rate across 2,249 statutes

---

## More Ansvar MCPs

Full fleet coverage at [ansvar.eu/coverage](https://ansvar.eu/coverage).
## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Priority areas:
- Court case law expansion (free tier -- Augstākā tiesa decisions)
- EU cross-reference expansion (full directive-to-statute mapping)
- Historical statute versions and amendment tracking
- Lower court decisions (Apgabaltiesa, Rajona tiesa archives)

---

## Roadmap

- [x] Core statute database with FTS5 search
- [x] Full corpus ingestion (2,249 statutes, 57,679 provisions)
- [x] EU law integration tools
- [x] Vercel Streamable HTTP deployment

- [x] Premium dataset: 127,042 case law decisions + 29,516 preparatory works
- [ ] Court case law expansion (free tier)
- [ ] Lower court coverage (Apgabaltiesa archives)
- [ ] Historical statute versions (amendment tracking)
- [ ] Web API for programmatic access

---

## Citation

If you use this MCP server in academic research:

```bibtex
@software{latvian_law_mcp_2026,
  author = {Ansvar Systems AB},
  title = {Latvian Law MCP Server: AI-Powered Legal Research Tool},
  year = {2026},
  url = {https://github.com/Ansvar-Systems/Latvian-law-mcp},
  note = {2,249 Latvian statutes with 57,679 provisions and EU law cross-references}
}
```

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) for details.

### Data Licenses

- **Statutes & Legislation:** `LV-Statutory-PD` — Latvian statutory public domain under Autortiesību likums §6, which excludes normative and administrative acts, other documents issued by State and local-government authorities, court rulings, official translations, official consolidations, and statutorily-mandated maps from copyright protection. Verbatim basis: [likumi.lv consolidated text](https://likumi.lv/ta/id/5138-autortiesibu-likums) (in force from 05.04.2023). Commercial reuse permitted, no attribution required, no share-alike. See the Ansvar license catalog and the 2026-05-17 EU statutory-works verbatim audit for the full reading.
- **EU Metadata:** EUR-Lex (EU public domain)

---

## About Ansvar Systems

We build AI-accelerated compliance and legal research tools for the European market. This MCP server started as our internal reference tool for Latvian law -- turns out everyone building for the Baltic and EU markets has the same research frustrations.

So we're open-sourcing it. Navigating 2,249 statutes and their EU source directives shouldn't require a law degree.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

---

<p align="center">
  <sub>Built with care in Stockholm, Sweden</sub>
</p>
