const dotenv = require('dotenv');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '.env.local') });
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !supabaseAnonKey || !/^https?:\/\//i.test(String(supabaseUrl))) {
  console.error('Error: set SUPABASE_URL to your Supabase Project URL and SUPABASE_ANON_KEY to your anon public key in .env.local');
  process.exit(1);
}

const supabaseServerKey = supabaseServiceRoleKey || supabaseAnonKey;
const supabase = createClient(supabaseUrl, supabaseServerKey);

function explainSupabaseError(error) {
  const message = String(error?.message || error || 'Unknown Supabase error');
  if (message.includes("Could not find the table 'public.users' in the schema cache")) {
    return 'Supabase schema is incomplete for this project. Run db-schema.sql in Supabase SQL Editor, then retry.';
  }
  return message;
}

async function verifySupabaseSchema() {
  const requiredTables = ['users', 'sessions', 'listings', 'engagements', 'engagement_messages', 'reports'];
  for (const table of requiredTables) {
    const { error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.error(`Supabase schema check failed for table "${table}": ${explainSupabaseError(error)}`);
      console.error('Fix: open Supabase SQL Editor for this project and run db-schema.sql');
      return;
    }
  }
  console.log('Supabase schema check: all required tables are available.');
}

// Utility functions
function redactSensitive(text) {
  if (!text) return text;
  let out = String(text);
  out = out.replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+)\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
  out = out.replace(/\+?\d[\d\s().-]{6,}\d/g, '[REDACTED_PHONE]');
  return out;
}

