const express = require('express');
const path = require('path');
const fs = require('fs');
const { queries, skillQueries, deriveCategory, extractRootDomain, CATEGORIES } = require('./db');
const { lookupAgent, lookupSkill, lookupBoth } = require('./dns');
const { verifyDomain, startVerificationCron, getLastRun } = require('./verify');

const app = express();
const HOST = '0.0.0.0';
const PORT = 4747;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── SEO Static Files ──────────────────────────────────────────────────────

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Sitemap: https://agentroot.io/sitemap.xml
`);
});

app.get('/sitemap.xml', (req, res) => {
  const base = 'https://agentroot.io';
  const agents = queries.getAll.all();
  const skills = skillQueries.getAll.all();
  const staticPages = ['', '/howitworks.html', '/api.html', '/spec.html', '/submit.html', '/categories.html'];
  
  const urls = [
    ...staticPages.map(p => `
  <url>
    <loc>${base}${p}</loc>
    <changefreq>weekly</changefreq>
    <priority>${p === '' ? '1.0' : '0.8'}</priority>
  </url>`),
    ...agents.map(a => `
  <url>
    <loc>${base}/agents/${encodeURIComponent(a.domain)}</loc>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
    <lastmod>${(a.last_verified || a.submitted_at || '').split('T')[0] || new Date().toISOString().split('T')[0]}</lastmod>
  </url>`),
    ...skills.map(s => `
  <url>
    <loc>${base}/skills/${encodeURIComponent(s.domain)}</loc>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
    <lastmod>${(s.last_verified || s.submitted_at || '').split('T')[0] || new Date().toISOString().split('T')[0]}</lastmod>
  </url>`)
  ];
  
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}
</urlset>`);
});

// ─── SEO Agent Routes ──────────────────────────────────────────────────────

app.get('/agents/:domain', (req, res) => {
  const { domain } = req.params;
  const agent = queries.getByDomain.get(domain);
  
  const agentHtmlPath = path.join(__dirname, '../public/agent.html');
  let html = fs.readFileSync(agentHtmlPath, 'utf8');
  
  const name = (agent && agent.name) || domain;
  const desc = (agent && agent.description) || `AI agent registered on AgentRoot — DNS-native agent registry.`;
  const caps = (agent && agent.capabilities) || '';
  
  const metaTags = `
  <meta name="description" content="${esc(desc)}">
  <meta property="og:title" content="${esc(name)} — AgentRoot">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://agentroot.io/agents/${esc(domain)}">
  <meta property="og:site_name" content="AgentRoot">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${esc(name)} — AgentRoot">
  <meta name="twitter:description" content="${esc(desc)}">
  <link rel="canonical" href="https://agentroot.io/agents/${esc(domain)}">
  ${agent ? `<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "${esc(name)}",
    "description": "${esc(desc)}",
    "url": "https://agentroot.io/agents/${esc(domain)}",
    "applicationCategory": "AIApplication",
    ${agent.endpoint ? `"installUrl": "${esc(agent.endpoint)}",` : ''}
    "keywords": "${esc(caps)}",
    "publisher": {
      "@type": "Organization",
      "name": "AgentRoot",
      "url": "https://agentroot.io"
    }
  }
  </script>` : ''}`;
  
  html = html.replace('<head>', `<head>\n${metaTags}`);
  html = html.replace('<title>Agent Detail — AgentRoot</title>', `<title>${esc(name)} — AgentRoot</title>`);
  html = html.replace('const domain = new URLSearchParams(location.search).get(\'domain\');',
    `const domain = new URLSearchParams(location.search).get('domain') || ${JSON.stringify(domain)};`);
  
  res.type('text/html');
  res.send(html);
});

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── DOMAIN PAGE ───────────────────────────────────────────────────────────

