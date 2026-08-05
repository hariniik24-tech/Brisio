const express = require('express');
const Database = require('better-sqlite3');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const dbDir = path.join(__dirname, 'db');
fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(path.join(dbDir, 'commonground.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL CHECK(type IN ('supply','demand')),
    category    TEXT NOT NULL,
    businessName TEXT NOT NULL,
    description TEXT NOT NULL,
    contact     TEXT DEFAULT '',
    location    TEXT DEFAULT '',
    urgent      INTEGER DEFAULT 0,
    active      INTEGER DEFAULT 1,
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS engagements (
    id              TEXT PRIMARY KEY,
    listingId       TEXT NOT NULL,
    listingOwnerId  TEXT NOT NULL,
    requesterUserId TEXT NOT NULL,
    status          TEXT NOT NULL CHECK(status IN ('requested','accepted','preparing','on_the_way','delivered','completed','declined','cancelled')),
    createdAt       TEXT NOT NULL,
    updatedAt       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS engagement_messages (
    id            TEXT PRIMARY KEY,
    engagementId  TEXT NOT NULL,
    senderUserId  TEXT NOT NULL,
    senderName    TEXT NOT NULL,
    body          TEXT NOT NULL,
    etaNote       TEXT DEFAULT '',
    locationNote  TEXT DEFAULT '',
    createdAt     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reports (
    id          TEXT PRIMARY KEY,
    listingId   TEXT DEFAULT '',
    reporterName TEXT NOT NULL,
    reason      TEXT NOT NULL,
    details     TEXT DEFAULT '',
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    passwordHash    TEXT NOT NULL,
    role            TEXT NOT NULL CHECK(role IN ('business','organization','admin')),
    displayName     TEXT NOT NULL,
    organizationName TEXT DEFAULT '',
    location        TEXT DEFAULT '',
    createdAt       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    userId       TEXT NOT NULL,
    createdAt    TEXT NOT NULL,
    expiresAt    TEXT NOT NULL
  );
`);

function ensureColumn(tableName, columnName, definitionSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
  }
}

ensureColumn('listings', 'ownerUserId', 'TEXT DEFAULT \'\'');
ensureColumn('listings', 'deliverWithinHours', 'INTEGER');
ensureColumn('listings', 'offerClosesAt', 'TEXT DEFAULT \'\'');
ensureColumn('listings', 'urgencyLevel', 'TEXT DEFAULT \'normal\'');
ensureColumn('listings', 'isPrivate', 'INTEGER DEFAULT 0');
ensureColumn('listings', 'targetOrganizationId', 'TEXT DEFAULT \'\'');
ensureColumn('listings', 'resourceName', 'TEXT DEFAULT \'\'');
ensureColumn('listings', 'resourceType', 'TEXT DEFAULT \'\'');
ensureColumn('listings', 'quantity', 'TEXT DEFAULT \'\'');
ensureColumn('listings', 'availabilityNotes', 'TEXT DEFAULT \'\'');

const ENGAGEMENT_STATUSES = ['requested', 'accepted', 'preparing', 'on_the_way', 'delivered', 'completed', 'declined', 'cancelled'];

const existingCount = db.prepare('SELECT COUNT(*) AS c FROM listings').get().c;
if (existingCount === 0) {
  const now = new Date().toISOString();
  const seedListings = [
    {
      id: crypto.randomUUID(),
      type: 'supply',
      category: 'food',
      businessName: 'Roast & Share Cafe',
      description: 'Extra baked goods and coffee beans available for community meals this afternoon.',
      contact: 'hello@roastshare.example',
      location: 'Downtown',
      urgent: 1,
      active: 1,
      createdAt: now,
      updatedAt: now
    },
    {
      id: crypto.randomUUID(),
      type: 'supply',
      category: 'space',
      businessName: 'Green Workshop Studio',
      description: 'Available event space for organization meetings on weekday afternoons.',
      contact: 'events@greenstudio.example',
      location: 'Midtown',
      urgent: 0,
      active: 1,
      createdAt: now,
      updatedAt: now
    },
    {
      id: crypto.randomUUID(),
      type: 'demand',
      category: 'service',
      businessName: 'Eastside Youth Center',
      description: 'Looking for pro bono legal advice for a volunteer-led education program.',
      contact: 'info@eastside.example',
      location: 'Eastside',
      urgent: 0,
      active: 1,
      createdAt: now,
      updatedAt: now
    },
    {
      id: crypto.randomUUID(),
      type: 'demand',
      category: 'equipment',
      businessName: 'Community Makerspace',
      description: 'Need projectors and audio equipment for an upcoming free workshop.',
      contact: 'connect@makerspace.example',
      location: 'North End',
      urgent: 1,
      active: 1,
      createdAt: now,
      updatedAt: now
    }
  ];

  const insert = db.prepare(`
    INSERT INTO listings (id, type, category, businessName, description, contact, location, urgent, active, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      insert.run(item.id, item.type, item.category, item.businessName, item.description, item.contact, item.location, item.urgent, item.active, item.createdAt, item.updatedAt);
    }
  });
  insertMany(seedListings);
}

const CATEGORY_KEYWORDS = {
  space: ['space', 'room', 'venue', 'area', 'location', 'office', 'studio', 'hall', 'floor', 'building', 'desk', 'cowork'],
  time: ['time', 'hours', 'schedule', 'slot', 'availability', 'booking', 'appointment', 'shift', 'session'],
  equipment: ['equipment', 'tools', 'machinery', 'gear', 'supplies', 'device', 'machine', 'printer', 'computer', 'vehicle', 'camera'],
  service: ['service', 'skill', 'help', 'professional', 'support', 'consult', 'training', 'teach', 'coaching', 'advice', 'legal', 'accounting'],
  food: ['food', 'inventory', 'meals', 'catering', 'surplus', 'produce', 'baked', 'groceries', 'ingredients', 'supply'],
  other: ['other', 'general', 'misc', 'resource', 'capacity']
};

const URGENCY_WORDS = ['now', 'free', 'available today', 'urgent', 'immediately', 'asap', 'today', 'tonight', 'this week', 'limited time'];
const STOP_WORDS = new Set(['a','an','the','and','or','but','in','on','at','to','for','of','with','by','is','are','was','were','be','have','has','do','does','i','we','you','they','it','this','that','these','those','my','our','your','their','its','can','will','need','want','looking']);

// Redact emails and phone numbers from text
function redactSensitive(text) {
  if (!text) return text;
  let out = String(text);
  // redact emails
  out = out.replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+)\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
  // redact simple phone numbers
  out = out.replace(/\+?\d[\d\s().-]{6,}\d/g, '[REDACTED_PHONE]');
  return out;
}

