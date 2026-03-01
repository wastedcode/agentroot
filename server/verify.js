const { lookupAgent } = require('./dns');
const { queries, deriveCategory, extractRootDomain } = require('./db');

let lastRun = null;

async function verifyDomain(domain) {
  const result = await lookupAgent(domain);
  
  if (result) {
    const { parsed, raw } = result;
    queries.upsertAgent.run({
      domain,
      root_domain: extractRootDomain(domain),
      name: parsed.name || null,
      description: parsed.desc || null,
      capabilities: parsed.caps || null,
      endpoint: parsed.endpoint || null,
      protocol: parsed.proto || null,
      card_url: parsed.card || null,
      raw_record: raw,
      status: 'active',
      category: deriveCategory(parsed.caps)
    });
    queries.logVerification.run(domain, 'verified', raw);
    return { success: true, status: 'active', parsed, raw };
  } else {
    queries.updateChecked.run('failed', domain);
    queries.logVerification.run(domain, 'failed', null);
    return { success: false, status: 'failed' };
  }
}

async function runVerificationCycle() {
  console.log('[verify] Starting verification cycle...');
  const domains = queries.getPendingAndActive.all();
  let verified = 0, failed = 0;
  
  for (const { domain } of domains) {
    const r = await verifyDomain(domain);
    if (r.success) verified++;
    else failed++;
    // small delay to avoid hammering DNS
    await new Promise(r => setTimeout(r, 200));
  }
  
  lastRun = new Date().toISOString();
  console.log(`[verify] Cycle complete: ${verified} verified, ${failed} failed`);
  return { verified, failed, lastRun };
}

function startVerificationCron() {
  // Run once at startup (after a short delay)
  setTimeout(runVerificationCycle, 5000);
  // Then every 6 hours
  setInterval(runVerificationCycle, 6 * 60 * 60 * 1000);
}

function getLastRun() {
  return lastRun;
}

module.exports = { verifyDomain, runVerificationCycle, startVerificationCron, getLastRun };