app.get('/domain/:rootDomain', (req, res) => {
  const { rootDomain } = req.params;
  const domainHtmlPath = path.join(__dirname, '../public/domain.html');
  let html = fs.readFileSync(domainHtmlPath, 'utf8');
  const metaTags = `
  <meta name="description" content="All agents and skills registered under ${esc(rootDomain)} on AgentRoot.">
  <meta property="og:title" content="${esc(rootDomain)} — AgentRoot">
  <meta property="og:description" content="All agents and skills registered under ${esc(rootDomain)}.">
  <link rel="canonical" href="https://agentroot.io/domain/${esc(rootDomain)}">`;
  html = html.replace('<head>', `<head>\n${metaTags}`);
  html = html.replace('const rootDomain = new URLSearchParams(location.search).get(\'domain\');',
    `const rootDomain = new URLSearchParams(location.search).get('domain') || ${JSON.stringify(rootDomain)};`);
  res.type('text/html');
  res.send(html);
});

// ─── AGENT API ─────────────────────────────────────────────────────────────

app.get('/api/agents', (req, res) => {
  const { q, caps, status, category } = req.query;
  let agents;
  
  if (q) {
    agents = queries.search.all(q, q, q, q);
  } else {
    agents = queries.getAll.all();
  }
  
  if (caps) {
    const capList = caps.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
    agents = agents.filter(a => {
      if (!a.capabilities) return false;
      const agentCaps = a.capabilities.toLowerCase();
      return capList.every(cap => agentCaps.includes(cap));
    });
  }
  
  if (status) agents = agents.filter(a => a.status === status);
  if (category) agents = agents.filter(a => a.category === category);
  
  res.json({ agents, count: agents.length });
});