function appendInstrumentation(entry) {
  try {
    const file = path.join(dbDir, 'server-instrumentation.txt');
    fs.appendFileSync(file, `\n===== ${new Date().toISOString()} =====\n` + JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) { console.error('instrumentation write failed', e); }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedValue) {
  const [salt, expectedHash] = String(storedValue || '').split(':');
  if (!salt || !expectedHash) return false;
  const calculatedHash = crypto.scryptSync(password, salt, 64).toString('hex');
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(calculatedHash, 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function issueSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  db.prepare('INSERT INTO sessions (token, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)').run(token, userId, createdAt, expiresAt);
  return token;
}

function authTokenFromRequest(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

function getUserFromRequest(req) {
  const token = authTokenFromRequest(req);
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return db.prepare('SELECT id, email, role, displayName, organizationName, location, createdAt FROM users WHERE id = ?').get(session.userId) || null;
}

function requireAuth(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Sign in required' });
  }
  req.user = user;
  next();
}

function normalizeLocation(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function locationSimilarityScore(requestedLocation, listingLocation) {
  const requested = normalizeLocation(requestedLocation);
  const listing = normalizeLocation(listingLocation);
  if (!requested || !listing) return 0;
  if (requested === listing) return 24;
  if (listing.includes(requested) || requested.includes(listing)) return 16;
  const requestedTokens = requested.split(' ');
  const listingTokens = listing.split(' ');
  const overlap = requestedTokens.filter((token) => token && listingTokens.includes(token)).length;
  return Math.min(12, overlap * 4);
}

function isListingExpired(listing) {
  if (!listing.offerClosesAt) return false;
  const closingTimestamp = new Date(listing.offerClosesAt).getTime();
  if (!Number.isFinite(closingTimestamp)) return false;
  return closingTimestamp < Date.now();
}

function isListingVisibleToUser(listing, user) {
  if (listing.isPrivate !== 1) return true;
  if (!user) return false;
  return listing.ownerUserId === user.id || listing.targetOrganizationId === user.id;
}

function getVisibleActiveListings(user) {
  const listings = db.prepare('SELECT * FROM listings WHERE active = 1 ORDER BY createdAt DESC').all();
  return listings.filter((listing) => isListingVisibleToUser(listing, user) && !isListingExpired(listing));
}

function canAccessEngagement(engagement, user) {
  if (!engagement || !user) return false;
  return engagement.listingOwnerId === user.id || engagement.requesterUserId === user.id;
}

function getEngagementById(id) {
  return db.prepare(`
    SELECT
      e.*,
      l.businessName,
      l.category,
      l.type,
      l.description,
      l.contact,
      l.location,
      l.deliverWithinHours,
      l.offerClosesAt,
      l.urgencyLevel,
      l.isPrivate,
      l.resourceName,
      l.resourceType,
      l.quantity,
      l.availabilityNotes,
      owner.displayName AS ownerDisplayName,
      owner.organizationName AS ownerOrganizationName,
      requester.displayName AS requesterDisplayName,
      requester.organizationName AS requesterOrganizationName
    FROM engagements e
    JOIN listings l ON l.id = e.listingId
    JOIN users owner ON owner.id = e.listingOwnerId
    JOIN users requester ON requester.id = e.requesterUserId
    WHERE e.id = ?
  `).get(id);
}

function getEngagementMessages(engagementId) {
  return db.prepare(`
    SELECT id, engagementId, senderUserId, senderName, body, etaNote, locationNote, createdAt
    FROM engagement_messages
    WHERE engagementId = ?
    ORDER BY createdAt ASC
  `).all(engagementId);
}

function getEngagementsForUser(user) {
  const rows = db.prepare(`
    SELECT
      e.*,
      l.businessName,
      l.category,
      l.type,
      l.description,
      l.contact,
      l.location,
      l.deliverWithinHours,
      l.offerClosesAt,
      l.urgencyLevel,
      l.isPrivate,
      l.resourceName,
      l.resourceType,
      l.quantity,
      l.availabilityNotes,
      owner.displayName AS ownerDisplayName,
      owner.organizationName AS ownerOrganizationName,
      requester.displayName AS requesterDisplayName,
      requester.organizationName AS requesterOrganizationName
    FROM engagements e
    JOIN listings l ON l.id = e.listingId
    JOIN users owner ON owner.id = e.listingOwnerId
    JOIN users requester ON requester.id = e.requesterUserId
    WHERE e.listingOwnerId = ? OR e.requesterUserId = ?
    ORDER BY e.updatedAt DESC
  `).all(user.id, user.id);

  return rows.map((row) => ({
    ...row,
    messages: getEngagementMessages(row.id)
  }));
}

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function detectCategory(text) {
  const tokens = tokenize(text);
  let best = { category: 'other', score: 0 };
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = tokens.includes(category) ? 8 : 0;
    for (const word of words) {
      if (tokens.includes(word)) score += 2;
    }
    if (score > best.score) {
      best = { category, score };
    }
  }
  return best.category;
}

function extractKeyTokens(text, limit = 3) {
  const counts = {};
  tokenize(text).forEach((t) => {
    counts[t] = (counts[t] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

function createMatchExplanation(supply, demand, breakdown) {
  const reasons = [];
  if (supply.category === demand.category) {
    reasons.push(`both are in ${supply.category}`);
  }
  const overlap = breakdown.find((item) => item.rule.startsWith('Keyword overlap'));
  if (overlap) {
    reasons.push(`they share keywords: ${overlap.rule.replace('Keyword overlap (', '').replace(')', '')}`);
  }
  if (breakdown.some((item) => item.rule === 'Related category')) {
    reasons.push('they have related resource keywords');
  }
  if (breakdown.some((item) => item.rule === 'Urgency indicator')) {
    reasons.push('the offer is currently available or urgent');
  }
  if (reasons.length === 0) {
    reasons.push('the listing text contains matching resource terms');
  }
  return `This is a strong match because ${supply.businessName} offers ${supply.description} while ${demand.businessName} needs ${demand.description}. ${reasons.join('; ')}.`;
}

function generateBusinessSuggestions(description, category) {
  const text = (description || '').toLowerCase();
  const suggestions = [];
  const whenMatch = text.match(/\b(afternoon|evening|morning|weekend|weekday|tonight|today|tomorrow)\b/);
  const whenText = whenMatch ? whenMatch[1] : null;

  if (category === 'space') {
    suggestions.push('Offer workshop, study space, or community meeting space during slower hours.');
    suggestions.push('Highlight available seating, tables, and quiet room access for organization events.');
  } else if (category === 'time') {
    suggestions.push('Offer volunteer support hours, mentoring sessions, or training appointments.');
    suggestions.push('Share your schedule for off-peak availability and community help.');
  } else if (category === 'equipment') {
    suggestions.push('Offer projectors, AV gear, or event tools for community programs.');
    suggestions.push('Share equipment availability for student groups, workshops, or pop-up events.');
  } else if (category === 'service') {
    suggestions.push('Offer pro bono advising, coaching, or skill-building sessions.');
    suggestions.push('List services that help organizations, schools, or community groups.');
  } else if (category === 'food') {
    suggestions.push('Offer surplus meals, pantry items, or catering support for local groups.');
    suggestions.push('Share food availability with community kitchens and outreach programs.');
  } else {
    suggestions.push('Share what you have and how it could support local groups or events.');
    suggestions.push('Offer flexibility on timing or capacity to increase match possibilities.');
  }

  if (whenText) {
    suggestions.push(`Promote availability during ${whenText} to align with community need.`);
  }
  if (text.includes('slow') || text.includes('off-peak') || text.includes('available')) {
    suggestions.push('Use slow or off-peak hours as a community offering.');
  }

  return suggestions;
}

function scoreMatch(supply, demand) {
  let score = 0;
  const breakdown = [];
  const supplyTokens = tokenize(supply.description + ' ' + supply.category + ' ' + supply.businessName);
  const demandTokens = tokenize(demand.description + ' ' + demand.category + ' ' + demand.businessName);
  const supplyText = (supply.description + ' ' + supply.category).toLowerCase();

  if (supply.category === demand.category) {
    score += 50;
    breakdown.push({ rule: 'Category match', points: 50 });
  } else {
    const catWords = CATEGORY_KEYWORDS[supply.category] || [];
    const demandText = demand.description.toLowerCase();
    const partialHit = catWords.some((word) => demandText.includes(word));
    if (partialHit) {
      score += 25;
      breakdown.push({ rule: 'Related category', points: 25 });
    }
  }

  const overlap = demandTokens.filter((token) => supplyTokens.includes(token));
  const kwPoints = overlap.length * 10;
  if (kwPoints > 0) {
    score += kwPoints;
    breakdown.push({ rule: `Keyword overlap (${overlap.slice(0, 5).join(', ')})`, points: kwPoints });
  }

  score += 15;
  breakdown.push({ rule: 'Supply priority boost', points: 15 });

  const hasUrgency = URGENCY_WORDS.some((word) => supplyText.includes(word));
  if (hasUrgency) {
    score += 10;
    breakdown.push({ rule: 'Urgency indicator', points: 10 });
  }

  if (supply.location && demand.location && supply.location.toLowerCase().includes(demand.location.toLowerCase().split(',')[0])) {
    score += 10;
    breakdown.push({ rule: 'Location match', points: 10 });
  }

  const explanation = createMatchExplanation(supply, demand, breakdown);
  return { score, breakdown, explanation };
}

function searchScore(item, queryTokens) {
  let score = 0;
  const breakdown = [];
  const itemText = (item.description + ' ' + item.category + ' ' + item.businessName).toLowerCase();
  const itemTokens = tokenize(itemText);

  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    const hit = queryTokens.some((token) => words.includes(token) || token === category);
    if (hit && item.category === category) {
      score += 50;
      breakdown.push({ rule: 'Category match', points: 50 });
      break;
    }
  }

  const overlap = queryTokens.filter((token) => itemTokens.includes(token));
  const kwPoints = overlap.length * 10;
  if (kwPoints > 0) {
    score += kwPoints;
    breakdown.push({ rule: `Keywords: ${overlap.slice(0, 4).join(', ')}`, points: kwPoints });
  }

  if (item.type === 'supply') {
    score += 15;
    breakdown.push({ rule: 'Supply priority', points: 15 });
  }

  if (URGENCY_WORDS.some((word) => itemText.includes(word))) {
    score += 10;
    breakdown.push({ rule: 'Urgency', points: 10 });
  }

  return { score, breakdown, explanation: `Matches your request because it is categorized as ${item.category} and mentions ${extractKeyTokens(item.description).join(', ') || 'community support'}.` };
}

function summarizeBreakdown(breakdown, limit = 2) {
  if (!Array.isArray(breakdown) || breakdown.length === 0) {
    return 'baseline relevance';
  }
  return breakdown
    .slice(0, limit)
    .map((item) => item.rule)
    .join(', ');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function confidenceFromScore(score, rank = 1, total = 1) {
  const normalized = Number.isFinite(score) ? score : 0;
  const base = (normalized / 180) * 100;
  const rankPenalty = Math.max(0, (rank - 1) * 5);
  const competitionPenalty = total > 4 ? Math.min(8, (total - 4) * 1.2) : 0;
  return clamp(Math.round(base - rankPenalty - competitionPenalty), 28, 91);
}

function getRecommendationEvidence(match, rank, total) {
  const details = match.matchStats && Array.isArray(match.matchStats.breakdown)
    ? match.matchStats.breakdown
    : Array.isArray(match.breakdown)
    ? match.breakdown
    : [];
  const score = Number.isFinite(match.score) ? match.score : (match.matchStats ? match.matchStats.score : 0);
  const keywordEntry = details.find((item) => item.rule.startsWith('Keyword overlap') || item.rule.startsWith('Keywords:'));
  let sharedKeywords = 0;
  if (keywordEntry) {
    const rule = keywordEntry.rule;
    if (rule.includes('(') && rule.includes(')')) {
      const inside = rule.split('(')[1].split(')')[0] || '';
      sharedKeywords = inside.split(',').map((t) => t.trim()).filter(Boolean).length;
    } else if (rule.includes(':')) {
      const right = rule.split(':')[1] || '';
      sharedKeywords = right.split(',').map((t) => t.trim()).filter(Boolean).length;
    }
  }
  const categoryAligned = details.some((item) => item.rule === 'Category match');
  const relatedCategory = details.some((item) => item.rule === 'Related category');
  const urgencyMatched = details.some((item) => item.rule === 'Urgency indicator' || item.rule === 'Urgency');
  const locationMatched = details.some((item) => item.rule === 'Location match');

  const fitText = categoryAligned
    ? 'it is in the same category as your request'
    : relatedCategory
    ? 'it is in a closely related category'
    : 'it still matches the request context';
  const summaryParts = [
    `it is ranked ${rank} out of ${total}`,
    `${sharedKeywords} shared keyword${sharedKeywords === 1 ? '' : 's'}`,
    fitText
  ];
  if (urgencyMatched) summaryParts.push('the timing looks urgent/available now');
  if (locationMatched) summaryParts.push('the location is aligned');

  return {
    rank,
    total,
    confidence: confidenceFromScore(score, rank, total),
    sharedKeywords,
    categoryAligned,
    relatedCategory,
    urgencyMatched,
    locationMatched,
    factors: summarizeBreakdown(details, 3),
    summary: `Best because ${summaryParts.join(', ')}.`
  };
}

function inferUserIntent(text) {
  const normalized = (text || '').toLowerCase();
  const needPatterns = /\b(i need|we need|need|needed|looking for|look for|want|seeking|request|requesting|ask for|help|support|assist|find|searching)\b/;
  const offerPatterns = /\b(i have|we have|have|offer|available|available to|share|donate|give|spare|extra|can provide|can help|free|open)\b/;
  const recommendPatterns = /\b(recommend|suggest|any ideas|any recommendations|what should|best match|show me|find.*match|find.*resource)\b/;
  const hasNeed = needPatterns.test(normalized);
  const hasOffer = offerPatterns.test(normalized);
  const hasRecommend = recommendPatterns.test(normalized);
  const hasUrgency = /\b(now|today|urgent|asap|tomorrow|soon|this week|tonight)\b/.test(normalized);

  let category = 'other';
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (normalized.includes(cat) || words.some((word) => normalized.includes(word))) {
      category = cat;
      break;
    }
  }

  const type = hasRecommend && !hasNeed && !hasOffer
    ? 'explore'
    : hasNeed && !hasOffer
    ? 'need'
    : hasOffer && !hasNeed
    ? 'offer'
    : 'explore';

  return {
    type,
    category,
    urgency: hasUrgency
  };
}

function generatePersonalizedRecommendations(input, listings, role = 'member') {
  const activeListings = listings.filter((item) => item.active !== 0);
  const normalizedInput = (input || '').trim();
  const intent = inferUserIntent(normalizedInput);
  const tokens = tokenize(normalizedInput);
  const roleLabel = role === 'admin' ? 'admin' : role === 'organization' ? 'organization' : role === 'business' ? 'business' : 'community';

  const scoredListings = activeListings
    .map((item) => {
      const itemText = `${item.businessName} ${item.description} ${item.category} ${item.location}`.toLowerCase();
      let score = 0;
      const overlap = tokens.filter((token) => itemText.includes(token));
      if (intent.category !== 'other' && item.category === intent.category) score += 45;
      score += overlap.length * 10;
      if (item.type === 'supply' && intent.type === 'need') score += 15;
      if (item.type === 'demand' && intent.type === 'offer') score += 15;
      if (item.urgent === 1) score += 8;
      // derive a more detailed breakdown using searchScore
      const searchInfo = searchScore(item, tokens);
      const matchStats = {
        score: score + (searchInfo.score || 0),
        breakdown: searchInfo.breakdown || [],
        explanation: searchInfo.explanation || ''
      };
      return { ...item, score: matchStats.score, overlap, matchStats };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const rankedListings = scoredListings.map((item, index) => ({
    ...item,
    confidence: confidenceFromScore(item.score, index + 1, scoredListings.length)
  }));

  const matches = rankedListings.slice(0, 4);
  const tips = [];
  const actions = [];

  if (matches.length) {
    const topMatch = matches[0];
    const evidence = getRecommendationEvidence(topMatch, 1, rankedListings.length);
    actions.push({
      title: `Top recommendation: ${topMatch.businessName}`,
      reason: `Why this is better: ${evidence.summary}.`,
      action: `Choose this option first because its strongest signals are ${evidence.factors}.`,
      confidence: evidence.confidence,
      evidence: evidence.summary
    });
  }

  if (!normalizedInput) {
    actions.push({
      title: 'Start by browsing live listings',
      reason: 'The board is freshest when you search for a category or nearby need.',
      action: 'Try a search like “meeting room” or “food surplus” to see what is already available.'
    });
  } else if (intent.type === 'need') {
    actions.push({
      title: 'Make the request concrete',
      reason: 'Specific requests get faster responses.',
      action: 'Mention the exact resource, timing, and preferred location in your next post.'
    });
    actions.push({
      title: 'Browse matching offers',
      reason: 'The best opportunities often appear in the same category as your ask.',
      action: 'Open the best-fit listings and reach out with a short note explaining why they fit.'
    });
    if (intent.category !== 'other') {
      tips.push({
        title: `Focus on ${intent.category}`,
        text: `Framing your request around ${intent.category} makes it easier for the network to match it quickly.`
      });
    }
  } else if (intent.type === 'offer') {
    actions.push({
      title: 'Make the offer easier to discover',
      reason: 'Clear details help partners act quickly.',
      action: 'Add availability, quantity, and a neighborhood so the post feels immediate and actionable.'
    });
    actions.push({
      title: 'Pair your offer with a request',
      reason: 'A strong offer becomes more useful when paired with a nearby need.',
      action: 'Use the matching panel to find requests that align with your resource.'
    });
    if (intent.category !== 'other') {
      tips.push({
        title: `Position it as ${intent.category}`,
        text: `A clear ${intent.category} label helps the board surface your post to the right people.`
      });
    }
  } else {
    actions.push({
      title: 'Explore nearby opportunities',
      reason: 'The board learns from both offers and requests.',
      action: 'Browse live listings and look for a category that feels useful to your community.'
    });
  }

  if (intent.urgency) {
    tips.push({
      title: 'Flag urgency clearly',
      text: 'Urgent needs tend to attract faster attention, especially when the timing is explicit.'
    });
  }

  activeListings.slice(0, 3).forEach((item) => {
    const text = `${item.description} ${item.location || ''}`.toLowerCase();
    if (!/(pickup|pick up|drop|hours|time|today|tomorrow|weekend|weekday|window|available)/.test(text)) {
      tips.push({
        title: item.businessName,
        text: 'Add a timing note or pickup window so the post feels more actionable.'
      });
    }
    if (!item.location) {
      tips.push({
        title: item.businessName,
        text: 'Mention the city or neighborhood so nearby partners can respond faster.'
      });
    }
  });

  const summary = normalizedInput
    ? `You seem to be ${intent.type === 'need' ? 'looking for support' : intent.type === 'offer' ? 'sharing something useful' : 'exploring options'}${intent.category !== 'other' ? ` in the ${intent.category} space` : ''}. The board currently has ${activeListings.length} live listings, and ${scoredListings.length} statistically relevant candidates for your prompt.`
    : `The board currently has ${activeListings.length} live listings. You can use the AI assistant to shape a request, refine an offer, or discover a stronger next move.`;

  return {
    summary,
    role: roleLabel,
    intent,
    actions: actions.slice(0, 4),
    tips: tips.slice(0, 5),
    matches
  };
}

function buildAIInsights(listings, role = 'member') {
  const activeListings = listings.filter((item) => item.active !== 0);
  const supply = activeListings.filter((item) => item.type === 'supply');
  const demand = activeListings.filter((item) => item.type === 'demand');
  const urgent = activeListings.filter((item) => item.urgent === 1);
  const roleLabel = role === 'admin' ? 'admin' : role === 'organization' ? 'organization' : role === 'business' ? 'business' : 'community';

  const summaryParts = [];
  summaryParts.push(`There are ${activeListings.length} live listings in the network.`);
  if (supply.length && demand.length) summaryParts.push(`${supply.length} offers and ${demand.length} requests are ready to connect.`);
  else if (supply.length) summaryParts.push(`${supply.length} offers are available for outreach.`);
  else if (demand.length) summaryParts.push(`${demand.length} requests need a quick response.`);
  if (urgent.length) summaryParts.push(`${urgent.length} posts are marked urgent.`);

  const recommendations = [];
  if (supply.length && demand.length) {
    const balance = 1 - Math.abs(supply.length - demand.length) / (supply.length + demand.length);
    const matchConfidence = clamp(Math.round((balance * 0.6 + Math.min(activeListings.length, 12) / 12 * 0.4) * 100), 42, 88);
    recommendations.push({
      title: 'Best match opportunity',
      reason: 'The current mix looks strong enough for a fast local match.',
      action: 'Review the newest offer and request pair and reach out with a short intro.',
      priority: 'high',
      confidence: matchConfidence,
      evidence: `${supply.length} offers vs ${demand.length} requests gives a balanced pool for matching.`
    });
  }

  if (urgent.length) {
    const urgentRatio = activeListings.length ? urgent.length / activeListings.length : 0;
    recommendations.push({
      title: 'Prioritize urgent posts',
      reason: 'Urgent items tend to create the most immediate impact.',
      action: 'Flag urgent listings for quick outreach or pickup planning.',
      priority: 'high',
      confidence: clamp(Math.round((0.43 + Math.min(urgentRatio, 0.45)) * 100), 48, 86),
      evidence: `${urgent.length} of ${activeListings.length} active listings are marked urgent.`
    });
  }

  if (roleLabel === 'business') {
    recommendations.push({
      title: 'Make your offer easier to match',
      reason: 'Specific offers attract better responses.',
      action: 'Add pickup time, quantity, and a neighborhood to your next post.',
      priority: 'medium',
      confidence: clamp(58 + Math.min(supply.length * 2, 16), 58, 84),
      evidence: `${supply.length} active offers are competing for attention; detailed posts rank higher.`
    });
  } else if (roleLabel === 'organization') {
    recommendations.push({
      title: 'Sharpen the request',
      reason: 'Clearer requests lead to faster help.',
      action: 'Mention the exact item, urgency, and preferred pickup window.',
      priority: 'medium',
      confidence: clamp(58 + Math.min(demand.length * 2, 16), 58, 84),
      evidence: `${demand.length} active requests are live; specific wording improves matching confidence.`
    });
  } else {
    recommendations.push({
      title: 'Invite a new partner',
      reason: 'More listings create more matches and less waste.',
      action: 'Invite one nearby business or organization to post a resource today.',
      priority: 'medium',
      confidence: clamp(54 + Math.min(activeListings.length * 2, 18), 54, 82),
      evidence: `${activeListings.length} active listings currently define the local match network size.`
    });
  }

  if (activeListings.length < 8) {
    recommendations.push({
      title: 'Grow the network',
      reason: 'A fuller feed makes matching easier.',
      action: 'Share the link with another local group and encourage one more listing.',
      priority: 'medium',
      confidence: clamp(82 - activeListings.length * 3, 58, 82),
      evidence: `Only ${activeListings.length} live listings are available; increasing volume improves coverage.`
    });
  }

  const improvements = [];
  activeListings.slice(0, 4).forEach((item) => {
    const text = `${item.description} ${item.location || ''}`.toLowerCase();
    if (!/(pickup|pick up|drop|hours|time|today|tomorrow|weekend|weekday|window|available)/.test(text)) {
      improvements.push({
        title: item.businessName,
        tip: 'Add a pickup window or timing note to make this easier to match.'
      });
    }
    if (!item.location) {
      improvements.push({
        title: item.businessName,
        tip: 'Mention the neighborhood or city so nearby partners can respond faster.'
      });
    }
    if (!/(quantity|amount|many|several|boxes|people|seats|hours)/.test(text)) {
      improvements.push({
        title: item.businessName,
        tip: 'Mention quantity or capacity so the request feels concrete and actionable.'
      });
    }
  });

  return {
    summary: summaryParts.join(' '),
    recommendations: recommendations.slice(0, 4),
    improvements: improvements.slice(0, 4),
    role: roleLabel
  };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 60_000, max: 120, message: { error: 'Too many requests, slow down.' } });
app.use('/api/', limiter);

app.post('/api/auth/register', (req, res) => {
  const { email, password, role, name, organizationName, location } = req.body;
  if (!email || !password || !role || !name) {
    return res.status(400).json({ success: false, error: 'email, password, role, and name are required' });
  }
  if (!['business', 'organization'].includes(role)) {
    return res.status(400).json({ success: false, error: 'role must be business or organization' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ success: false, error: 'password must be at least 8 characters' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
  if (existing) {
    return res.status(409).json({ success: false, error: 'An account with this email already exists' });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const passwordHash = hashPassword(password);
  db.prepare(`
    INSERT INTO users (id, email, passwordHash, role, displayName, organizationName, location, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, String(email).trim(), passwordHash, role, String(name).trim(), String(organizationName || '').trim(), String(location || '').trim(), createdAt);
  const token = issueSession(id);
  const user = db.prepare('SELECT id, email, role, displayName, organizationName, location, createdAt FROM users WHERE id = ?').get(id);
  res.status(201).json({ success: true, token, user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email and password are required' });
  }
  const account = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
  if (!account || !verifyPassword(password, account.passwordHash)) {
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }
  const token = issueSession(account.id);
  const user = db.prepare('SELECT id, email, role, displayName, organizationName, location, createdAt FROM users WHERE id = ?').get(account.id);
  res.json({ success: true, token, user });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = authTokenFromRequest(req);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ success: true });
});

app.delete('/api/auth/account', requireAuth, (req, res) => {
  const userId = req.user.id;
  const user = db.prepare('SELECT id, displayName FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ success: false, error: 'Account not found' });
  }

  const userListings = db.prepare('SELECT id FROM listings WHERE ownerUserId = ?').all(userId).map((row) => row.id);
  const engagementIds = db.prepare(
    'SELECT id FROM engagements WHERE listingOwnerId = ? OR requesterUserId = ?'
  ).all(userId, userId).map((row) => row.id);

  const deleteAccount = db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE userId = ?').run(userId);

    if (engagementIds.length > 0) {
      const engagementPlaceholders = engagementIds.map(() => '?').join(', ');
      db.prepare(`DELETE FROM engagement_messages WHERE engagementId IN (${engagementPlaceholders})`).run(...engagementIds);
      db.prepare(`DELETE FROM engagements WHERE id IN (${engagementPlaceholders})`).run(...engagementIds);
    }

    if (userListings.length > 0) {
      const listingPlaceholders = userListings.map(() => '?').join(', ');
      db.prepare(`DELETE FROM reports WHERE listingId IN (${listingPlaceholders})`).run(...userListings);
      db.prepare(`DELETE FROM listings WHERE id IN (${listingPlaceholders})`).run(...userListings);
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  deleteAccount();

  const token = authTokenFromRequest(req);
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  res.json({ success: true, message: 'Account deleted' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.get('/api/organizations', requireAuth, (req, res) => {
  if (req.user.role !== 'business') {
    return res.status(403).json({ success: false, error: 'Only businesses can browse organization accounts for private offers' });
  }
  const organizations = db.prepare(`
    SELECT id, displayName, organizationName, location
    FROM users
    WHERE role = 'organization'
    ORDER BY createdAt DESC
  `).all();
  res.json({ success: true, organizations });
});

app.get('/api/listings', requireAuth, (req, res) => {
  const { type, category } = req.query;
  const rows = getVisibleActiveListings(req.user).filter((listing) => {
    if (type && listing.type !== type) return false;
    if (category && listing.category !== category) return false;
    return true;
  });
  res.json({ success: true, count: rows.length, listings: rows });
});

app.post('/api/listings', requireAuth, (req, res) => {
  const {
    category,
    description,
    contact,
    location,
    resourceName,
    resourceType,
    quantity,
    availabilityNotes,
    deliverWithinHours,
    offerClosesAt,
    urgencyLevel,
    isPrivate,
    targetOrganizationId
  } = req.body;
  if (!category || !description) {
    return res.status(400).json({ success: false, error: 'category and description are required' });
  }
  if (!Object.keys(CATEGORY_KEYWORDS).includes(category)) {
    return res.status(400).json({ success: false, error: `category must be one of: ${Object.keys(CATEGORY_KEYWORDS).join(', ')}` });
  }

  const userRole = req.user.role;
  if (!['business', 'organization'].includes(userRole)) {
    return res.status(403).json({ success: false, error: 'Only business and organization users can create listings' });
  }

  const type = userRole === 'business' ? 'supply' : 'demand';
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const detectedCategory = detectCategory(`${req.user.organizationName} ${description}`);
  const finalCategory = category === 'other' ? detectedCategory : category;

  const parsedDeliveryHours = deliverWithinHours === undefined || deliverWithinHours === ''
    ? null
    : Number.parseInt(deliverWithinHours, 10);
  if (parsedDeliveryHours !== null && (!Number.isInteger(parsedDeliveryHours) || parsedDeliveryHours < 0)) {
    return res.status(400).json({ success: false, error: 'deliverWithinHours must be a non-negative integer' });
  }

  const normalizedClosesAt = String(offerClosesAt || '').trim();
  if (normalizedClosesAt) {
    const closeTs = new Date(normalizedClosesAt).getTime();
    if (!Number.isFinite(closeTs)) {
      return res.status(400).json({ success: false, error: 'offerClosesAt must be a valid datetime' });
    }
  }

  const urgency = String(urgencyLevel || '').toLowerCase();
  if (userRole === 'organization' && urgency && !['low', 'medium', 'high', 'critical'].includes(urgency)) {
    return res.status(400).json({ success: false, error: 'urgencyLevel must be low, medium, high, or critical' });
  }

  const privateFlag = isPrivate ? 1 : 0;
  if (privateFlag === 1 && userRole !== 'business') {
    return res.status(403).json({ success: false, error: 'Only businesses can create private offers' });
  }
  if (privateFlag === 1 && !targetOrganizationId) {
    return res.status(400).json({ success: false, error: 'targetOrganizationId is required for private offers' });
  }
  if (privateFlag === 1) {
    const target = db.prepare('SELECT id FROM users WHERE id = ? AND role = \'organization\'').get(targetOrganizationId);
    if (!target) return res.status(400).json({ success: false, error: 'targetOrganizationId must reference an organization account' });
  }

  const normalizedDescription = String(description).trim();
  const businessName = req.user.organizationName || req.user.displayName;
  const urgent = userRole === 'organization'
    ? Number(urgency === 'high' || urgency === 'critical')
    : Number(URGENCY_WORDS.some((word) => normalizedDescription.toLowerCase().includes(word)));

  db.prepare(`
    INSERT INTO listings (
      id, type, category, businessName, description, contact, location, urgent, active, createdAt, updatedAt,
      ownerUserId, deliverWithinHours, offerClosesAt, urgencyLevel, isPrivate, targetOrganizationId,
      resourceName, resourceType, quantity, availabilityNotes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    type,
    finalCategory,
    businessName,
    normalizedDescription,
    String(contact || '').trim(),
    String(location || req.user.location || '').trim(),
    urgent,
    now,
    now,
    req.user.id,
    parsedDeliveryHours,
    normalizedClosesAt,
    userRole === 'organization' ? (urgency || 'medium') : 'normal',
    privateFlag,
    privateFlag === 1 ? String(targetOrganizationId).trim() : '',
    String(resourceName || '').trim(),
    String(resourceType || '').trim(),
    String(quantity || '').trim(),
    String(availabilityNotes || '').trim()
  );

  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  const suggestions = type === 'supply' ? generateBusinessSuggestions(normalizedDescription, finalCategory) : [];
  res.status(201).json({ success: true, listing, detectedCategory, suggestions });
});

app.post('/api/private-offers', requireAuth, (req, res) => {
  if (req.user.role !== 'business') {
    return res.status(403).json({ success: false, error: 'Only businesses can create private offers' });
  }
  const { category, description, contact, location, resourceName, resourceType, quantity, availabilityNotes, deliverWithinHours, offerClosesAt, targetOrganizationId } = req.body;
  if (!category || !description || !targetOrganizationId) {
    return res.status(400).json({ success: false, error: 'category, description, and targetOrganizationId are required' });
  }
  if (!Object.keys(CATEGORY_KEYWORDS).includes(category)) {
    return res.status(400).json({ success: false, error: `category must be one of: ${Object.keys(CATEGORY_KEYWORDS).join(', ')}` });
  }
  const target = db.prepare('SELECT id FROM users WHERE id = ? AND role = \'organization\'').get(targetOrganizationId);
  if (!target) return res.status(400).json({ success: false, error: 'targetOrganizationId must reference an organization account' });
  const listingId = crypto.randomUUID();
  const now = new Date().toISOString();
  const parsedDeliveryHours = deliverWithinHours === undefined || deliverWithinHours === ''
    ? null
    : Number.parseInt(deliverWithinHours, 10);
  if (parsedDeliveryHours !== null && (!Number.isInteger(parsedDeliveryHours) || parsedDeliveryHours < 0)) {
    return res.status(400).json({ success: false, error: 'deliverWithinHours must be a non-negative integer' });
  }
  const closeAt = String(offerClosesAt || '').trim();
  if (closeAt) {
    const closeTs = new Date(closeAt).getTime();
    if (!Number.isFinite(closeTs)) {
      return res.status(400).json({ success: false, error: 'offerClosesAt must be a valid datetime' });
    }
  }
  db.prepare(`
    INSERT INTO listings (
      id, type, category, businessName, description, contact, location, urgent, active, createdAt, updatedAt,
      ownerUserId, deliverWithinHours, offerClosesAt, urgencyLevel, isPrivate, targetOrganizationId,
      resourceName, resourceType, quantity, availabilityNotes
    )
    VALUES (?, 'supply', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'normal', 1, ?, ?, ?, ?, ?)
  `).run(
    listingId,
    category,
    req.user.organizationName || req.user.displayName,
    String(description).trim(),
    String(contact || '').trim(),
    String(location || req.user.location || '').trim(),
    Number(URGENCY_WORDS.some((word) => String(description).toLowerCase().includes(word))),
    now,
    now,
    req.user.id,
    parsedDeliveryHours,
    closeAt,
    String(targetOrganizationId).trim(),
    String(resourceName || '').trim(),
    String(resourceType || '').trim(),
    String(quantity || '').trim(),
    String(availabilityNotes || '').trim()
  );
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);
  res.status(201).json({ success: true, listing });
});

app.get('/api/listings/:id', requireAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });
  if (!isListingVisibleToUser(listing, req.user)) {
    return res.status(403).json({ success: false, error: 'You cannot access this private listing' });
  }
  res.json({ success: true, listing });
});

app.patch('/api/listings/:id', requireAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });
  if (listing.ownerUserId && listing.ownerUserId !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Only the listing owner can update this listing' });
  }
  const allowed = ['description', 'contact', 'location', 'active', 'deliverWithinHours', 'offerClosesAt', 'urgencyLevel', 'resourceName', 'resourceType', 'quantity', 'availabilityNotes'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }
  updates.updatedAt = new Date().toISOString();
  const sets = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
  db.prepare(`UPDATE listings SET ${sets} WHERE id = ?`).run(...Object.values(updates), req.params.id);
  const updated = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  res.json({ success: true, listing: updated });
});

app.get('/api/engagements', requireAuth, (req, res) => {
  const engagements = getEngagementsForUser(req.user);
  res.json({ success: true, engagements });
});

app.post('/api/listings/:id/requests', requireAuth, (req, res) => {
  if (req.user.role !== 'organization') {
    return res.status(403).json({ success: false, error: 'Only organization accounts can request a business listing' });
  }
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });
  if (listing.type !== 'supply') {
    return res.status(400).json({ success: false, error: 'Only supply listings can be requested' });
  }
  if (!isListingVisibleToUser(listing, req.user)) {
    return res.status(403).json({ success: false, error: 'You cannot access this private listing' });
  }
  if (listing.ownerUserId === req.user.id) {
    return res.status(400).json({ success: false, error: 'You cannot request your own listing' });
  }

  const existing = db.prepare(`
    SELECT id, status
    FROM engagements
    WHERE listingId = ? AND requesterUserId = ? AND status NOT IN ('declined', 'cancelled', 'completed')
  `).get(listing.id, req.user.id);
  if (existing) {
    const engagement = getEngagementById(existing.id);
    return res.status(409).json({ success: false, error: 'You already have an active request for this listing', engagement });
  }

  const note = String(req.body.message || '').trim();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO engagements (id, listingId, listingOwnerId, requesterUserId, status, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 'requested', ?, ?)
  `).run(id, listing.id, listing.ownerUserId || '', req.user.id, now, now);

  const initialMessage = note || `We'd like to request this ${listing.category} listing.`;
  db.prepare(`
    INSERT INTO engagement_messages (id, engagementId, senderUserId, senderName, body, etaNote, locationNote, createdAt)
    VALUES (?, ?, ?, ?, ?, '', '', ?)
  `).run(crypto.randomUUID(), id, req.user.id, req.user.organizationName || req.user.displayName, initialMessage, now);

  const engagement = getEngagementById(id);
  res.status(201).json({ success: true, engagement: { ...engagement, messages: getEngagementMessages(id) } });
});

app.patch('/api/engagements/:id/status', requireAuth, (req, res) => {
  const engagement = getEngagementById(req.params.id);
  if (!engagement) return res.status(404).json({ success: false, error: 'Engagement not found' });
  if (!canAccessEngagement(engagement, req.user)) {
    return res.status(403).json({ success: false, error: 'You cannot update this engagement' });
  }

  const nextStatus = String(req.body.status || '').trim();
  if (!ENGAGEMENT_STATUSES.includes(nextStatus)) {
    return res.status(400).json({ success: false, error: `status must be one of: ${ENGAGEMENT_STATUSES.join(', ')}` });
  }

  db.prepare('UPDATE engagements SET status = ?, updatedAt = ? WHERE id = ?').run(nextStatus, new Date().toISOString(), engagement.id);

  if (req.body.note) {
    db.prepare(`
      INSERT INTO engagement_messages (id, engagementId, senderUserId, senderName, body, etaNote, locationNote, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      engagement.id,
      req.user.id,
      req.user.organizationName || req.user.displayName,
      String(req.body.note).trim(),
      String(req.body.etaNote || '').trim(),
      String(req.body.locationNote || '').trim(),
      new Date().toISOString()
    );
  }

  const updated = getEngagementById(engagement.id);
  res.json({ success: true, engagement: { ...updated, messages: getEngagementMessages(engagement.id) } });
});

app.post('/api/engagements/:id/messages', requireAuth, (req, res) => {
  const engagement = getEngagementById(req.params.id);
  if (!engagement) return res.status(404).json({ success: false, error: 'Engagement not found' });
  if (!canAccessEngagement(engagement, req.user)) {
    return res.status(403).json({ success: false, error: 'You cannot message on this engagement' });
  }

  const body = String(req.body.message || '').trim();
  const etaNote = String(req.body.etaNote || '').trim();
  const locationNote = String(req.body.locationNote || '').trim();
  if (!body) {
    return res.status(400).json({ success: false, error: 'message is required' });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO engagement_messages (id, engagementId, senderUserId, senderName, body, etaNote, locationNote, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, engagement.id, req.user.id, req.user.organizationName || req.user.displayName, body, etaNote, locationNote, now);
  db.prepare('UPDATE engagements SET updatedAt = ? WHERE id = ?').run(now, engagement.id);

  const message = db.prepare('SELECT * FROM engagement_messages WHERE id = ?').get(id);
  res.status(201).json({ success: true, message, engagement: { ...getEngagementById(engagement.id), messages: getEngagementMessages(engagement.id) } });
});

app.delete('/api/listings/:id', requireAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });
  if (listing.ownerUserId && listing.ownerUserId !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Only the listing owner can delete this listing' });
  }
  db.prepare('DELETE FROM listings WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Listing deleted' });
});

app.get('/api/match/:query', requireAuth, (req, res) => {
  const query = decodeURIComponent(req.params.query).toLowerCase();
  let queryTokens = tokenize(query);
  if (queryTokens.length === 0 && query.trim()) {
    queryTokens = query.split(/[^a-z0-9]+/).filter((token) => token && token.length > 0);
  }
  const listings = getVisibleActiveListings(req.user);
  const scored = listings
    .map((item) => ({ ...item, ...searchScore(item, queryTokens) }))
    .sort((a, b) => b.score - a.score);
  res.json({ success: true, query, queryTokens, totalMatched: scored.filter((item) => item.score > 0).length, results: scored });
});

app.get('/api/match-listing/:id', requireAuth, (req, res) => {
  const anchor = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!anchor) return res.status(404).json({ success: false, error: 'Listing not found' });
  if (!isListingVisibleToUser(anchor, req.user)) {
    return res.status(403).json({ success: false, error: 'You cannot access this private listing' });
  }
  const opposite = anchor.type === 'supply' ? 'demand' : 'supply';
  const candidates = getVisibleActiveListings(req.user).filter((item) => item.type === opposite);
  const scored = candidates
    .map((candidate) => {
      const supply = anchor.type === 'supply' ? anchor : candidate;
      const demand = anchor.type === 'demand' ? anchor : candidate;
      const { score, breakdown, explanation } = scoreMatch(supply, demand);
      return { ...candidate, score, breakdown, explanation };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const matches = scored.map((item, index) => {
    const evidence = getRecommendationEvidence(item, index + 1, scored.length);
    return { ...item, confidence: evidence.confidence, statsSummary: evidence.summary };
  });
  res.json({ success: true, anchor, totalMatched: matches.length, matches });
});

app.post('/api/organization/best-match', requireAuth, (req, res) => {
  if (req.user.role !== 'organization') {
    return res.status(403).json({ success: false, error: 'Only organization accounts can request best-match analysis' });
  }
  const need = String(req.body.need || '').trim();
  if (!need) {
    return res.status(400).json({ success: false, error: 'need is required' });
  }
  const requesterLocation = String(req.body.location || req.user.location || '').trim();
  const tokens = tokenize(need);
  const supplyListings = getVisibleActiveListings(req.user).filter((item) => item.type === 'supply');
  const ranked = supplyListings
    .map((listing) => {
      const textScore = searchScore(listing, tokens);
      const proximity = locationSimilarityScore(requesterLocation, listing.location);
      const speedBonus = Number.isInteger(listing.deliverWithinHours) ? Math.max(0, 18 - listing.deliverWithinHours) : 0;
      const totalScore = textScore.score + proximity + speedBonus;
      return {
        ...listing,
        score: totalScore,
        breakdown: [...textScore.breakdown, { rule: 'Location proximity', points: proximity }, { rule: 'Delivery speed', points: speedBonus }]
      };
    })
    .filter((listing) => listing.score > 0)
    .sort((a, b) => b.score - a.score);
  const topMatches = ranked.slice(0, 5).map((match, index) => {
    const evidence = getRecommendationEvidence(match, index + 1, ranked.length);
    return {
      ...match,
      confidence: evidence.confidence,
      evidence: evidence.summary
    };
  });
  res.json({
    success: true,
    basis: {
      listingsAnalyzed: supplyListings.length,
      requesterLocation: requesterLocation || null,
      needTokens: tokens
    },
    best: topMatches[0] || null,
    matches: topMatches
  });
});

app.post('/api/reports', requireAuth, (req, res) => {
  const { listingId = '', reason, details = '' } = req.body;
  if (!reason) {
    return res.status(400).json({ success: false, error: 'reason is required' });
  }
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO reports (id, listingId, reporterName, reason, details, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, listingId, req.user.displayName, reason, details, createdAt);
  res.status(201).json({ success: true, report: { id, listingId, reporterName: req.user.displayName, reason, details, createdAt } });
});

app.get('/api/reports', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM reports ORDER BY createdAt DESC').all();
  res.json({ success: true, reports: rows });
});

app.get('/api/stats', (req, res) => {
  const user = getUserFromRequest(req);
  const listings = getVisibleActiveListings(user);
  const total = listings.length;
  const supply = listings.filter((item) => item.type === 'supply').length;
  const demand = listings.filter((item) => item.type === 'demand').length;
  const byCategoryMap = listings.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});
  const byCategory = Object.entries(byCategoryMap).map(([category, n]) => ({ category, n }));
  const recent = listings.slice(0, 5);
  const reports = db.prepare('SELECT COUNT(*) as n FROM reports').get().n;
  res.json({ success: true, stats: { total, supply, demand, byCategory, recentListings: recent, reports } });
});

app.get('/api/ai-insights', requireAuth, (req, res) => {
  const listings = getVisibleActiveListings(req.user);
  res.json({ success: true, insights: buildAIInsights(listings, req.user.role) });
});

function buildRecommendationResponse(input, user) {
  const listings = getVisibleActiveListings(user || null);
  const role = user && user.role ? user.role : 'community';
  const assistant = generatePersonalizedRecommendations(input, listings, role);
  const basis = {
    listingsAnalyzed: listings.length,
    stats: {
      supply: listings.filter((item) => item.type === 'supply').length,
      demand: listings.filter((item) => item.type === 'demand').length
    }
  };
  return { assistant, basis };
}

app.get('/api/ai-recommendations', requireAuth, (req, res) => {
  const input = req.query.input || '';
  const { assistant, basis } = buildRecommendationResponse(input, req.user);
  try { appendInstrumentation({ endpoint: '/api/ai-recommendations', inputPreview: (input || '').slice(0, 200), role: req.user.role, resultCount: (assistant.matches || []).length, basis }); } catch (e) {}
  res.json({ success: true, assistant, basis, grounded: true });
});

app.get('/api/recommend/:query', (req, res) => {
  const user = getUserFromRequest(req);
  const input = req.params.query || '';
  const { assistant, basis } = buildRecommendationResponse(input, user);
  try {
    appendInstrumentation({
      endpoint: '/api/recommend/:query',
      inputPreview: (input || '').slice(0, 200),
      role: user && user.role ? user.role : 'community',
      resultCount: (assistant.matches || []).length,
      basis
    });
  } catch (e) {}
  res.json({ success: true, assistant, basis, grounded: true });
});

// Accept client-side debug logs for inspection (appends to db/debug-logs.txt)
app.post('/api/debug/logs', (req, res) => {
  try {
    const logs = req.body && req.body.logs ? req.body.logs : null;
    if (!logs || !Array.isArray(logs)) return res.status(400).json({ success: false, error: 'logs array required' });
    const file = path.join(dbDir, 'debug-logs.txt');
    // redact sensitive content before saving
    const safeLines = logs.map((l) => {
      try {
        const json = typeof l === 'string' ? l : JSON.stringify(l);
        return redactSensitive(json);
      } catch (e) { return '[UNSERIALIZABLE_LOG]'; }
    });
    const entry = `\n===== ${new Date().toISOString()} =====\n` + safeLines.join('\n') + '\n';
    fs.appendFileSync(file, entry, 'utf8');
    res.json({ success: true, message: 'Logs saved' });
  } catch (err) {
    console.error('Failed to save debug logs', err);
    res.status(500).json({ success: false, error: 'Could not save logs' });
  }
});

app.post('/api/chat', requireAuth, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ success: false, error: 'message is required' });
  
  const listings = getVisibleActiveListings(req.user);
  const intent = inferUserIntent(message);
  const allMatches = generatePersonalizedRecommendations(message, listings, req.user.role);
  const normalized = message.toLowerCase();
  const isRecommendationRequest = /\b(recommend|suggest|any ideas|any recommendations|what should|best match|show me|find.*match|find.*resource)\b/.test(normalized);
  
  let response = '';
  let suggestions = [];
  let actions = [];
  
  if (isRecommendationRequest && intent.type === 'explore') {
    const topMatches = allMatches.matches.slice(0, 3);
    if (topMatches.length) {
      const topEvidence = getRecommendationEvidence(topMatches[0], 1, allMatches.matches.length);
      response = `From ${listings.length} live listings, I found ${topMatches.length} strong matches (${allMatches.matches.length} relevant candidates). The top result is ${topMatches[0].businessName} (${topMatches[0].category}). Why this is better: ${topEvidence.summary}.`;
      actions = topMatches.map((m, i) => ({
        text: `${m.businessName} — ${m.category} (rank #${i + 1})`,
        id: `select_match_${i}`,
        data: m
      }));
    } else {
      response = 'I did not find a strong match in the current listings yet. You can post a more specific request or offer to get a better recommendation.';
      actions = [
        { text: 'Post a listing', id: 'post_listing' },
        { text: 'Tell me what to post', id: 'share' }
      ];
    }
  } else if (normalized.includes('help') || normalized.includes('how')) {
    response = "I can help you find resources or post what you're sharing. What would you like to do today?";
    suggestions = [
      { text: 'I want to find something', id: 'find' },
      { text: 'I want to share something', id: 'share' },
      { text: 'Show me urgent needs', id: 'urgent' }
    ];
  } else if (intent.type === 'need') {
    const topMatch = allMatches.matches[0];
    const evidence = topMatch ? getRecommendationEvidence(topMatch, 1, allMatches.matches.length) : null;
    response = `Based only on current listings, I found ${allMatches.matches.length} matching ${intent.category} offer${allMatches.matches.length !== 1 ? 's' : ''}. ${topMatch ? `The top match is ${topMatch.businessName}. Why this is better: ${evidence.summary}.` : 'Would you like me to help you post a request?'}`;
    if (topMatch) {
      actions = [
        { text: `Accept top match (${evidence.confidence}% confidence)`, id: 'accept', data: topMatch },
        { text: 'Show other matches', id: 'show_more' },
        { text: 'Decline and search more', id: 'decline' }
      ];
    }
  } else if (intent.type === 'offer') {
    response = `Perfect! I can help you share your ${intent.category}. Would you like to post a listing or see who might need what you're offering?`;
    actions = [
      { text: 'Post a listing', id: 'post_listing' },
      { text: 'Find demand first', id: 'find_demand' }
    ];
  } else if (normalized.includes('urgent')) {
    const urgentListings = listings.filter(l => l.urgent === 1);
    response = `There are ${urgentListings.length} urgent listings right now. Would you like to see them?`;
    actions = [
      { text: 'Show urgent listings', id: 'show_urgent' },
      { text: 'Post an urgent need', id: 'post_urgent' }
    ];
  } else if (normalized.includes('match')) {
    response = `Looking for the best matches using current listing statistics (${listings.length} active listings).`;
    if (allMatches.matches.length) {
      const topEvidence = getRecommendationEvidence(allMatches.matches[0], 1, allMatches.matches.length);
      response += ` Found ${allMatches.matches.length} strong matches. Best option evidence: ${topEvidence.summary}.`;
      actions = allMatches.matches.slice(0, 3).map((m, i) => ({
        text: `${m.businessName} (${m.category}) - rank #${i + 1}`,
        id: `select_match_${i}`,
        data: m
      }));
    }
  } else {
    response = `I found some helpful resources for you. ${allMatches.summary}`;
    suggestions = allMatches.actions.slice(0, 2).map((a, i) => ({
      text: a.title,
      id: `action_${i}`,
      description: a.reason
    }));
  }
  
  res.json({
    success: true,
    reply: {
      message: response,
      suggestions,
      actions,
      listings: allMatches.matches,
      intent
    }
  });
  // instrumentation: log chat intent and match count
  try { appendInstrumentation({ endpoint: '/api/chat', messagePreview: (message || '').slice(0,200), intent, matches: allMatches.matches.length }); } catch (e) {}
});

