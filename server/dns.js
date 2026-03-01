const dns = require('dns').promises;

function parseTxtRecord(raw) {
  const parsed = {};
  raw.match(/(\w+)=((?:[^\s\\]|\\.)+)/g)?.forEach(pair => {
    const eqIdx = pair.indexOf('=');
    const k = pair.substring(0, eqIdx);
    const v = pair.substring(eqIdx + 1).replace(/\\ /g, ' ');
    parsed[k] = v;
  });
  return parsed;
}

async function lookupAgent(domain) {
  try {
    const records = await dns.resolveTxt(`_agent.${domain}`);
    const raw = records.map(r => r.join('')).find(r => r.startsWith('v=agent1'));
    if (!raw) return null;
    return { raw, parsed: parseTxtRecord(raw) };
  } catch (e) {
    return null;
  }
}

async function lookupSkill(domain) {
  try {
    const records = await dns.resolveTxt(`_skill.${domain}`);
    const raw = records.map(r => r.join('')).find(r => r.startsWith('v=skill1'));
    if (!raw) return null;
    return { raw, parsed: parseTxtRecord(raw) };
  } catch (e) {
    return null;
  }
}

// Look up both _agent and _skill records for a domain
async function lookupBoth(domain) {
  const [agent, skill] = await Promise.allSettled([
    lookupAgent(domain),
    lookupSkill(domain)
  ]);
  return {
    agent: agent.status === 'fulfilled' ? agent.value : null,
    skill: skill.status === 'fulfilled' ? skill.value : null
  };
}

module.exports = { lookupAgent, lookupSkill, lookupBoth };