app.get('/api/agents/:domain/badge', (req, res) => {
  const { domain } = req.params;
  const agent = queries.getByDomain.get(domain);
  const isActive = agent && agent.status === 'active';
  
  const label = 'AgentRoot';
  const message = isActive ? '✓ listed' : 'not listed';
  const color = isActive ? '34d399' : 'f87171';
  const labelWidth = 80;
  const messageWidth = isActive ? 72 : 76;
  const totalWidth = labelWidth + messageWidth;
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${message}">
  <title>${label}: ${message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="#${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="110">
    <text x="${labelWidth / 2 * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 10) * 10}" lengthAdjust="spacing">${label}</text>
    <text x="${labelWidth / 2 * 10}" y="140" transform="scale(.1)" textLength="${(labelWidth - 10) * 10}" lengthAdjust="spacing">${label}</text>
    <text x="${(labelWidth + messageWidth / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(messageWidth - 10) * 10}" lengthAdjust="spacing">${message}</text>
    <text x="${(labelWidth + messageWidth / 2) * 10}" y="140" transform="scale(.1)" textLength="${(messageWidth - 10) * 10}" lengthAdjust="spacing">${message}</text>
  </g>
</svg>`;
  
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'max-age=300');
  res.send(svg);
});

app.get('/api/agents/:domain', (req, res) => {
  const agent = queries.getByDomain.get(req.params.domain);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json({ agent });
});

app.get('/api/agents/:domain/verify', async (req, res) => {
  const { domain } = req.params;
  try {
    const result = await verifyDomain(domain);
    const agent = queries.getByDomain.get(domain);
    res.json({ ...result, agent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/categories', (req, res) => {
  const counts = queries.categoryCounts.all();
  const countMap = {};
  counts.forEach(c => { countMap[c.category] = c.count; });
  
  const result = CATEGORIES.map(cat => ({
    ...cat,
    count: countMap[cat.id] || 0
  }));
  
  res.json({ categories: result });
});

// ─── DOMAIN API ────────────────────────────────────────────────────────────

// GET /api/domains — list distinct root domains with agent + skill counts
app.get('/api/domains', (req, res) => {
  const rows = queries.getDistinctRootDomains.all();
  // Also pick up root domains that only have skills
  const skillOnlyRows = skillQueries.getAll.all().reduce((acc, s) => {
    if (!s.root_domain) return acc;
    if (!rows.find(r => r.root_domain === s.root_domain)) {
      const existing = acc.find(a => a.root_domain === s.root_domain);
      if (existing) { existing.skill_count++; }
      else acc.push({ root_domain: s.root_domain, agent_count: 0, skill_count: 1 });
    }
    return acc;
  }, []);
  const all = [...rows, ...skillOnlyRows].sort((a, b) => (b.agent_count + b.skill_count) - (a.agent_count + a.skill_count));
  res.json({ domains: all, count: all.length });
});

// GET /api/domains/:rootDomain — agents + skills under a root domain
app.get('/api/domains/:rootDomain', (req, res) => {
  const { rootDomain } = req.params;
  const agents = queries.getAgentsByRootDomain.all(rootDomain);
  const skills = skillQueries.getSkillsByRootDomain.all(rootDomain);
  if (!agents.length && !skills.length) {
    return res.status(404).json({ error: 'No records found for this domain' });
  }
  res.json({ root_domain: rootDomain, agents, skills, total: agents.length + skills.length });
});

// ─── SKILL API ─────────────────────────────────────────────────────────────

// GET /api/skills — list skills, supports ?q=&caps=&proto=&auth=&cost=&status=
app.get('/api/skills', (req, res) => {
  const { q, caps, proto, auth, cost, status } = req.query;
  let skills;
  
  if (q) {
    skills = skillQueries.search.all(q, q, q, q);
  } else {
    skills = skillQueries.getAll.all();
  }
  
  if (caps) {
    const capList = caps.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
    skills = skills.filter(s => {
      if (!s.capabilities) return false;
      const skillCaps = s.capabilities.toLowerCase();
      return capList.every(cap => skillCaps.includes(cap));
    });
  }
  
  if (proto) skills = skills.filter(s => s.proto === proto);
  if (auth) skills = skills.filter(s => s.auth === auth);
  if (cost) skills = skills.filter(s => s.cost === cost);
  if (status) skills = skills.filter(s => s.status === status);
  
  res.json({ skills, count: skills.length });
});

// GET /api/skills/:domain/badge — SVG badge for a skill
app.get('/api/skills/:domain/badge', (req, res) => {
  const { domain } = req.params;
  const skill = skillQueries.getByDomain.get(domain);
  const isActive = skill && skill.status === 'active';
  
  const label = 'AgentRoot';
  const message = isActive ? `✓ ${skill.proto || 'skill'}` : 'not listed';
  const color = isActive ? '818cf8' : 'f87171';
  const labelWidth = 80;
  const messageWidth = 80;
  const totalWidth = labelWidth + messageWidth;
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${message}">
  <title>${label}: ${message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="#${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="110">
    <text x="${labelWidth / 2 * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 10) * 10}" lengthAdjust="spacing">${label}</text>
    <text x="${labelWidth / 2 * 10}" y="140" transform="scale(.1)" textLength="${(labelWidth - 10) * 10}" lengthAdjust="spacing">${label}</text>
    <text x="${(labelWidth + messageWidth / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(messageWidth - 10) * 10}" lengthAdjust="spacing">${message}</text>
    <text x="${(labelWidth + messageWidth / 2) * 10}" y="140" transform="scale(.1)" textLength="${(messageWidth - 10) * 10}" lengthAdjust="spacing">${message}</text>
  </g>
</svg>`;
  
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'max-age=300');
  res.send(svg);
});

// GET /api/skills/:domain — get skill by domain
app.get('/api/skills/:domain', (req, res) => {
  const skill = skillQueries.getByDomain.get(req.params.domain);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  res.json({ skill });
});

// ─── DISCOVER API ──────────────────────────────────────────────────────────

// GET /api/discover — combined agents + skills search
app.get('/api/discover', (req, res) => {
  const { q } = req.query;
  let agents, skills;
  
  if (q) {
    agents = queries.search.all(q, q, q, q);
    skills = skillQueries.search.all(q, q, q, q);
  } else {
    agents = queries.getAll.all();
    skills = skillQueries.getAll.all();
  }
  
  res.json({
    agents,
    skills,
    total: agents.length + skills.length
  });
});

