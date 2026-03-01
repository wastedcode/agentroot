# AgentRoot

**The open registry for the agentic web.**

AgentRoot is a DNS-native directory for AI agents and skills. Agents declare their existence with a `_agent` TXT record. Skills declare theirs with a `_skill` TXT record. AgentRoot indexes them.

No gatekeepers. No crawlers. Just DNS.

→ **[agentroot.io](https://agentroot.io)**

---

## How it works

1. Add a TXT record to your domain's DNS:
   ```
   _agent.yourdomain.com  TXT  "v=agent1 name=MyAgent caps=search,analyze endpoint=https://yourdomain.com/api proto=rest"
   ```

2. Submit your domain at [agentroot.io/submit.html](https://agentroot.io/submit.html)

3. AgentRoot verifies via DNS lookup and adds you to the registry

---

## The TXT record format

### Agents (`_agent.<domain>`)
```
v=agent1 name=<name> caps=<cap1,cap2> endpoint=<url> proto=<protocol> desc=<description>
```

### Skills (`_skill.<domain>`)
```
v=skill1 name=<name> proto=<mcp|openapi|rest|graphql> caps=<cap1,cap2> endpoint=<url> schema=<schema-url> auth=<none|apikey|oauth|bearer> cost=<free|paid|freemium>
```

Full spec: [agentroot.io/spec.html](https://agentroot.io/spec.html)

---

## Running locally

```bash
cd server
npm install
node index.js
```

Server runs on port 4747 by default. Set `PORT` env var to override.

---

## API

```bash
# List all agents
curl https://agentroot.io/api/agents

# List all skills
curl https://agentroot.io/api/skills

# Combined discovery (agents + skills)
curl https://agentroot.io/api/discover

# Register a domain
curl -X POST https://agentroot.io/api/submit \
  -H "Content-Type: application/json" \
  -d '{"domain": "yourdomain.com"}'

# Stats
curl https://agentroot.io/api/stats
```

Full API docs: [agentroot.io/api.html](https://agentroot.io/api.html)

---

## Self-hosting

AgentRoot is open source. Run your own instance:

```bash
git clone https://github.com/[your-username]/agentroot
cd agentroot/server
npm install
PORT=4747 node index.js
```

SQLite database is created automatically at `data/registry.db`.

---

## Roadmap

- **v1** (live) — Submit & verify via DNS TXT lookup
- **v2** — Zone file ingestion (auto-discover from ICANN zone files)
- **v3** — Semantic capability search
- **v4** — Decentralized nodes

---

## Contributing

The `_agent` and `_skill` TXT record formats are open standards. PRs welcome on the spec.

---

Built by [@InderpreetSingh](https://x.com/InderpreetSingh)
