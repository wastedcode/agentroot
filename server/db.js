const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/registry.db');
const db = new Database(DB_PATH);

// Enable WAL for better concurrent reads
db.pragma('journal_mode = WAL');

// Schema
db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT UNIQUE NOT NULL,
  name TEXT,
  description TEXT,
  capabilities TEXT,
  endpoint TEXT,
  protocol TEXT DEFAULT 'a2a',
  card_url TEXT,
  raw_record TEXT,
  submitted_at TEXT DEFAULT (datetime('now')),
  first_verified TEXT,
  last_checked TEXT,
  last_verified TEXT,
  status TEXT DEFAULT 'pending',
  source TEXT DEFAULT 'submission',
  category TEXT
);

CREATE TABLE IF NOT EXISTS verification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT,
  checked_at TEXT DEFAULT (datetime('now')),
  result TEXT,
  raw_record TEXT
);

CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT UNIQUE NOT NULL,
  name TEXT,
  description TEXT,
  capabilities TEXT,
  proto TEXT,
  endpoint TEXT,
  schema_url TEXT,
  auth TEXT DEFAULT 'none',
  cost TEXT DEFAULT 'free',
  raw_record TEXT,
  submitted_at TEXT DEFAULT (datetime('now')),
  first_verified TEXT,
  last_checked TEXT,
  last_verified TEXT,
  status TEXT DEFAULT 'pending',
  source TEXT DEFAULT 'submission'
);
`);

// Add category column to agents if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE agents ADD COLUMN category TEXT`);
} catch (e) {
  // Column already exists, ignore
}

// Add root_domain column to agents if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE agents ADD COLUMN root_domain TEXT`);
} catch (e) {}

// Add root_domain column to skills if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE skills ADD COLUMN root_domain TEXT`);
} catch (e) {}

// JS helper: extract root domain (last two parts, e.g. chat.example.com -> example.com)
function extractRootDomain(domain) {
  if (!domain) return domain;
  const parts = domain.split('.');
  if (parts.length <= 2) return domain;
  return parts.slice(-2).join('.');
}

// Backfill root_domain for existing rows using a JS-driven update
const backfillRows = db.prepare(`SELECT id, domain FROM agents WHERE root_domain IS NULL`).all();
const updateRootAgent = db.prepare(`UPDATE agents SET root_domain = ? WHERE id = ?`);
for (const row of backfillRows) {
  updateRootAgent.run(extractRootDomain(row.domain), row.id);
}

const backfillSkillRows = db.prepare(`SELECT id, domain FROM skills WHERE root_domain IS NULL`).all();
const updateRootSkill = db.prepare(`UPDATE skills SET root_domain = ? WHERE id = ?`);
for (const row of backfillSkillRows) {
  updateRootSkill.run(extractRootDomain(row.domain), row.id);
}

// Category mapping: maps capability keywords → category
const CATEGORY_MAP = {
  research: ['search', 'research', 'browse', 'web-search', 'knowledge', 'academic', 'summarize', 'rag'],
  finance: ['finance', 'trading', 'crypto', 'stocks', 'payments', 'billing', 'invoice', 'defi', 'wallet'],
  devtools: ['code', 'github', 'git', 'deploy', 'ci', 'devtools', 'debug', 'testing', 'lint', 'review'],
  data: ['data', 'analytics', 'database', 'etl', 'transform', 'csv', 'sql', 'chart', 'report', 'query'],
  communication: ['email', 'slack', 'discord', 'telegram', 'chat', 'messaging', 'notification', 'sms', 'webhook'],
  automation: ['automation', 'workflow', 'orchestration', 'scheduling', 'rpa', 'task', 'cron', 'trigger'],
  media: ['image', 'video', 'audio', 'tts', 'speech', 'media', 'art', 'generate', 'transcribe', 'ocr'],
  security: ['security', 'auth', 'scan', 'pentest', 'vulnerability', 'firewall', 'compliance', 'access']
};

function deriveCategory(capabilities) {
  if (!capabilities) return null;
  const caps = capabilities.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
    if (keywords.some(kw => caps.includes(kw))) return category;
  }
  return 'automation'; // default fallback
}

const CATEGORIES = [
  { id: 'research', label: 'Research', emoji: '🔍', desc: 'Search, browse, and knowledge agents' },
  { id: 'finance', label: 'Finance', emoji: '💰', desc: 'Trading, crypto, and payments agents' },
  { id: 'devtools', label: 'Dev Tools', emoji: '🛠️', desc: 'Code, deploy, and development agents' },
  { id: 'data', label: 'Data', emoji: '📊', desc: 'Analytics, ETL, and database agents' },
  { id: 'communication', label: 'Communication', emoji: '💬', desc: 'Messaging, email, and notification agents' },
  { id: 'automation', label: 'Automation', emoji: '⚙️', desc: 'Workflow, scheduling, and RPA agents' },
  { id: 'media', label: 'Media', emoji: '🎨', desc: 'Image, video, audio, and generation agents' },
  { id: 'security', label: 'Security', emoji: '🔒', desc: 'Auth, scanning, and compliance agents' }
];