// ─── SUBMIT API ────────────────────────────────────────────────────────────

// POST /api/submit — submit a domain, checks for both _agent and _skill records
app.post('/api/submit', async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain is required' });
  
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-\.]{0,253}[a-zA-Z0-9]$/;
  if (!domainRegex.test(domain)) {
    return res.status(400).json({ error: 'Invalid domain format' });
  }
  
  const cleanDomain = domain.toLowerCase().trim();
  
  try {
    const { agent: agentResult, skill: skillResult } = await lookupBoth(cleanDomain);
    
    const results = {
      domain: cleanDomain,
      agent: null,
      skill: null,
      found: []
    };
    
    // Handle agent record
    if (agentResult) {
      const { parsed, raw } = agentResult;
      const category = deriveCategory(parsed.caps);
      queries.upsertAgent.run({
        domain: cleanDomain,
        root_domain: extractRootDomain(cleanDomain),
        name: parsed.name || null,
        description: parsed.desc || null,
        capabilities: parsed.caps || null,
        endpoint: parsed.endpoint || null,
        protocol: parsed.proto || null,
        card_url: parsed.card || null,
        raw_record: raw,
        status: 'active',
        category
      });
      results.agent = queries.getByDomain.get(cleanDomain);
      results.found.push('_agent');
    } else {
      // Store pending agent if no existing record
      const existing = queries.getByDomain.get(cleanDomain);
      if (!existing) {
        queries.upsertAgent.run({
          domain: cleanDomain,
          root_domain: extractRootDomain(cleanDomain),
          name: null, description: null, capabilities: null,
          endpoint: null, protocol: null, card_url: null,
          raw_record: null, status: 'pending', category: null
        });
      }
    }
    
    // Handle skill record
    if (skillResult) {
      const { parsed, raw } = skillResult;
      skillQueries.upsertSkill.run({
        domain: cleanDomain,
        root_domain: extractRootDomain(cleanDomain),
        name: parsed.name || null,
        description: parsed.desc || null,
        capabilities: parsed.caps || null,
        proto: parsed.proto || null,
        endpoint: parsed.endpoint || null,
        schema_url: parsed.schema || null,
        auth: parsed.auth || 'none',
        cost: parsed.cost || 'free',
        raw_record: raw,
        status: 'active'
      });
      results.skill = skillQueries.getByDomain.get(cleanDomain);
      results.found.push('_skill');
    }
    
    if (results.found.length > 0) {
      results.success = true;
      results.message = `Found and indexed: ${results.found.join(', ')} records for ${cleanDomain}`;
    } else {
      results.success = false;
      results.message = `No _agent or _skill TXT records found for ${cleanDomain}`;
      results.instructions = {
        agent: {
          record: `_agent.${cleanDomain}`,
          type: 'TXT',
          value: `v=agent1 name=YourAgent caps=your,capabilities endpoint=https://${cleanDomain}/a2a`
        },
        skill: {
          record: `_skill.${cleanDomain}`,
          type: 'TXT',
          value: `v=skill1 name=YourSkill proto=mcp caps=tool1,tool2 endpoint=https://${cleanDomain}/mcp`
        },
        spec: 'https://agentroot.io/spec.html'
      };
    }
    
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── STATS API ─────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const agentCounts = queries.stats.get();
  const skillCounts = skillQueries.stats.get();
  const lastVerification = getLastRun();
  
  const agents = queries.getAll.all();
  const byTld = {};
  agents.forEach(a => {
    const parts = a.domain.split('.');
    const tld = parts[parts.length - 1];
    byTld[tld] = (byTld[tld] || 0) + 1;
  });
  
  res.json({
    agents: {
      total: agentCounts.total,
      active: agentCounts.active,
      pending: agentCounts.pending,
      failed: agentCounts.failed
    },
    skills: {
      total: skillCounts.total,
      active: skillCounts.active,
      pending: skillCounts.pending,
      failed: skillCounts.failed
    },
    // Legacy top-level fields for backwards compat
    total: agentCounts.total,
    active: agentCounts.active,
    pending: agentCounts.pending,
    failed: agentCounts.failed,
    lastVerification,
    byTld
  });
});