function appendInstrumentation(entry) {
  try {
    const dbDir = path.join(__dirname, 'db');
    fs.mkdirSync(dbDir, { recursive: true });
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

function validatePassword(password) {
  const value = String(password || '');
  const hasUppercase = /[A-Z]/.test(value);
  const hasLowercase = /[a-z]/.test(value);
  const hasNumber = /\d/.test(value);
  const hasSpecialCharacter = /[^A-Za-z0-9]/.test(value);

  if (
    value.length < 10 ||
    !hasUppercase ||
    !hasLowercase ||
    !hasNumber ||
    !hasSpecialCharacter
  ) {
    return 'password must be at least 10 characters and include uppercase, lowercase, number, and special character';
  }

  return null;
}

async function issueSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  
  const { error } = await supabase
    .from('sessions')
    .insert([{
      token,
      userId,
      userid: userId,
      createdAt,
      createdat: createdAt,
      expiresAt,
      expiresat: expiresAt,
    }]);
  
  if (error) throw error;
  return token;
}

function authTokenFromRequest(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

function getFirstDefined(obj, keys, fallback = '') {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return fallback;
}

function normalizeUserRow(row) {
  if (!row) return null;
  return {
    id: getFirstDefined(row, ['id']),
    email: getFirstDefined(row, ['email']),
    role: getFirstDefined(row, ['role']),
    displayName: getFirstDefined(row, ['displayName', 'displayname']),
    organizationName: getFirstDefined(row, ['organizationName', 'organizationname']),
    location: getFirstDefined(row, ['location']),
    createdAt: getFirstDefined(row, ['createdAt', 'createdat']),
    passwordHash: getFirstDefined(row, ['passwordHash', 'passwordhash']),
  };
}

function normalizeSessionRow(row) {
  if (!row) return null;
  return {
    token: getFirstDefined(row, ['token']),
    userId: getFirstDefined(row, ['userId', 'userid']),
    createdAt: getFirstDefined(row, ['createdAt', 'createdat']),
    expiresAt: getFirstDefined(row, ['expiresAt', 'expiresat']),
  };
}

async function getUserFromRequest(req) {
  const token = authTokenFromRequest(req);
  if (!token) return null;
  
  const { data: rawSession, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('token', token)
    .single();
  
  if (error || !rawSession) return null;
  const session = normalizeSessionRow(rawSession);
  if (!session.userId) return null;
  
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await supabase.from('sessions').delete().eq('token', token);
    return null;
  }

  // Sliding session: keep active users signed in for another 14 days.
  const refreshedExpiry = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  await supabase
    .from('sessions')
    .update({ expiresAt: refreshedExpiry, expiresat: refreshedExpiry })
    .eq('token', token);
  
  const { data: rawUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', session.userId)
    .single();
  
  const user = normalizeUserRow(rawUser);
  if (!user || !user.id) return null;
  return user;
}

async function requireAuth(req, res, next) {
  const user = await getUserFromRequest(req);
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

async function getVisibleActiveListings(user) {
  const { data: listings, error } = await supabase
    .from('listings')
    .select('*')
    .eq('active', 1)
    .order('createdAt', { ascending: false });
  
  if (error) throw error;
  return listings.filter((listing) => isListingVisibleToUser(listing, user) && !isListingExpired(listing));
}

function canAccessEngagement(engagement, user) {
  if (!engagement || !user) return false;
  return engagement.listingOwnerId === user.id || engagement.requesterUserId === user.id;
}

async function getEngagementById(id) {
  const { data, error } = await supabase
    .from('engagements')
    .select(`
      *,
      listings (
        businessName,
        category,
        type,
        description,
        contact,
        location,
        deliverWithinHours,
        offerClosesAt,
        urgencyLevel,
        isPrivate,
        resourceName,
        resourceType,
        quantity,
        availabilityNotes
      ),
      owner:users!listingOwnerId (
        displayName,
        organizationName
      ),
      requester:users!requesterUserId (
        displayName,
        organizationName
      )
    `)
    .eq('id', id)
    .single();
  
  if (error) return null;
  
  // Flatten the response
  if (data && data.listings && data.listings[0]) {
    const listing = data.listings[0];
    return {
      ...data,
      businessName: listing.businessName,
      category: listing.category,
      type: listing.type,
      description: listing.description,
      contact: listing.contact,
      location: listing.location,
      deliverWithinHours: listing.deliverWithinHours,
      offerClosesAt: listing.offerClosesAt,
      urgencyLevel: listing.urgencyLevel,
      isPrivate: listing.isPrivate,
      resourceName: listing.resourceName,
      resourceType: listing.resourceType,
      quantity: listing.quantity,
      availabilityNotes: listing.availabilityNotes,
      ownerDisplayName: data.owner?.displayName,
      ownerOrganizationName: data.owner?.organizationName,
      requesterDisplayName: data.requester?.displayName,
      requesterOrganizationName: data.requester?.organizationName
    };
  }
  
  return data;
}

async function getEngagementMessages(engagementId) {
  const { data, error } = await supabase
    .from('engagement_messages')
    .select('id, engagementId, senderUserId, senderName, body, etaNote, locationNote, createdAt')
    .eq('engagementId', engagementId)
    .order('createdAt', { ascending: true });
  
  if (error) return [];
  return data || [];
}

async function getEngagementsForUser(user) {
  const { data, error } = await supabase
    .from('engagements')
    .select(`
      *,
      listings (
        businessName,
        category,
        type,
        description,
        contact,
        location,
        deliverWithinHours,
        offerClosesAt,
        urgencyLevel,
        isPrivate,
        resourceName,
        resourceType,
        quantity,
        availabilityNotes
      ),
      owner:users!listingOwnerId (
        displayName,
        organizationName
      ),
      requester:users!requesterUserId (
        displayName,
        organizationName
      )
    `)
    .or(`listingOwnerId.eq.${user.id},requesterUserId.eq.${user.id}`)
    .order('updatedAt', { ascending: false });
  
  if (error) return [];
  
  const rows = data || [];
  const results = [];
  
  for (const row of rows) {
    const messages = await getEngagementMessages(row.id);
    const listing = row.listings[0];
    results.push({
      ...row,
      businessName: listing?.businessName,
      category: listing?.category,
      type: listing?.type,
      description: listing?.description,
      contact: listing?.contact,
      location: listing?.location,
      deliverWithinHours: listing?.deliverWithinHours,
      offerClosesAt: listing?.offerClosesAt,
      urgencyLevel: listing?.urgencyLevel,
      isPrivate: listing?.isPrivate,
      resourceName: listing?.resourceName,
      resourceType: listing?.resourceType,
      quantity: listing?.quantity,
      availabilityNotes: listing?.availabilityNotes,
      ownerDisplayName: row.owner?.displayName,
      ownerOrganizationName: row.owner?.organizationName,
      requesterDisplayName: row.requester?.displayName,
      requesterOrganizationName: row.requester?.organizationName,
      messages
    });
  }
  
  return results;
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

function summarizeBreakdown(breakdown, limit = 2) {
  if (!Array.isArray(breakdown) || breakdown.length === 0) {
    return 'baseline relevance';
  }
  return breakdown
    .slice(0, limit)
    .map((item) => item.rule)
    .join(', ');
}

function generateBusinessSuggestions(description, category) {
  const text = (description || '').toLowerCase();
  const suggestions = [];

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

  return suggestions;
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
      action: 'Try a search like "meeting room" or "food surplus" to see what is already available.'
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

  return {
    summary: summaryParts.join(' '),
    recommendations: recommendations.slice(0, 4),
    role: roleLabel
  };
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 60_000, max: 120, message: { error: 'Too many requests, slow down.' } });
app.use('/api/', limiter);

// Make requireAuth async-aware
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && !['POST', 'GET', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }
  next();
});

// Auth Endpoints
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role, name, organizationName, location } = req.body;
    if (!email || !password || !role || !name) {
      return res.status(400).json({ success: false, error: 'email, password, role, and name are required' });
    }
    if (!['business', 'organization'].includes(role)) {
      return res.status(400).json({ success: false, error: 'role must be business or organization' });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ success: false, error: passwordError });
    }

    const userId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(400).json({ success: false, error: 'email already registered' });
    }

    const passwordHash = hashPassword(password);

    const { error } = await supabase.from('users').insert([{
      id: userId,
      email,
      passwordHash,
      passwordhash: passwordHash,
      role,
      displayName: name,
      displayname: name,
      organizationName: organizationName || '',
      organizationname: organizationName || '',
      location: location || '',
      createdAt,
      createdat: createdAt,
    }]);

    if (error) {
      return res.status(500).json({ success: false, error: explainSupabaseError(error) });
    }

    const token = await issueSession(userId);
    appendInstrumentation({ type: 'register', userId, email });
    res.json({ success: true, token, user: { id: userId, email, role, displayName: name } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, error: explainSupabaseError(err) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'email and password are required' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    const normalizedUser = normalizeUserRow(user);
    if (error || !normalizedUser || !verifyPassword(password, normalizedUser.passwordHash)) {
      if (error) {
        return res.status(500).json({ success: false, error: explainSupabaseError(error) });
      }
      return res.status(400).json({ success: false, error: 'invalid email or password' });
    }

    const token = await issueSession(normalizedUser.id);
    appendInstrumentation({ type: 'login', userId: normalizedUser.id, email });
    res.json({ success: true, token, user: { id: normalizedUser.id, email: normalizedUser.email, role: normalizedUser.role, displayName: normalizedUser.displayName, organizationName: normalizedUser.organizationName, location: normalizedUser.location, createdAt: normalizedUser.createdAt } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;
    
    const token = authTokenFromRequest(req);
    await supabase.from('sessions').delete().eq('token', token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/auth/account', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const userId = req.user.id;

    // Delete user's data
    await supabase.from('sessions').delete().eq('userId', userId);
    await supabase.from('engagement_messages').delete().eq('senderUserId', userId);
    await supabase.from('engagements').delete().eq('requesterUserId', userId);
    await supabase.from('engagements').delete().eq('listingOwnerId', userId);
    await supabase.from('listings').delete().eq('ownerUserId', userId);
    await supabase.from('users').delete().eq('id', userId);

    appendInstrumentation({ type: 'delete_account', userId });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/me', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;
    res.json({ success: true, user: req.user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Listing Endpoints
app.get('/api/listings', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const listings = await getVisibleActiveListings(req.user);
    res.json({ success: true, listings });
  } catch (err) {
    console.error('Get listings error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/listings', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const { type, category, businessName, description, contact, location, urgent, deliverWithinHours, offerClosesAt, urgencyLevel, resourceName, resourceType, quantity, availabilityNotes, isPrivate, targetOrganizationId } = req.body;

    if (!type || !['supply', 'demand'].includes(type)) {
      return res.status(400).json({ success: false, error: 'type must be supply or demand' });
    }
    if (!businessName || !description) {
      return res.status(400).json({ success: false, error: 'businessName and description are required' });
    }

    const listingId = crypto.randomUUID();
    const now = new Date().toISOString();
    const detectedCategory = category || detectCategory(description);

    const { error } = await supabase.from('listings').insert([{
      id: listingId,
      type,
      category: detectedCategory,
      businessName,
      businessname: businessName,
      description,
      contact: contact || '',
      location: location || '',
      urgent: urgent ? 1 : 0,
      active: 1,
      ownerUserId: req.user.id,
      owneruserid: req.user.id,
      deliverWithinHours: deliverWithinHours || null,
      deliverwithinhours: deliverWithinHours || null,
      offerClosesAt: offerClosesAt || '',
      offerclosesat: offerClosesAt || '',
      urgencyLevel: urgencyLevel || 'normal',
      urgencylevel: urgencyLevel || 'normal',
      resourceName: resourceName || '',
      resourcename: resourceName || '',
      resourceType: resourceType || '',
      resourcetype: resourceType || '',
      quantity: quantity || '',
      availabilityNotes: availabilityNotes || '',
      availabilitynotes: availabilityNotes || '',
      isPrivate: isPrivate ? 1 : 0,
      isprivate: isPrivate ? 1 : 0,
      targetOrganizationId: targetOrganizationId || '',
      targetorganizationid: targetOrganizationId || '',
      createdAt: now,
      createdat: now,
      updatedAt: now,
      updatedat: now,
    }]);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    appendInstrumentation({ type: 'create_listing', userId: req.user.id, listingId, category: detectedCategory });
    res.json({ success: true, listingId });
  } catch (err) {
    console.error('Create listing error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/listings/:id', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const { data: listing, error } = await supabase
      .from('listings')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    if (!isListingVisibleToUser(listing, req.user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    res.json({ success: true, listing });
  } catch (err) {
    console.error('Get listing error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/listings/:id', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const { data: listing, error: fetchError } = await supabase
      .from('listings')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    if (listing.ownerUserId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Only the owner can edit this listing' });
    }

    const updatedAt = new Date().toISOString();
    const updateData = { ...req.body, updatedAt };
    delete updateData.id;
    delete updateData.createdAt;
    delete updateData.ownerUserId;

    const { error } = await supabase
      .from('listings')
      .update(updateData)
      .eq('id', req.params.id);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Update listing error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/listings/:id', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const { data: listing, error: fetchError } = await supabase
      .from('listings')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    if (listing.ownerUserId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Only the owner can delete this listing' });
    }

    const { error } = await supabase
      .from('listings')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete listing error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Engagement Endpoints
app.get('/api/engagements', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const engagements = await getEngagementsForUser(req.user);
    res.json({ success: true, engagements });
  } catch (err) {
    console.error('Get engagements error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/listings/:id/requests', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const { data: listing, error: fetchError } = await supabase
      .from('listings')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    const engagementId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error } = await supabase.from('engagements').insert([{
      id: engagementId,
      listingId: req.params.id,
      listingid: req.params.id,
      listingOwnerId: listing.ownerUserId,
      listingownerid: listing.ownerUserId,
      requesterUserId: req.user.id,
      requesteruserid: req.user.id,
      status: 'requested',
      createdAt: now,
      createdat: now,
      updatedAt: now,
      updatedat: now,
    }]);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, engagementId });
  } catch (err) {
    console.error('Create engagement error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/engagements/:id/status', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const { status } = req.body;
    if (!status || !['requested', 'accepted', 'preparing', 'on_the_way', 'delivered', 'completed', 'declined', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const { data: engagement, error: fetchError } = await supabase
      .from('engagements')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !engagement) {
      return res.status(404).json({ success: false, error: 'Engagement not found' });
    }

    if (!canAccessEngagement(engagement, req.user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from('engagements')
      .update({ status, updatedAt })
      .eq('id', req.params.id);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Update engagement status error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/engagements/:id/messages', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const { body, etaNote, locationNote } = req.body;
    if (!body) {
      return res.status(400).json({ success: false, error: 'message body is required' });
    }

    const { data: engagement, error: fetchError } = await supabase
      .from('engagements')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !engagement) {
      return res.status(404).json({ success: false, error: 'Engagement not found' });
    }

    if (!canAccessEngagement(engagement, req.user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error } = await supabase.from('engagement_messages').insert([{
      id: messageId,
      engagementId: req.params.id,
      engagementid: req.params.id,
      senderUserId: req.user.id,
      senderuserid: req.user.id,
      senderName: req.user.displayName,
      sendername: req.user.displayName,
      body,
      etaNote: etaNote || '',
      etanote: etaNote || '',
      locationNote: locationNote || '',
      locationnote: locationNote || '',
      createdAt: now,
      createdat: now,
    }]);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, messageId });
  } catch (err) {
    console.error('Create message error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Search and Matching Endpoints
app.get('/api/match/:query', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const query = decodeURIComponent(req.params.query);
    const listings = await getVisibleActiveListings(req.user);
    const recommendations = generatePersonalizedRecommendations(query, listings, req.user.role);
    res.json({ success: true, recommendations });
  } catch (err) {
    console.error('Match error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Statistics Endpoints
app.get('/api/stats', async (req, res) => {
  try {
    const { data: listings } = await supabase.from('listings').select('type, urgent, active');
    const { data: users } = await supabase.from('users').select('role');
    const { data: engagements } = await supabase.from('engagements').select('status');

    const stats = {
      totalListings: listings?.length || 0,
      activeListings: listings?.filter(l => l.active === 1).length || 0,
      supplyListings: listings?.filter(l => l.type === 'supply').length || 0,
      demandListings: listings?.filter(l => l.type === 'demand').length || 0,
      urgentListings: listings?.filter(l => l.urgent === 1).length || 0,
      totalUsers: users?.length || 0,
      businessUsers: users?.filter(u => u.role === 'business').length || 0,
      organizationUsers: users?.filter(u => u.role === 'organization').length || 0,
      totalEngagements: engagements?.length || 0,
      completedEngagements: engagements?.filter(e => e.status === 'completed').length || 0
    };

    res.json({ success: true, stats });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// AI Insights Endpoints
app.get('/api/ai-insights', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const listings = await getVisibleActiveListings(req.user);
    const insights = buildAIInsights(listings, req.user.role);
    res.json({ success: true, insights });
  } catch (err) {
    console.error('AI insights error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/ai-recommendations', async (req, res, next) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const listings = await getVisibleActiveListings(req.user);
    const recommendations = generatePersonalizedRecommendations('', listings, req.user.role);
    res.json({ success: true, recommendations });
  } catch (err) {
    console.error('AI recommendations error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Placeholder endpoints
app.get('/api/organizations', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'organization')
      .limit(200);

    if (error) return res.status(500).json({ success: false, error: error.message });

    const organizations = (data || []).map((row) => {
      const user = normalizeUserRow(row);
      return {
        id: user.id,
        displayName: user.displayName,
        organizationName: user.organizationName || user.displayName,
        location: user.location || '',
      };
    });

    res.json({ success: true, organizations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/private-offers', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;
    if (req.user.role !== 'business') {
      return res.status(403).json({ success: false, error: 'Only business users can send private offers.' });
    }

    const { category, description, contact, location, resourceName, resourceType, quantity, availabilityNotes, deliverWithinHours, offerClosesAt, targetOrganizationId } = req.body;
    if (!targetOrganizationId || !description) {
      return res.status(400).json({ success: false, error: 'targetOrganizationId and description are required' });
    }

    const listingId = crypto.randomUUID();
    const now = new Date().toISOString();
    const businessName = req.user.organizationName || req.user.displayName || 'Business partner';

    const { error } = await supabase.from('listings').insert([{
      id: listingId,
      type: 'supply',
      category: category || detectCategory(description),
      businessName,
      businessname: businessName,
      description,
      contact: contact || '',
      location: location || req.user.location || '',
      urgent: 0,
      active: 1,
      ownerUserId: req.user.id,
      owneruserid: req.user.id,
      deliverWithinHours: deliverWithinHours || null,
      deliverwithinhours: deliverWithinHours || null,
      offerClosesAt: offerClosesAt || '',
      offerclosesat: offerClosesAt || '',
      urgencyLevel: 'normal',
      urgencylevel: 'normal',
      resourceName: resourceName || '',
      resourcename: resourceName || '',
      resourceType: resourceType || '',
      resourcetype: resourceType || '',
      quantity: quantity || '',
      availabilityNotes: availabilityNotes || '',
      availabilitynotes: availabilityNotes || '',
      isPrivate: 1,
      isprivate: 1,
      targetOrganizationId,
      targetorganizationid: targetOrganizationId,
      createdAt: now,
      createdat: now,
      updatedAt: now,
      updatedat: now,
    }]);

    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, listingId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/match-listing/:id', async (req, res) => {
  res.json({ success: false, error: 'Not implemented' });
});

app.post('/api/organization/best-match', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const { need = '', location = '' } = req.body || {};
    const listings = await getVisibleActiveListings(req.user);
    const query = `${need} ${location}`.trim();
    const assistant = generatePersonalizedRecommendations(query, listings, req.user.role);
    const top = (assistant.matches || [])[0] || null;
    const best = top
      ? {
          id: top.id,
          businessName: top.businessName,
          description: top.description,
          confidence: top.confidence || 0,
          location: top.location || '',
          deliverWithinHours: top.deliverWithinHours || null,
          evidence: top.matchStats?.explanation || top.matchStats?.breakdown?.map((b) => b.rule).join(', ') || '',
          contact: top.contact || '',
          category: top.category || '',
        }
      : null;

    res.json({
      success: true,
      best,
      basis: {
        listingsAnalyzed: listings.length,
        intent: assistant.intent,
      },
      assistant: {
        summary: assistant.summary,
        actions: assistant.actions || [],
        tips: assistant.tips || [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reports', async (req, res) => {
  res.json({ success: false, error: 'Not implemented' });
});

app.get('/api/reports', async (req, res) => {
  res.json({ success: true, reports: [] });
});

app.get('/api/recommend/:query', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const query = decodeURIComponent(req.params.query || '');
    const listings = await getVisibleActiveListings(req.user);
    const assistant = generatePersonalizedRecommendations(query, listings, req.user.role);
    res.json({
      success: true,
      basis: {
        listingsAnalyzed: listings.length,
        intent: assistant.intent,
      },
      assistant: {
        summary: assistant.summary,
        actions: assistant.actions || [],
        tips: assistant.tips || [],
      },
      listings: assistant.matches || [],
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/debug/logs', async (req, res) => {
  res.json({ success: true });
});

app.post('/api/chat', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ success: false, error: 'message is required' });

    const listings = await getVisibleActiveListings(req.user);
    const assistant = generatePersonalizedRecommendations(message, listings, req.user.role);
    const topMatches = (assistant.matches || []).slice(0, 4).map((m, index) => ({
      id: `select_match_${index + 1}`,
      text: `Select ${m.businessName}`,
      data: {
        id: m.id,
        businessName: m.businessName,
        category: m.category,
        contact: m.contact,
        location: m.location,
        description: m.description,
        deliverWithinHours: m.deliverWithinHours,
      },
    }));

    const suggestions = [
      { id: 'show_urgent', text: 'Show urgent listings' },
      { id: 'find', text: 'Find what you need' },
      { id: 'share', text: 'Share what you can' },
    ];

    res.json({
      success: true,
      reply: {
        message: assistant.summary,
        actions: topMatches,
        suggestions,
      },
      listings: assistant.matches || [],
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/chat/action', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const actionId = String(req.body?.actionId || '').trim();
    const data = req.body?.data || {};
    const listings = await getVisibleActiveListings(req.user);

    if (actionId === 'show_urgent') {
      const urgent = listings.filter((item) => item.urgent === 1).slice(0, 5);
      const summary = urgent.length
        ? `I found ${urgent.length} urgent listing${urgent.length === 1 ? '' : 's'} right now.`
        : 'There are no urgent listings at the moment.';
      return res.json({
        success: true,
        reply: {
          message: summary,
          actions: urgent.map((m, index) => ({
            id: `select_match_${index + 1}`,
            text: `Select ${m.businessName}`,
            data: {
              id: m.id,
              businessName: m.businessName,
              category: m.category,
              contact: m.contact,
              location: m.location,
              description: m.description,
            },
          })),
          suggestions: [{ id: 'find', text: 'Find what you need' }],
        },
        listings: urgent,
      });
    }

    if (actionId === 'share') {
      return res.json({
        success: true,
        reply: {
          message: 'Great. Post a new offer with quantity, pickup details, and timing so nonprofits can act quickly.',
          actions: [],
          suggestions: [{ id: 'show_urgent', text: 'Show urgent listings' }],
        },
      });
    }

    if (actionId === 'find') {
      return res.json({
        success: true,
        reply: {
          message: 'Tell me the exact resource and timing you need, and I will rank current matches.',
          actions: [],
          suggestions: [{ id: 'show_urgent', text: 'Show urgent listings' }],
        },
      });
    }

    if (actionId === 'accept' && data && data.id && req.user.role === 'organization') {
      const { data: listing, error: fetchError } = await supabase
        .from('listings')
        .select('*')
        .eq('id', data.id)
        .single();

      if (!fetchError && listing) {
        const engagementId = crypto.randomUUID();
        const now = new Date().toISOString();
        await supabase.from('engagements').insert([{
          id: engagementId,
          listingId: listing.id,
          listingid: listing.id,
          listingOwnerId: listing.ownerUserId,
          listingownerid: listing.ownerUserId,
          requesterUserId: req.user.id,
          requesteruserid: req.user.id,
          status: 'requested',
          createdAt: now,
          createdat: now,
          updatedAt: now,
          updatedat: now,
        }]);
      }

      return res.json({
        success: true,
        reply: {
          message: 'Request sent. Check the coordination board for updates.',
          actions: [],
          suggestions: [{ id: 'show_urgent', text: 'Show urgent listings' }],
        },
      });
    }

    return res.json({
      success: true,
      reply: {
        message: 'Action completed.',
        actions: [],
        suggestions: [{ id: 'show_urgent', text: 'Show urgent listings' }],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Brisio backend running on port ${PORT}`);
  console.log(`Using Supabase: ${supabaseUrl}`);
  verifySupabaseSchema().catch((err) => {
    console.error('Supabase schema check failed unexpectedly:', explainSupabaseError(err));
  });
});