// Agent queries
const queries = {
  getAll: db.prepare(`SELECT * FROM agents WHERE status = 'active' ORDER BY first_verified DESC`),
  
  search: db.prepare(`SELECT * FROM agents WHERE status = 'active' AND (
    domain LIKE '%' || ? || '%' OR
    name LIKE '%' || ? || '%' OR
    description LIKE '%' || ? || '%' OR
    capabilities LIKE '%' || ? || '%'
  ) ORDER BY first_verified DESC`),
  
  searchByCaps: db.prepare(`SELECT * FROM agents WHERE status = 'active' AND capabilities LIKE '%' || ? || '%' ORDER BY first_verified DESC`),
  
  getByDomain: db.prepare(`SELECT * FROM agents WHERE domain = ?`),
  
  upsertAgent: db.prepare(`INSERT INTO agents (domain, root_domain, name, description, capabilities, endpoint, protocol, card_url, raw_record, status, category, first_verified, last_verified, last_checked)
    VALUES (@domain, @root_domain, @name, @description, @capabilities, @endpoint, @protocol, @card_url, @raw_record, @status, @category, datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(domain) DO UPDATE SET
      root_domain = excluded.root_domain,
      name = excluded.name,
      description = excluded.description,
      capabilities = excluded.capabilities,
      endpoint = excluded.endpoint,
      protocol = excluded.protocol,
      card_url = excluded.card_url,
      raw_record = excluded.raw_record,
      status = excluded.status,
      category = excluded.category,
      last_verified = CASE WHEN excluded.status = 'active' THEN datetime('now') ELSE last_verified END,
      last_checked = datetime('now'),
      first_verified = CASE WHEN first_verified IS NULL AND excluded.status = 'active' THEN datetime('now') ELSE first_verified END`),
  
  updateChecked: db.prepare(`UPDATE agents SET last_checked = datetime('now'), status = ? WHERE domain = ?`),
  
  logVerification: db.prepare(`INSERT INTO verification_log (domain, result, raw_record) VALUES (?, ?, ?)`),
  
  getPendingAndActive: db.prepare(`SELECT domain FROM agents WHERE status IN ('active', 'pending')`),
  
  stats: db.prepare(`SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
  FROM agents`),
  
  recentLog: db.prepare(`SELECT * FROM verification_log ORDER BY checked_at DESC LIMIT 1`),
  
  getByCategory: db.prepare(`SELECT * FROM agents WHERE status = 'active' AND category = ? ORDER BY first_verified DESC`),
  
  categoryCounts: db.prepare(`SELECT category, COUNT(*) as count FROM agents WHERE status = 'active' AND category IS NOT NULL GROUP BY category`),

  // Domain browsing
  getDistinctRootDomains: db.prepare(`
    SELECT root_domain,
      COUNT(DISTINCT a.id) as agent_count,
      (SELECT COUNT(*) FROM skills s WHERE s.root_domain = a.root_domain AND s.status = 'active') as skill_count
    FROM agents a
    WHERE a.status = 'active' AND a.root_domain IS NOT NULL
    GROUP BY root_domain
    ORDER BY agent_count + skill_count DESC
  `),

  getAgentsByRootDomain: db.prepare(`SELECT * FROM agents WHERE root_domain = ? AND status = 'active' ORDER BY first_verified DESC`)
};

// Skill queries
const skillQueries = {
  getAll: db.prepare(`SELECT * FROM skills WHERE status = 'active' ORDER BY first_verified DESC`),
  
  search: db.prepare(`SELECT * FROM skills WHERE status = 'active' AND (
    domain LIKE '%' || ? || '%' OR
    name LIKE '%' || ? || '%' OR
    description LIKE '%' || ? || '%' OR
    capabilities LIKE '%' || ? || '%'
  ) ORDER BY first_verified DESC`),
  
  getByDomain: db.prepare(`SELECT * FROM skills WHERE domain = ?`),
  
  upsertSkill: db.prepare(`INSERT INTO skills (domain, root_domain, name, description, capabilities, proto, endpoint, schema_url, auth, cost, raw_record, status, first_verified, last_verified, last_checked)
    VALUES (@domain, @root_domain, @name, @description, @capabilities, @proto, @endpoint, @schema_url, @auth, @cost, @raw_record, @status, datetime('now'), datetime('now'), datetime('now'))
    ON CONFLICT(domain) DO UPDATE SET
      root_domain = excluded.root_domain,
      name = excluded.name,
      description = excluded.description,
      capabilities = excluded.capabilities,
      proto = excluded.proto,
      endpoint = excluded.endpoint,
      schema_url = excluded.schema_url,
      auth = excluded.auth,
      cost = excluded.cost,
      raw_record = excluded.raw_record,
      status = excluded.status,
      last_verified = CASE WHEN excluded.status = 'active' THEN datetime('now') ELSE last_verified END,
      last_checked = datetime('now'),
      first_verified = CASE WHEN first_verified IS NULL AND excluded.status = 'active' THEN datetime('now') ELSE first_verified END`),
  
  updateChecked: db.prepare(`UPDATE skills SET last_checked = datetime('now'), status = ? WHERE domain = ?`),
  
  getPendingAndActive: db.prepare(`SELECT domain FROM skills WHERE status IN ('active', 'pending')`),
  
  stats: db.prepare(`SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
  FROM skills`),

  getSkillsByRootDomain: db.prepare(`SELECT * FROM skills WHERE root_domain = ? AND status = 'active' ORDER BY first_verified DESC`)
};

module.exports = { db, queries, skillQueries, deriveCategory, extractRootDomain, CATEGORIES };
