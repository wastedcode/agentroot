# AgentRoot — Mandate

**One paragraph:**
AgentRoot indexes the agentic internet by monitoring DNS zone files for `_agent` TXT records. Rather than crawling individual websites, AgentRoot reads publicly available zone files (via ICANN CZDS and other sources) to discover domains that have published agent capability records. It builds and maintains a SQLite registry of discovered agents — their names, capabilities, endpoints, and protocols — and serves this registry via a web API and UI that anyone can query. AgentRoot is the DNS-native directory for the emerging agentic web.

**Success looks like:**
- Zone files are being processed and new `_agent` records are discovered automatically
- The registry is queryable — "find me an agent that can do X"
- The UI shows the agentic internet growing in real time
- The `_agent` TXT record format is documented and publishable as a standard

**Out of scope:**
- Hitting individual domains to verify agents (DNS only)
- Ranking or scoring agents (just index, let others build on top)
- Authentication or access control in v1