// ─── WELL-KNOWN ─────────────────────────────────────────────────────────────

app.get('/.well-known/agent-card.json', (req, res) => {
  res.json({
    name: 'AgentRoot',
    description: 'DNS-native registry for the agentic internet. Discovers and indexes agents and skills via _agent and _skill TXT DNS records.',
    version: '2.0.0',
    endpoint: `https://agentroot.io/a2a`,
    protocol: 'a2a',
    capabilities: ['agent_discovery', 'skill_discovery', 'registry_query', 'dns_verification', 'agent_submission'],
    registry: `https://agentroot.io/api/agents`,
    skills_registry: `https://agentroot.io/api/skills`,
    discover: `https://agentroot.io/api/discover`,
    spec: `https://agentroot.io/spec.html`,
    contact: 'https://agentroot.io',
    skills: [
      { name: 'discover_agents', description: 'Find agents by capability, name, or domain' },
      { name: 'discover_skills', description: 'Find callable skills by capability, protocol, or domain' },
      { name: 'discover_all', description: 'Find both agents and skills in one call' },
      { name: 'submit_domain', description: 'Submit a domain for _agent and _skill DNS record indexing' },
      { name: 'registry_stats', description: 'Get statistics about the indexed agent and skill registry' }
    ]
  });
});

// A2A protocol stub
app.post('/a2a', (req, res) => {
  const task = req.body;
  const taskId = task?.id || `task-${Date.now()}`;
  const skill = task?.skill || task?.action || 'unknown';

  if (skill === 'discover_agents' || skill === 'registry_query') {
    const q = task?.input?.query || task?.input?.q || '';
    const caps = task?.input?.capabilities || task?.input?.caps || '';
    let agents = queries.getAll.all();
    if (q) agents = queries.search.all(q, q, q, q);
    else if (caps) {
      const capList = caps.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
      agents = agents.filter(a => {
        if (!a.capabilities) return false;
        return capList.every(cap => a.capabilities.toLowerCase().includes(cap));
      });
    }
    return res.json({ id: taskId, status: 'completed', output: { agents, count: agents.length } });
  }

  if (skill === 'discover_skills') {
    const q = task?.input?.query || task?.input?.q || '';
    const proto = task?.input?.proto || '';
    let skills = skillQueries.getAll.all();
    if (q) skills = skillQueries.search.all(q, q, q, q);
    if (proto) skills = skills.filter(s => s.proto === proto);
    return res.json({ id: taskId, status: 'completed', output: { skills, count: skills.length } });
  }

  if (skill === 'discover_all') {
    const q = task?.input?.query || task?.input?.q || '';
    const agents = q ? queries.search.all(q, q, q, q) : queries.getAll.all();
    const skills = q ? skillQueries.search.all(q, q, q, q) : skillQueries.getAll.all();
    return res.json({ id: taskId, status: 'completed', output: { agents, skills, total: agents.length + skills.length } });
  }

  if (skill === 'registry_stats') {
    const agentCounts = queries.stats.get();
    const skillCounts = skillQueries.stats.get();
    return res.json({ id: taskId, status: 'completed', output: { agents: agentCounts, skills: skillCounts } });
  }

  res.json({
    id: taskId,
    status: 'completed',
    agent: 'AgentRoot',
    message: 'AgentRoot indexes the agentic internet via DNS _agent and _skill TXT records.',
    supported_skills: ['discover_agents', 'discover_skills', 'discover_all', 'submit_domain', 'registry_stats'],
    registry: `https://agentroot.io/api/agents`,
    skills_registry: `https://agentroot.io/api/skills`
  });
});

// ─── Catch-all ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─── Start ─────────────────────────────────────────────────────────────────

app.listen(PORT, HOST, () => {
  console.log(`[agentroot] Registry running at http://${HOST}:${PORT}`);
  startVerificationCron();
});