app.post('/api/chat/action', requireAuth, (req, res) => {
  const { action, data } = req.body;
  if (!action) return res.status(400).json({ success: false, error: 'action is required' });
  
  let response = '';
  let nextStep = null;
  
  if (action === 'accept' && data) {
    response = `Great! I'm connecting you with ${data.businessName}. Would you like to copy their contact info or post your own listing?`;
    nextStep = {
      type: 'contact',
      listing: data,
      options: [
        { text: 'Copy contact', id: 'copy_contact' },
        { text: 'Post my listing', id: 'start_post' },
        { text: 'See more matches', id: 'show_more' }
      ]
    };
  } else if (action === 'post_listing') {
    response = 'Let\'s create your listing! What type of resource are you sharing?';
    nextStep = {
      type: 'post',
      step: 'type',
      options: [
        { text: 'I\'m offering something', id: 'type_supply' },
        { text: 'I\'m requesting something', id: 'type_demand' }
      ]
    };
  } else if (action === 'show_urgent') {
    const listings = getVisibleActiveListings(req.user).filter((listing) => listing.urgent === 1);
    response = `Here are the ${listings.length} most urgent items right now:`;
    nextStep = {
      type: 'listings',
      listings: listings.slice(0, 5)
    };
  } else if (action === 'find') {
    response = 'What are you looking for? (e.g., "meeting space", "food", "volunteers")';
    nextStep = { type: 'input', placeholder: 'Describe what you need...' };
  } else if (action === 'share') {
    response = 'What do you have to share? (e.g., "office space", "food surplus", "expertise")';
    nextStep = { type: 'input', placeholder: 'Describe what you\'re offering...' };
  }
  
  res.json({
    success: true,
    reply: {
      message: response,
      nextStep
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🌿 Brisio running at http://localhost:${PORT}`);
  console.log(`📊 API docs at http://localhost:${PORT}/api/stats\n`);
});

module.exports = app;
