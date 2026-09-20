const dotenv = require('dotenv');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const nodemailer = require('nodemailer');

dotenv.config({ path: path.join(__dirname, '.env.local') });
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !supabaseAnonKey || !/^https?:\/\//i.test(String(supabaseUrl))) {
  console.error('Error: set SUPABASE_URL to your Supabase Project URL and SUPABASE_ANON_KEY to your anon public key in .env.local');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !supabaseServiceRoleKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY is required in production');
  process.exit(1);
}

const supabaseServerKey = supabaseServiceRoleKey || supabaseAnonKey;
const supabase = createClient(supabaseUrl, supabaseServerKey);

function normalizeEnvString(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function normalizeEnvSecret(value) {
  return normalizeEnvString(value).replace(/\s+/g, '');
}

const smtpHost = normalizeEnvString(process.env.SMTP_HOST);
const smtpPort = Number(normalizeEnvString(process.env.SMTP_PORT) || '587');
const smtpSecureRaw = normalizeEnvString(process.env.SMTP_SECURE).toLowerCase();
const smtpSecure = smtpSecureRaw ? smtpSecureRaw === 'true' : smtpPort === 465;
const smtpUser = normalizeEnvString(process.env.SMTP_USER);
const smtpPass = normalizeEnvSecret(process.env.SMTP_PASS);
const resetEmailFrom = normalizeEnvString(process.env.RESET_EMAIL_FROM || smtpUser || '');
const includeResetCodeInResponse = normalizeEnvString(process.env.INCLUDE_RESET_CODE_IN_RESPONSE).toLowerCase() === 'true';
const resendApiKey = normalizeEnvString(process.env.RESEND_API_KEY);
const resendFrom = normalizeEnvString(process.env.RESEND_FROM || resetEmailFrom);
const googleMailerUrl = normalizeEnvString(process.env.GOOGLE_MAILER_URL);
const googleMailerSecret = normalizeEnvSecret(process.env.GOOGLE_MAILER_SECRET);

let resetMailer = null;

function explainSupabaseError(error) {
  const message = String(error?.message || error || 'Unknown Supabase error');
  if (/fetch failed|network request failed|getaddrinfo|enotfound/i.test(message)) {
    return 'Database service is temporarily unavailable. Please try again shortly.';
  }
  if (message.includes("Could not find the table 'public.users' in the schema cache")) {
    return 'Supabase schema is incomplete for this project. Run db-schema.sql in Supabase SQL Editor, then retry.';
  }
  return message;
}

function isMissingDonationRecordsTableError(error) {
  const message = String(error?.message || error || '');
  return message.includes("Could not find the table 'public.donation_records' in the schema cache");
}

async function verifySupabaseSchema() {
  const requiredTables = [
    'users',
    'sessions',
    'listings',
    'reports',
    'blocks',
    'password_reset_tokens',
    'donation_records',
    'donation_events',
    'donation_handoffs',
  ];
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

function generateResetCode() {
  return String(crypto.randomInt(100000, 999999));
}

function hashResetCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

async function clearExistingResetTokens(userId) {
  await supabase.from('password_reset_tokens').delete().eq('userId', userId);
}

function getResetMailer() {
  if (resetMailer) return resetMailer;
  if (!smtpHost || !smtpUser || !smtpPass || !Number.isFinite(smtpPort) || !resetEmailFrom) return null;

  resetMailer = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    family: 4,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  resetMailer.verify((error) => {
    if (error) {
      console.error('Reset mailer verification failed:', error);
      appendInstrumentation({ type: 'forgot-password-email-verification-failed', error: String(error?.message || error) });
    }
  });

  return resetMailer;
}

async function sendResetCodeViaResend({ to, resetCode, expiresAt }) {
  if (!resendApiKey || !resendFrom) {
    return { sent: false, reason: 'resend-not-configured' };
  }

  const expiresText = new Date(expiresAt).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' });
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendApiKey}`,
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      from: resendFrom,
      to: [to],
      subject: 'Your Brisio password reset code',
      text: `Your Brisio reset code is ${resetCode}. This code expires at ${expiresText}. If you did not request this, you can ignore this email.`,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Resend request failed (${response.status}): ${responseText}`);
  }

  return { sent: true, provider: 'resend', response: responseText };
}

async function sendResetCodeViaGoogle({ to, resetCode, expiresAt }) {
  if (!googleMailerUrl || !googleMailerSecret) {
    return { sent: false, reason: 'google-mailer-not-configured' };
  }

  const response = await fetch(googleMailerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      secret: googleMailerSecret,
      to,
      resetCode,
      expiresAt: new Date(expiresAt).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' }),
    }),
  });
  const responseText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    // The response validation below reports a bounded provider error.
  }

  if (!response.ok || !payload?.success) {
    throw new Error(`Google mailer request failed (${response.status})`);
  }

  return { sent: true, provider: 'google', response: responseText };
}

async function sendResetCodeEmail({ to, resetCode, expiresAt }) {
  if (googleMailerUrl && googleMailerSecret) {
    try {
      const result = await sendResetCodeViaGoogle({ to, resetCode, expiresAt });
      appendInstrumentation({ type: 'forgot-password-email-sent', provider: 'google', email: to });
      return result;
    } catch (error) {
      console.error('Reset email send error via Google:', error);
      appendInstrumentation({ type: 'forgot-password-email-failed', provider: 'google', email: to, error: String(error?.message || error) });
    }
  }

  if (resendApiKey && resendFrom) {
    try {
      const result = await sendResetCodeViaResend({ to, resetCode, expiresAt });
      appendInstrumentation({
        type: 'forgot-password-email-sent',
        provider: 'resend',
        email: to,
        response: String(result?.response || ''),
      });
      return result;
    } catch (error) {
      console.error('Reset email send error via Resend:', error);
      appendInstrumentation({ type: 'forgot-password-email-failed', provider: 'resend', email: to, error: String(error?.message || error) });
    }
  }

  const mailer = getResetMailer();
  if (!mailer) {
    appendInstrumentation({ type: 'forgot-password-email-skipped', reason: 'no-mail-provider-configured', email: to });
    return { sent: false, reason: 'no-mail-provider-configured' };
  }

  const expiresText = new Date(expiresAt).toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' });
  try {
    const info = await mailer.sendMail({
      from: resetEmailFrom,
      to,
      subject: 'Your Brisio password reset code',
      text: `Your Brisio reset code is ${resetCode}. This code expires at ${expiresText}. If you did not request this, you can ignore this email.`,
    });
    appendInstrumentation({
      type: 'forgot-password-email-sent',
      provider: 'smtp',
      email: to,
      messageId: String(info?.messageId || ''),
      response: String(info?.response || ''),
    });
    return { sent: true, provider: 'smtp', messageId: String(info?.messageId || ''), response: String(info?.response || '') };
  } catch (error) {
    console.error('Reset email send error:', error);
    appendInstrumentation({ type: 'forgot-password-email-failed', provider: 'smtp', email: to, error: String(error?.message || error) });
    return { sent: false, reason: String(error?.message || error) };
  }
}

async function getActiveResetTokenForUser(userId) {
  const attempts = [
    { userKey: 'userId', usedKey: 'usedAt' },
    { userKey: 'userid', usedKey: 'usedat' },
  ];

  let lastError = null;

  for (const attempt of attempts) {
    const { data: tokens, error: tokenError } = await supabase
      .from('password_reset_tokens')
      .select('*')
      .eq(attempt.userKey, userId)
      .limit(20);

    if (tokenError) {
      lastError = tokenError;
      continue;
    }

    const tokenRow = (tokens || [])
      .filter((token) => {
        const usedAt = token?.[attempt.usedKey];
        return usedAt === null || usedAt === undefined || usedAt === '';
      })
      .slice()
      .sort((a, b) => {
        const aCreated = new Date(a?.createdAt || a?.createdat || 0).getTime();
        const bCreated = new Date(b?.createdAt || b?.createdat || 0).getTime();
        return bCreated - aCreated;
      })[0];

    if (!tokenRow) {
      continue;
    }

    const expiresAt = new Date(getFirstDefined(tokenRow, ['expiresAt', 'expiresat'])).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      return { validationError: 'Reset code expired' };
    }

    return { tokenRow };
  }

  if (lastError) {
    return { error: lastError };
  }

  return { validationError: 'No active reset code found' };
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

function parseJsonSafe(value, fallback = {}) {
  try {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeBarcode(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

function normalizeGtinFromBarcode(barcode) {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) return '';
  return normalized.padStart(14, '0');
}

function listingResponseDonationId(listingId, organizationId) {
  const digest = crypto
    .createHash('sha256')
    .update(`${listingId}:${organizationId}`)
    .digest('hex')
    .slice(0, 32);
  return `don_listing_${digest}`;
}

async function appendDonationEvent({ donationId, eventType, actorUserId, actorRole, payload = {} }) {
  const createdAt = new Date().toISOString();
  await supabase.from('donation_events').insert([{
    id: crypto.randomUUID(),
    donationId,
    donationid: donationId,
    eventType,
    eventtype: eventType,
    actorUserId,
    actoruserid: actorUserId,
    actorRole,
    actorrole: actorRole,
    payloadJson: JSON.stringify(payload || {}),
    payloadjson: JSON.stringify(payload || {}),
    createdAt,
    createdat: createdAt,
  }]);
}

async function getDonationById(donationId) {
  const { data, error } = await supabase
    .from('donation_records')
    .select('*')
    .eq('id', donationId)
    .single();
  if (error || !data) return null;
  return normalizeDonationRow(data);
}

function normalizeDonationRow(row) {
  if (!row) return null;
  const estimatedUnitValue = getFirstDefined(row, ['estimatedUnitValue', 'estimatedunitvalue']);
  const estimatedTotalValue = getFirstDefined(row, ['estimatedTotalValue', 'estimatedtotalvalue']);
  return {
    ...row,
    donorOrgId: getFirstDefined(row, ['donorOrgId', 'donororgid']) || '',
    donorLocationId: getFirstDefined(row, ['donorLocationId', 'donorlocationid']) || '',
    recipientOrgId: getFirstDefined(row, ['recipientOrgId', 'recipientorgid']) || '',
    productName: getFirstDefined(row, ['productName', 'productname']) || '',
    productBrand: getFirstDefined(row, ['productBrand', 'productbrand']) || '',
    productCategory: getFirstDefined(row, ['productCategory', 'productcategory']) || 'food',
    estimatedUnitValue: estimatedUnitValue === null || estimatedUnitValue === undefined ? null : Number(estimatedUnitValue),
    estimatedTotalValue: estimatedTotalValue === null || estimatedTotalValue === undefined ? null : Number(estimatedTotalValue),
    conditionNotes: getFirstDefined(row, ['conditionNotes', 'conditionnotes']) || '',
    expiresAt: getFirstDefined(row, ['expiresAt', 'expiresat']) || '',
    pickupWindowStart: getFirstDefined(row, ['pickupWindowStart', 'pickupwindowstart']) || '',
    pickupWindowEnd: getFirstDefined(row, ['pickupWindowEnd', 'pickupwindowend']) || '',
    acceptedAt: getFirstDefined(row, ['acceptedAt', 'acceptedat']) || '',
    declinedAt: getFirstDefined(row, ['declinedAt', 'declinedat']) || '',
    receivedAt: getFirstDefined(row, ['receivedAt', 'receivedat']) || '',
    createdByUserId: getFirstDefined(row, ['createdByUserId', 'createdbyuserid']) || '',
    createdAt: getFirstDefined(row, ['createdAt', 'createdat']) || '',
    updatedAt: getFirstDefined(row, ['updatedAt', 'updatedat']) || '',
  };
}

async function buildDonationAcknowledgment(donation) {
  const donationId = String(getFirstDefined(donation, ['id']) || '');
  const donorOrgId = String(getFirstDefined(donation, ['donorOrgId', 'donororgid']) || '');
  const recipientOrgId = String(getFirstDefined(donation, ['recipientOrgId', 'recipientorgid']) || '');
  const [
    { data: users, error: usersError },
    { data: handoff, error: handoffError },
    { data: confirmationEvent, error: confirmationError },
  ] = await Promise.all([
    supabase.from('users').select('*').in('id', [donorOrgId, recipientOrgId]),
    supabase
      .from('donation_handoffs')
      .select('*')
      .eq('donationId', donationId)
      .not('usedAt', 'eq', '')
      .order('usedAt', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('donation_events')
      .select('*')
      .eq('donationId', donationId)
      .eq('eventType', 'handoff_confirmed')
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (usersError || handoffError || confirmationError) {
    throw new Error(explainSupabaseError(usersError || handoffError || confirmationError));
  }
  if (!handoff) {
    return null;
  }

  const normalizedUsers = (users || []).map(normalizeUserRow);
  const donor = normalizedUsers.find((user) => user?.id === donorOrgId);
  const recipient = normalizedUsers.find((user) => user?.id === recipientOrgId);
  const receivedAt = String(getFirstDefined(handoff, ['usedAt', 'usedat']) || getFirstDefined(donation, ['receivedAt', 'receivedat']) || '');
  const confirmationPayload = parseJsonSafe(getFirstDefined(confirmationEvent, ['payloadJson', 'payloadjson']), {});
  const estimatedUnitValue = Number(getFirstDefined(donation, ['estimatedUnitValue', 'estimatedunitvalue']) || 0);
  const receivedQuantity = Number(getFirstDefined(handoff, ['receivedQuantity', 'receivedquantity']) || getFirstDefined(donation, ['quantity']) || 0);

  return {
    acknowledgmentId: `BRISIO-${donationId.toUpperCase()}`,
    donationId,
    receivedAt,
    donor: {
      name: donor?.organizationName || donor?.displayName || 'Donor organization',
      location: donor?.location || '',
    },
    recipient: {
      name: recipient?.organizationName || recipient?.displayName || 'Recipient organization',
      location: recipient?.location || '',
    },
    item: {
      name: String(getFirstDefined(donation, ['productName', 'productname']) || 'Donated inventory'),
      brand: String(getFirstDefined(donation, ['productBrand', 'productbrand']) || ''),
      category: String(getFirstDefined(donation, ['productCategory', 'productcategory']) || 'food'),
      upc: String(getFirstDefined(donation, ['upc']) || ''),
      gtin: String(getFirstDefined(donation, ['gtin']) || ''),
      quantity: receivedQuantity,
      unit: String(getFirstDefined(handoff, ['receivedUnit', 'receivedunit']) || getFirstDefined(donation, ['unit']) || 'units'),
      conditionNotes: String(getFirstDefined(donation, ['conditionNotes', 'conditionnotes']) || ''),
    },
    donorReportedValue: {
      unitValue: estimatedUnitValue,
      totalValue: Number((estimatedUnitValue * receivedQuantity).toFixed(2)),
      currency: String(getFirstDefined(donation, ['currency']) || 'USD'),
    },
    receiptNote: String(getFirstDefined(handoff, ['receiptNote', 'receiptnote']) || ''),
    certification: {
      confirmedByRecipientUserId: String(getFirstDefined(handoff, ['receivedByUserId', 'receivedbyuserid']) || ''),
      foodUseCertified: confirmationPayload.foodUseCertified === true,
      noGoodsOrServicesProvided: confirmationPayload.noGoodsOrServicesProvided === true,
    },
  };
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

function normalizeListingRow(row) {
  if (!row) return null;
  return {
    ...row,
    businessName: getFirstDefined(row, ['businessName', 'businessname']) || '',
    ownerUserId: getFirstDefined(row, ['ownerUserId', 'owneruserid']) || '',
    deliverWithinHours: getFirstDefined(row, ['deliverWithinHours', 'deliverwithinhours']),
    offerClosesAt: getFirstDefined(row, ['offerClosesAt', 'offerclosesat']) || '',
    urgencyLevel: getFirstDefined(row, ['urgencyLevel', 'urgencylevel']) || 'normal',
    resourceName: getFirstDefined(row, ['resourceName', 'resourcename']) || '',
    resourceType: getFirstDefined(row, ['resourceType', 'resourcetype']) || '',
    availabilityNotes: getFirstDefined(row, ['availabilityNotes', 'availabilitynotes']) || '',
    isPrivate: Number(getFirstDefined(row, ['isPrivate', 'isprivate']) || 0),
    targetOrganizationId: getFirstDefined(row, ['targetOrganizationId', 'targetorganizationid']) || '',
    createdAt: getFirstDefined(row, ['createdAt', 'createdat']) || '',
    updatedAt: getFirstDefined(row, ['updatedAt', 'updatedat']) || '',
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

function publicLocation(value) {
  const parts = String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 4 && /^\d{5}(?:-\d{4})?$/.test(parts.at(-1))) {
    return `${parts.at(-3)}, ${parts.at(-2)}`;
  }
  if (parts.length >= 3) {
    return `${parts.at(-2)}, ${parts.at(-1)}`;
  }
  return parts.join(', ');
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

  let blockedUserIds = new Set();
  if (user?.id) {
    const { data: blockedRows, error: blockedError } = await supabase
      .from('blocks')
      .select('blockedUserId, blockeduserid')
      .eq('blockerUserId', user.id);

    if (blockedError) throw blockedError;
    blockedUserIds = new Set((blockedRows || []).map((row) => getFirstDefined(row, ['blockedUserId', 'blockeduserid'])).filter(Boolean));
  }

  const normalizedListings = listings
    .map(normalizeListingRow)
    .filter((listing) => {
      return isListingVisibleToUser(listing, user) && !isListingExpired(listing) && (!listing.ownerUserId || !blockedUserIds.has(listing.ownerUserId));
    });

  const ownerIds = [...new Set(normalizedListings.map((listing) => listing.ownerUserId).filter(Boolean))];
  if (ownerIds.length === 0) return normalizedListings;

  const { data: ownerRows, error: ownerError } = await supabase
    .from('users')
    .select('*')
    .in('id', ownerIds);
  if (ownerError) throw ownerError;

  const ownersById = new Map((ownerRows || []).map((row) => {
    const owner = normalizeUserRow(row);
    return [owner.id, owner];
  }));
  return normalizedListings.map((listing) => {
    const owner = ownersById.get(listing.ownerUserId);
    if (!owner) return listing;
    return {
      ...listing,
      businessName: owner.organizationName || owner.displayName || listing.businessName,
      location: owner.location || listing.location,
    };
  });
}

async function getBlockedUsersForUser(userId) {
  const { data, error } = await supabase
    .from('blocks')
    .select('id, blockerUserId, blockedUserId, createdAt')
    .eq('blockerUserId', userId)
    .order('createdAt', { ascending: false });

  if (error) throw error;
  return data || [];
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

const SAMPLE_PRODUCT_CATALOG = {
  '012345678905': {
    gtin: '00012345678905',
    upc: '012345678905',
    name: 'Honey Oat Cereal',
    brand: 'Example Foods',
    category: 'food',
  },
  '041196910103': {
    gtin: '00041196910103',
    upc: '041196910103',
    name: 'Peanut Butter Crackers',
    brand: 'Snack Co',
    category: 'food',
  },
  '036000291452': {
    gtin: '00036000291452',
    upc: '036000291452',
    name: 'Canned Soup',
    brand: 'Kitchen Pantry',
    category: 'food',
  },
};

const productLookupCache = new Map();
const PRODUCT_LOOKUP_CACHE_MS = 24 * 60 * 60 * 1000;
const PRODUCT_LOOKUP_NO_PRICE_CACHE_MS = 5 * 60 * 1000;

async function fetchProductJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Brisio/1.0 product lookup' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  return response.json();
}

function medianPrice(values) {
  const prices = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!prices.length) return null;
  const middle = Math.floor(prices.length / 2);
  const value = prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2;
  return Number(value.toFixed(2));
}

async function lookupExternalProduct(barcode) {
  const cached = productLookupCache.get(barcode);
  if (cached?.expiresAt > Date.now()) return cached.value;

  let openFoodFacts = null;
  let openPrices = null;
  try {
    [openFoodFacts, openPrices] = await Promise.all([
      fetchProductJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=code,product_name,brands,categories_tags`),
      fetchProductJson(`https://prices.openfoodfacts.org/api/v1/prices?product_code=${encodeURIComponent(barcode)}&page_size=20`),
    ]);
  } catch (err) {
    console.warn('Open Food Facts lookup failed:', err.message);
  }

  const openProduct = openFoodFacts?.status === 1 ? openFoodFacts.product : null;
  const usdPrices = (openPrices?.items || [])
    .filter((item) => item.currency === 'USD')
    .map((item) => Number(item.price));
  let estimatedUnitValue = medianPrice(usdPrices);
  let priceSource = estimatedUnitValue ? 'Open Prices observed USD price' : '';
  let upcItem = null;

  if (!openProduct?.product_name || !openProduct?.brands || !estimatedUnitValue) {
    try {
      const upcResponse = await fetchProductJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`);
      upcItem = upcResponse?.items?.[0] || null;
      if (!estimatedUnitValue && upcItem) {
        const recentCutoff = Math.floor(Date.now() / 1000) - (2 * 365 * 24 * 60 * 60);
        const availableOffers = (upcItem.offers || [])
          .filter((offer) => Number(offer.updated_t || 0) >= recentCutoff && !/out of stock/i.test(String(offer.availability || '')))
        const recentOfferPrices = availableOffers.map((offer) => Number(offer.price));
        estimatedUnitValue = medianPrice(recentOfferPrices);
        if (estimatedUnitValue) {
          priceSource = 'UPCitemdb recent retailer estimate';
        } else {
          const historicalOfferPrices = (upcItem.offers || [])
            .filter((offer) => !/out of stock/i.test(String(offer.availability || '')))
            .map((offer) => Number(offer.price));
          estimatedUnitValue = medianPrice(historicalOfferPrices);
          if (estimatedUnitValue) priceSource = 'UPCitemdb historical retailer estimate';
        }
      }
    } catch (err) {
      console.warn('UPCitemdb lookup failed:', err.message);
    }
  }

  const name = String(openProduct?.product_name || upcItem?.title || '').trim();
  const brand = String(openProduct?.brands || upcItem?.brand || '').split(',')[0].trim();
  const value = name ? {
    gtin: normalizeGtinFromBarcode(barcode),
    upc: barcode,
    name,
    brand: brand || 'Brand not listed',
    category: openProduct ? 'food' : detectCategory(`${upcItem?.category || ''} ${name}`),
    estimatedUnitValue: estimatedUnitValue || undefined,
    priceSource: priceSource || undefined,
  } : null;

  if (productLookupCache.size >= 500) productLookupCache.clear();
  productLookupCache.set(barcode, {
    expiresAt: Date.now() + (value?.estimatedUnitValue ? PRODUCT_LOOKUP_CACHE_MS : PRODUCT_LOOKUP_NO_PRICE_CACHE_MS),
    value,
  });
  return value;
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

app.get('/support', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'support.html'));
});

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
    res.json({
      success: true,
      token,
      user: {
        id: userId,
        email,
        role,
        displayName: name,
        organizationName: organizationName || '',
        location: location || '',
        createdAt,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, error: explainSupabaseError(err) });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ success: false, error: 'email is required' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.json({ success: true, message: 'If the email exists, a reset code has been sent.' });
    }

    const resetCode = generateResetCode();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();
    const codeHash = hashResetCode(resetCode);

    await clearExistingResetTokens(user.id);
    const { error: insertError } = await supabase.from('password_reset_tokens').insert([{
      id: crypto.randomUUID(),
      userId: user.id,
      userid: user.id,
      codeHash,
      codehash: codeHash,
      createdAt,
      createdat: createdAt,
      expiresAt,
      expiresat: expiresAt,
      usedAt: null,
      usedat: null,
    }]);

    if (insertError) {
      return res.status(500).json({ success: false, error: explainSupabaseError(insertError) });
    }

    const emailResult = await sendResetCodeEmail({
      to: user.email,
      resetCode,
      expiresAt,
    });

    appendInstrumentation({
      type: 'forgot-password',
      userId: user.id,
      email: user.email,
      emailSent: Boolean(emailResult?.sent),
    });

    if (!emailResult?.sent) {
      await clearExistingResetTokens(user.id);
      return res.status(500).json({
        success: false,
        error: 'Unable to send reset code email right now. Please try again in a minute.',
      });
    }

    const payload = {
      success: true,
      message: 'If the email exists, a reset code has been sent.',
      expiresAt,
    };
    if (includeResetCodeInResponse) {
      payload.resetCode = resetCode;
    }

    res.json(payload);
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, error: explainSupabaseError(err) });
  }
});

app.post('/api/auth/verify-reset-code', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const resetCode = String(req.body?.resetCode || '').trim();

    if (!email || !resetCode) {
      return res.status(400).json({ success: false, error: 'email and resetCode are required' });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(400).json({ success: false, error: 'Invalid reset code' });
    }

    const { tokenRow, error: tokenError, validationError } = await getActiveResetTokenForUser(user.id);
    if (tokenError) {
      return res.status(500).json({ success: false, error: explainSupabaseError(tokenError) });
    }
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const expectedHash = getFirstDefined(tokenRow, ['codeHash', 'codehash']);
    if (hashResetCode(resetCode) !== expectedHash) {
      return res.status(400).json({ success: false, error: 'Invalid reset code' });
    }

    res.json({ success: true, message: 'Reset code verified.' });
  } catch (err) {
    console.error('Verify reset code error:', err);
    res.status(500).json({ success: false, error: explainSupabaseError(err) });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const resetCode = String(req.body?.resetCode || '').trim();
    const password = String(req.body?.password || '');

    if (!email || !resetCode || !password) {
      return res.status(400).json({ success: false, error: 'email, resetCode, and password are required' });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ success: false, error: passwordError });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(400).json({ success: false, error: 'Invalid reset code' });
    }

    const { tokenRow, error: tokenError, validationError } = await getActiveResetTokenForUser(user.id);
    if (tokenError) {
      return res.status(500).json({ success: false, error: explainSupabaseError(tokenError) });
    }
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const expectedHash = getFirstDefined(tokenRow, ['codeHash', 'codehash']);
    if (hashResetCode(resetCode) !== expectedHash) {
      return res.status(400).json({ success: false, error: 'Invalid reset code' });
    }

    const passwordHash = hashPassword(password);
    const { error: updateError } = await supabase
      .from('users')
      .update({ passwordHash, passwordhash: passwordHash })
      .eq('id', user.id);

    if (updateError) {
      return res.status(500).json({ success: false, error: explainSupabaseError(updateError) });
    }

    const usedAt = new Date().toISOString();
    await supabase
      .from('password_reset_tokens')
      .update({ usedAt, usedat: usedAt })
      .eq('id', getFirstDefined(tokenRow, ['id']));
    await supabase.from('sessions').delete().eq('userId', user.id);

    appendInstrumentation({ type: 'reset-password', userId: user.id, email: user.email });
    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset password error:', err);
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
      .maybeSingle();

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

    let listings = (await getVisibleActiveListings(req.user))
      .filter((listing) => listing.type === 'supply');
    if (req.user.role === 'organization' && listings.length > 0) {
      const responseIds = listings.map((listing) => listingResponseDonationId(listing.id, req.user.id));
      const { data: responses, error: responseError } = await supabase
        .from('donation_records')
        .select('id')
        .in('id', responseIds);
      if (responseError && !isMissingDonationRecordsTableError(responseError)) {
        throw responseError;
      }
      const respondedIds = new Set((responses || []).map((response) => response.id));
      listings = listings.filter((listing) => !respondedIds.has(listingResponseDonationId(listing.id, req.user.id)));
    }
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
    if (req.user.role !== 'business') {
      return res.status(403).json({ success: false, error: 'Only business accounts can create listings.' });
    }

    const { category, description, contact, urgent, deliverWithinHours, offerClosesAt, urgencyLevel, resourceName, resourceType, quantity, availabilityNotes, isPrivate, targetOrganizationId } = req.body;
    const type = 'supply';
    const businessName = req.user.organizationName || req.user.displayName;
    const location = String(req.user.location || '').trim();

    if (!description) {
      return res.status(400).json({ success: false, error: 'description is required' });
    }

    const now = new Date().toISOString();
    const normalizedDescription = String(description).trim();
    const detectedCategory = String(category || detectCategory(normalizedDescription)).trim();
    const normalizedContact = String(contact || '').trim();
    const normalizedAvailabilityNotes = String(availabilityNotes || '').trim();
    const duplicateCutoff = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: recentListings } = await supabase
      .from('listings')
      .select('*')
      .eq('ownerUserId', req.user.id)
      .gte('createdAt', duplicateCutoff)
      .order('createdAt', { ascending: false })
      .limit(10);
    const duplicate = (recentListings || []).find((listing) => (
      String(getFirstDefined(listing, ['category']) || '').trim() === detectedCategory
      && String(getFirstDefined(listing, ['description']) || '').trim() === normalizedDescription
      && String(getFirstDefined(listing, ['contact']) || '').trim() === normalizedContact
      && String(getFirstDefined(listing, ['availabilityNotes', 'availabilitynotes']) || '').trim() === normalizedAvailabilityNotes
    ));
    if (duplicate) {
      return res.json({ success: true, listingId: duplicate.id, duplicatePrevented: true });
    }

    const listingId = crypto.randomUUID();

    const { error } = await supabase.from('listings').insert([{
      id: listingId,
      type,
      category: detectedCategory,
      businessName,
      businessname: businessName,
      description: normalizedDescription,
      contact: normalizedContact,
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
      availabilityNotes: normalizedAvailabilityNotes,
      availabilitynotes: normalizedAvailabilityNotes,
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

app.post('/api/listings/:id/respond', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;
    if (req.user.role !== 'organization') {
      return res.status(403).json({ success: false, error: 'Only nonprofit accounts can respond to listings.' });
    }

    const action = String(req.body?.action || '').trim().toLowerCase();
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ success: false, error: 'action must be accept or decline' });
    }

    const { data: listingRow, error: listingError } = await supabase
      .from('listings')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (listingError || !listingRow) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    const listing = normalizeListingRow(listingRow);
    if (listing.type !== 'supply' || Number(listing.active) !== 1 || isListingExpired(listing)) {
      return res.status(409).json({ success: false, error: 'This business listing is no longer available.' });
    }
    if (!isListingVisibleToUser(listing, req.user)) {
      return res.status(403).json({ success: false, error: 'You cannot respond to this listing.' });
    }

    const donationId = listingResponseDonationId(listing.id, req.user.id);
    const { data: existingResponse } = await supabase
      .from('donation_records')
      .select('id, status')
      .eq('id', donationId)
      .maybeSingle();
    if (existingResponse) {
      return res.status(409).json({ success: false, error: `Your nonprofit already ${existingResponse.status} this listing.` });
    }

    const now = new Date().toISOString();
    const listedQuantity = Number.parseFloat(String(listing.quantity || '').replace(/[^0-9.]/g, ''));
    const quantity = Number.isFinite(listedQuantity) && listedQuantity > 0 ? listedQuantity : 1;
    const productName = String(listing.resourceName || listing.category || 'Listed resource').trim();
    const unit = String(listing.resourceType || 'listing').trim() || 'listing';
    const status = action === 'accept' ? 'accepted' : 'declined';
    const row = {
      id: donationId,
      donorOrgId: listing.ownerUserId,
      donororgid: listing.ownerUserId,
      donorLocationId: listing.location || '',
      donorlocationid: listing.location || '',
      recipientOrgId: req.user.id,
      recipientorgid: req.user.id,
      status,
      gtin: '',
      upc: '',
      productName,
      productname: productName,
      productBrand: listing.businessName || '',
      productbrand: listing.businessName || '',
      productCategory: listing.category || 'other',
      productcategory: listing.category || 'other',
      quantity,
      unit,
      estimatedUnitValue: null,
      estimatedunitvalue: null,
      estimatedTotalValue: null,
      estimatedtotalvalue: null,
      currency: 'USD',
      conditionNotes: listing.description || '',
      conditionnotes: listing.description || '',
      expiresAt: listing.offerClosesAt || '',
      expiresat: listing.offerClosesAt || '',
      pickupWindowStart: '',
      pickupwindowstart: '',
      pickupWindowEnd: '',
      pickupwindowend: '',
      acceptedAt: action === 'accept' ? now : '',
      acceptedat: action === 'accept' ? now : '',
      declinedAt: action === 'decline' ? now : '',
      declinedat: action === 'decline' ? now : '',
      createdByUserId: listing.ownerUserId,
      createdbyuserid: listing.ownerUserId,
      createdAt: now,
      createdat: now,
      updatedAt: now,
      updatedat: now,
    };

    if (action === 'accept') {
      const { data: reservedListings, error: reserveError } = await supabase
        .from('listings')
        .update({ active: 0, updatedAt: now, updatedat: now })
        .eq('id', listing.id)
        .eq('active', 1)
        .select('id');
      if (reserveError) {
        return res.status(500).json({ success: false, error: explainSupabaseError(reserveError) });
      }
      if (!reservedListings?.length) {
        return res.status(409).json({ success: false, error: 'Another nonprofit has already accepted this listing.' });
      }
    }

    const { error: responseError } = await supabase.from('donation_records').insert([row]);
    if (responseError) {
      if (action === 'accept') {
        await supabase
          .from('listings')
          .update({ active: 1, updatedAt: now, updatedat: now })
          .eq('id', listing.id);
      }
      return res.status(500).json({ success: false, error: explainSupabaseError(responseError) });
    }

    await appendDonationEvent({
      donationId,
      eventType: status,
      actorUserId: req.user.id,
      actorRole: req.user.role,
      payload: { sourceListingId: listing.id, businessName: listing.businessName },
    });

    res.json({ success: true, action, donationId });
  } catch (err) {
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

    const normalizedListing = normalizeListingRow(listing);
    if (!isListingVisibleToUser(normalizedListing, req.user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    res.json({ success: true, listing: normalizedListing });
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

    const allowedFields = [
      'category',
      'description',
      'contact',
      'urgent',
      'active',
      'deliverWithinHours',
      'offerClosesAt',
      'urgencyLevel',
      'resourceName',
      'resourceType',
      'quantity',
      'availabilityNotes',
      'isPrivate',
      'targetOrganizationId',
    ];
    const updateData = Object.fromEntries(
      allowedFields
        .filter((field) => Object.hasOwn(req.body || {}, field))
        .map((field) => [field, req.body[field]])
    );
    if (Object.hasOwn(updateData, 'description') && !String(updateData.description || '').trim()) {
      return res.status(400).json({ success: false, error: 'description cannot be empty' });
    }
    updateData.updatedAt = new Date().toISOString();

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

    const ownerUserId = String(listing.ownerUserId || listing.owneruserid || '');
    if (ownerUserId !== req.user.id) {
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
app.get('/api/health', (req, res) => {
  res.json({ success: true });
});

app.get('/api/stats', async (req, res) => {
  try {
    const { data: listings } = await supabase.from('listings').select('type, urgent, active');
    const { data: users } = await supabase.from('users').select('role');
    const activeListings = listings?.filter(l => l.active === 1) || [];

    const stats = {
      totalListings: listings?.length || 0,
      activeListings: activeListings.length,
      supplyListings: activeListings.filter(l => l.type === 'supply').length,
      demandListings: activeListings.filter(l => l.type === 'demand').length,
      urgentListings: listings?.filter(l => l.urgent === 1).length || 0,
      totalUsers: users?.length || 0,
      businessUsers: users?.filter(u => u.role === 'business').length || 0,
      organizationUsers: users?.filter(u => u.role === 'organization').length || 0,
      total: activeListings.length,
      supply: activeListings.filter(l => l.type === 'supply').length,
      demand: activeListings.filter(l => l.type === 'demand').length
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
        location: publicLocation(user.location),
      };
    });

    res.json({ success: true, organizations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/donation-recipients', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;
    if (req.user.role !== 'business') {
      return res.status(403).json({ success: false, error: 'Only business users can select donation recipients.' });
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'organization')
      .limit(200);
    if (error) return res.status(500).json({ success: false, error: explainSupabaseError(error) });

    const organizations = (data || []).map((row) => {
      const user = normalizeUserRow(row);
      return {
        id: user.id,
        displayName: user.displayName,
        organizationName: user.organizationName || user.displayName,
        location: publicLocation(user.location),
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
      location: publicLocation(location || req.user.location),
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
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const listingId = String(req.body?.listingId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const details = String(req.body?.details || '').trim();

    if (!listingId) {
      return res.status(400).json({ success: false, error: 'listingId is required' });
    }
    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason is required' });
    }

    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, ownerUserId, owneruserid, businessName')
      .eq('id', listingId)
      .single();

    if (listingError || !listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    const reportId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const { error } = await supabase.from('reports').insert([{
      id: reportId,
      listingId,
      listingid: listingId,
      reporterName: req.user.displayName,
      reportername: req.user.displayName,
      reason,
      details,
      createdAt,
      createdat: createdAt,
    }]);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    appendInstrumentation({ type: 'report_listing', userId: req.user.id, listingId, reason });
    res.json({ success: true, reportId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/reports', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('createdAt', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, reports: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/blocks', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const blockedUsers = await getBlockedUsersForUser(req.user.id);
    res.json({ success: true, blockedUsers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/blocks', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const blockedUserId = String(req.body?.blockedUserId || '').trim();
    if (!blockedUserId) {
      return res.status(400).json({ success: false, error: 'blockedUserId is required' });
    }
    if (blockedUserId === req.user.id) {
      return res.status(400).json({ success: false, error: 'You cannot block yourself' });
    }

    const { data: existingBlock, error: existingError } = await supabase
      .from('blocks')
      .select('id')
      .eq('blockerUserId', req.user.id)
      .eq('blockedUserId', blockedUserId)
      .maybeSingle();

    if (existingError) {
      return res.status(500).json({ success: false, error: existingError.message });
    }
    if (existingBlock) {
      return res.json({ success: true, blocked: true });
    }

    const { data: targetUser, error: targetError } = await supabase
      .from('users')
      .select('id')
      .eq('id', blockedUserId)
      .single();

    if (targetError || !targetUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const now = new Date().toISOString();
    const { error } = await supabase.from('blocks').insert([{
      id: crypto.randomUUID(),
      blockerUserId: req.user.id,
      blockeruserid: req.user.id,
      blockedUserId,
      blockeduserid: blockedUserId,
      createdAt: now,
      createdat: now,
    }]);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    appendInstrumentation({ type: 'block_user', userId: req.user.id, blockedUserId });
    res.json({ success: true, blocked: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/blocks/:blockedUserId', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const blockedUserId = String(req.params.blockedUserId || '').trim();
    if (!blockedUserId) {
      return res.status(400).json({ success: false, error: 'blockedUserId is required' });
    }

    const { error } = await supabase
      .from('blocks')
      .delete()
      .eq('blockerUserId', req.user.id)
      .eq('blockedUserId', blockedUserId);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, blocked: false });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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

    const { data: reports } = await supabase.from('reports').select('id');
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

// Resource Scan and Donation Endpoints
app.post('/api/products/lookup', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const barcode = normalizeBarcode(req.body?.barcode || '');
    if (!barcode) {
      return res.status(400).json({ success: false, error: 'barcode is required' });
    }

    const externalProduct = await lookupExternalProduct(barcode);
    const fromCatalog = externalProduct ? null : SAMPLE_PRODUCT_CATALOG[barcode];
    const product = externalProduct || fromCatalog || {
      gtin: normalizeGtinFromBarcode(barcode),
      upc: barcode,
      name: `Scanned item ${barcode}`,
      brand: 'Brand not found',
      category: 'food',
    };

    res.json({ success: true, product, source: externalProduct ? 'product-databases' : fromCatalog ? 'sample-catalog' : 'fallback' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/donations', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    if (req.user.role !== 'business') {
      return res.status(403).json({ success: false, error: 'Only business users can create donation records.' });
    }

    const donation = req.body || {};
    const recipientOrgId = String(donation.recipientOrgId || '').trim();
    const donorLocationId = String(donation.donorLocationId || '').trim();
    const quantity = Number(donation.quantity || 0);
    const item = donation.item || {};
    const productName = String(item.name || '').trim();

    if (!donorLocationId || !productName || !Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({
        success: false,
        error: 'donorLocationId, item.name, and a positive quantity are required',
      });
    }

    if (recipientOrgId) {
      const { data: recipient, error: recipientError } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', recipientOrgId)
        .single();

      if (recipientError || !recipient || String(recipient.role) !== 'organization') {
        return res.status(400).json({ success: false, error: 'recipientOrgId must reference an organization account' });
      }
    }

    const id = `don_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const unit = String(donation.unit || 'units').trim() || 'units';
    const estimatedUnitValue = donation.estimatedUnitValue === undefined || donation.estimatedUnitValue === null
      ? null
      : Number(donation.estimatedUnitValue);
    const estimatedTotalValue = Number.isFinite(estimatedUnitValue) ? Number((estimatedUnitValue * quantity).toFixed(2)) : null;

    const row = {
      id,
      donorOrgId: req.user.id,
      donororgid: req.user.id,
      donorLocationId: donorLocationId,
      donorlocationid: donorLocationId,
      recipientOrgId: recipientOrgId,
      recipientorgid: recipientOrgId,
      status: 'posted',
      gtin: String(item.gtin || normalizeGtinFromBarcode(item.upc || '')),
      upc: String(item.upc || ''),
      productName,
      productname: productName,
      productBrand: String(item.brand || ''),
      productbrand: String(item.brand || ''),
      productCategory: String(item.category || 'food'),
      productcategory: String(item.category || 'food'),
      quantity,
      unit,
      estimatedUnitValue: Number.isFinite(estimatedUnitValue) ? estimatedUnitValue : null,
      estimatedunitvalue: Number.isFinite(estimatedUnitValue) ? estimatedUnitValue : null,
      estimatedTotalValue,
      estimatedtotalvalue: estimatedTotalValue,
      currency: String(donation.currency || 'USD'),
      conditionNotes: String(donation.conditionNotes || ''),
      conditionnotes: String(donation.conditionNotes || ''),
      expiresAt: String(donation.expiresAt || ''),
      expiresat: String(donation.expiresAt || ''),
      pickupWindowStart: String(donation.pickupWindowStart || ''),
      pickupwindowstart: String(donation.pickupWindowStart || ''),
      pickupWindowEnd: String(donation.pickupWindowEnd || ''),
      pickupwindowend: String(donation.pickupWindowEnd || ''),
      createdByUserId: req.user.id,
      createdbyuserid: req.user.id,
      createdAt: now,
      createdat: now,
      updatedAt: now,
      updatedat: now,
    };

    const { error } = await supabase.from('donation_records').insert([row]);
    if (error) {
      return res.status(500).json({ success: false, error: explainSupabaseError(error) });
    }

    await appendDonationEvent({
      donationId: id,
      eventType: 'posted',
      actorUserId: req.user.id,
      actorRole: req.user.role,
      payload: { quantity, unit, recipientOrgId },
    });

    res.json({ success: true, donation: { id, status: 'posted', createdAt: now } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/donations', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    let query = supabase.from('donation_records').select('*').order('createdAt', { ascending: false }).limit(200);
    if (req.query.status) {
      query = query.eq('status', String(req.query.status));
    }
    if (req.user.role === 'business') {
      query = query.eq('createdByUserId', req.user.id);
    }
    if (req.user.role === 'organization') {
      query = query.eq('recipientOrgId', req.user.id);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingDonationRecordsTableError(error)) {
        return res.json({ success: true, donations: [] });
      }
      return res.status(500).json({ success: false, error: explainSupabaseError(error) });
    }

    const donations = (data || []).map(normalizeDonationRow);
    const recipientIds = [...new Set(
      donations
        .map((donation) => String(getFirstDefined(donation, ['recipientOrgId', 'recipientorgid']) || ''))
        .filter(Boolean)
    )];
    const { data: recipientRows } = recipientIds.length
      ? await supabase.from('users').select('*').in('id', recipientIds)
      : { data: [] };
    const recipientNames = new Map((recipientRows || []).map((row) => {
      const user = normalizeUserRow(row);
      return [user.id, user.organizationName || user.displayName];
    }));

    res.json({
      success: true,
      donations: donations.map((donation) => ({
        ...donation,
        recipientName: recipientNames.get(String(getFirstDefined(donation, ['recipientOrgId', 'recipientorgid']) || '')) || 'Not assigned yet',
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/donations/impact-summary', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    let query = supabase.from('donation_records').select('status, quantity, estimatedTotalValue, recipientOrgId');
    if (req.user.role === 'business') {
      query = query.eq('createdByUserId', req.user.id);
    }
    if (req.user.role === 'organization') {
      query = query.eq('recipientOrgId', req.user.id);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingDonationRecordsTableError(error)) {
        return res.json({
          success: true,
          summary: {
            itemsDonated: 0,
            estimatedInventoryValue: 0,
            recipientCount: 0,
            completedPickups: 0,
          },
        });
      }
      return res.status(500).json({ success: false, error: explainSupabaseError(error) });
    }

    const rows = data || [];
    const recipientSet = new Set(rows.map((r) => String(r.recipientOrgId || r.recipientorgid || '')).filter(Boolean));
    const summary = {
      itemsDonated: rows.reduce((acc, row) => acc + Number(row.quantity || 0), 0),
      estimatedInventoryValue: Number(rows.reduce((acc, row) => acc + Number(row.estimatedTotalValue || row.estimatedtotalvalue || 0), 0).toFixed(2)),
      recipientCount: recipientSet.size,
      completedPickups: rows.filter((r) => String(r.status) === 'received').length,
    };

    res.json({ success: true, summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/donations/export', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    let query = supabase.from('donation_records').select('*').order('createdAt', { ascending: false }).limit(500);
    if (req.user.role === 'business') {
      query = query.eq('createdByUserId', req.user.id);
    }
    if (req.user.role === 'organization') {
      query = query.eq('recipientOrgId', req.user.id);
    }
    const { data, error } = await query;
    if (error) {
      if (isMissingDonationRecordsTableError(error)) {
        if (String(req.query.format || 'json').toLowerCase() === 'csv') {
          res.type('text/csv');
          return res.send('id,status,productName,quantity,unit,estimatedTotalValue,createdAt,recipientOrgId\n');
        }
        return res.json({ success: true, donations: [] });
      }
      return res.status(500).json({ success: false, error: explainSupabaseError(error) });
    }

    const format = String(req.query.format || 'json').toLowerCase();
    if (format === 'csv') {
      const rows = data || [];
      const header = ['id', 'status', 'productName', 'quantity', 'unit', 'estimatedTotalValue', 'createdAt', 'recipientOrgId'];
      const lines = [header.join(',')];
      for (const row of rows) {
        const values = [
          getFirstDefined(row, ['id']),
          getFirstDefined(row, ['status']),
          getFirstDefined(row, ['productName', 'productname']),
          getFirstDefined(row, ['quantity']),
          getFirstDefined(row, ['unit']),
          getFirstDefined(row, ['estimatedTotalValue', 'estimatedtotalvalue']),
          getFirstDefined(row, ['createdAt', 'createdat']),
          getFirstDefined(row, ['recipientOrgId', 'recipientorgid']),
        ].map((v) => `"${String(v || '').replace(/"/g, '""')}"`);
        lines.push(values.join(','));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="donation-records.csv"');
      return res.send(lines.join('\n'));
    }

    res.json({ success: true, records: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/donations/:id', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const donation = await getDonationById(req.params.id);
    if (!donation) {
      return res.status(404).json({ success: false, error: 'Donation not found' });
    }

    const createdByUserId = String(getFirstDefined(donation, ['createdByUserId', 'createdbyuserid']));
    const recipientOrgId = String(getFirstDefined(donation, ['recipientOrgId', 'recipientorgid']));
    if (req.user.role !== 'admin' && createdByUserId !== req.user.id && recipientOrgId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { data: events } = await supabase
      .from('donation_events')
      .select('*')
      .eq('donationId', req.params.id)
      .order('createdAt', { ascending: true });

    const timeline = (events || []).map((event) => ({
      id: getFirstDefined(event, ['id']),
      eventType: getFirstDefined(event, ['eventType', 'eventtype']),
      actorUserId: getFirstDefined(event, ['actorUserId', 'actoruserid']),
      actorRole: getFirstDefined(event, ['actorRole', 'actorrole']),
      payload: parseJsonSafe(getFirstDefined(event, ['payloadJson', 'payloadjson']), {}),
      createdAt: getFirstDefined(event, ['createdAt', 'createdat']),
    }));

    res.json({ success: true, donation, timeline });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/donations/:id', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;
    if (req.user.role !== 'business') {
      return res.status(403).json({ success: false, error: 'Only business users can edit donation records.' });
    }

    const donation = await getDonationById(req.params.id);
    if (!donation) {
      return res.status(404).json({ success: false, error: 'Donation not found' });
    }
    const createdByUserId = String(getFirstDefined(donation, ['createdByUserId', 'createdbyuserid']));
    if (createdByUserId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'You can edit only donation records you created.' });
    }
    if (String(getFirstDefined(donation, ['status'])) !== 'posted') {
      return res.status(409).json({ success: false, error: 'Only records awaiting review can be edited.' });
    }

    const input = req.body || {};
    const productName = String(input.productName || '').trim();
    const productBrand = String(input.productBrand || '').trim();
    const productCategory = String(input.productCategory || 'food').trim() || 'food';
    const quantity = Number(input.quantity);
    const unit = String(input.unit || '').trim();
    const estimatedUnitValue = input.estimatedUnitValue === '' || input.estimatedUnitValue === null || input.estimatedUnitValue === undefined
      ? null
      : Number(input.estimatedUnitValue);
    const conditionNotes = String(input.conditionNotes || '').trim();
    const hasRecipientUpdate = Object.hasOwn(input, 'recipientOrgId');
    const recipientOrgId = hasRecipientUpdate
      ? String(input.recipientOrgId || '').trim()
      : String(getFirstDefined(donation, ['recipientOrgId', 'recipientorgid']) || '');

    if (!productName || !unit || !Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ success: false, error: 'Product name, unit, and a positive quantity are required.' });
    }
    if (estimatedUnitValue !== null && (!Number.isFinite(estimatedUnitValue) || estimatedUnitValue < 0)) {
      return res.status(400).json({ success: false, error: 'Estimated unit value must be zero or greater.' });
    }
    if (hasRecipientUpdate && recipientOrgId) {
      const { data: recipient, error: recipientError } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', recipientOrgId)
        .single();
      if (recipientError || !recipient || String(recipient.role) !== 'organization') {
        return res.status(400).json({ success: false, error: 'recipientOrgId must reference an organization account' });
      }
    }

    const estimatedTotalValue = estimatedUnitValue === null ? null : Number((estimatedUnitValue * quantity).toFixed(2));
    const now = new Date().toISOString();
    const updates = {
      productName,
      productname: productName,
      productBrand,
      productbrand: productBrand,
      productCategory,
      productcategory: productCategory,
      quantity,
      unit,
      estimatedUnitValue,
      estimatedunitvalue: estimatedUnitValue,
      estimatedTotalValue,
      estimatedtotalvalue: estimatedTotalValue,
      conditionNotes,
      conditionnotes: conditionNotes,
      ...(hasRecipientUpdate ? { recipientOrgId, recipientorgid: recipientOrgId } : {}),
      updatedAt: now,
      updatedat: now,
    };
    const { data: updated, error } = await supabase
      .from('donation_records')
      .update(updates)
      .eq('id', req.params.id)
      .eq('createdByUserId', req.user.id)
      .select('*')
      .single();
    if (error) {
      return res.status(500).json({ success: false, error: explainSupabaseError(error) });
    }

    await appendDonationEvent({
      donationId: req.params.id,
      eventType: 'updated',
      actorUserId: req.user.id,
      actorRole: req.user.role,
      payload: { productName, productBrand, productCategory, quantity, unit, estimatedUnitValue, conditionNotes, recipientOrgId },
    });

    res.json({ success: true, donation: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/donations/:id', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;
    if (req.user.role !== 'business') {
      return res.status(403).json({ success: false, error: 'Only business users can delete donation records.' });
    }

    const donation = await getDonationById(req.params.id);
    if (!donation) {
      return res.status(404).json({ success: false, error: 'Donation not found' });
    }
    const createdByUserId = String(getFirstDefined(donation, ['createdByUserId', 'createdbyuserid']));
    if (createdByUserId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'You can delete only donation records you created.' });
    }
    if (String(getFirstDefined(donation, ['status'])) !== 'posted') {
      return res.status(409).json({ success: false, error: 'Only records awaiting review can be deleted.' });
    }

    const { error: eventsError } = await supabase
      .from('donation_events')
      .delete()
      .eq('donationId', req.params.id);
    if (eventsError) {
      return res.status(500).json({ success: false, error: explainSupabaseError(eventsError) });
    }

    const { error } = await supabase
      .from('donation_records')
      .delete()
      .eq('id', req.params.id)
      .eq('createdByUserId', req.user.id);
    if (error) {
      return res.status(500).json({ success: false, error: explainSupabaseError(error) });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/donations/:id/acknowledgment', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const donation = await getDonationById(req.params.id);
    if (!donation) {
      return res.status(404).json({ success: false, error: 'Donation not found' });
    }

    const createdByUserId = String(getFirstDefined(donation, ['createdByUserId', 'createdbyuserid']));
    const recipientOrgId = String(getFirstDefined(donation, ['recipientOrgId', 'recipientorgid']));
    if (req.user.role !== 'admin' && createdByUserId !== req.user.id && recipientOrgId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    if (String(getFirstDefined(donation, ['status'])) !== 'received') {
      return res.status(409).json({ success: false, error: 'The acknowledgment is available after the handoff is confirmed.' });
    }

    const acknowledgment = await buildDonationAcknowledgment(donation);
    if (!acknowledgment) {
      return res.status(409).json({ success: false, error: 'The confirmed handoff record is unavailable.' });
    }

    res.json({ success: true, acknowledgment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/donations/:id/accept', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;
    if (req.user.role !== 'organization') {
      return res.status(403).json({ success: false, error: 'Only organization users can accept donations.' });
    }

    const donation = await getDonationById(req.params.id);
    if (!donation) {
      return res.status(404).json({ success: false, error: 'Donation not found' });
    }
    const recipientOrgId = String(getFirstDefined(donation, ['recipientOrgId', 'recipientorgid']));
    if (recipientOrgId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'This donation is assigned to a different organization.' });
    }
    if (String(donation.status) !== 'posted') {
      return res.status(400).json({ success: false, error: 'Only posted donations can be accepted.' });
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from('donation_records')
      .update({ status: 'accepted', acceptedAt: now, acceptedat: now, updatedAt: now, updatedat: now })
      .eq('id', req.params.id);
    if (error) {
      return res.status(500).json({ success: false, error: explainSupabaseError(error) });
    }

    await appendDonationEvent({
      donationId: req.params.id,
      eventType: 'accepted',
      actorUserId: req.user.id,
      actorRole: req.user.role,
      payload: { note: String(req.body?.note || '').trim() },
    });

    res.json({ success: true, status: 'accepted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/donations/:id/decline', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;
    if (req.user.role !== 'organization') {
      return res.status(403).json({ success: false, error: 'Only organization users can decline donations.' });
    }

    const donation = await getDonationById(req.params.id);
    if (!donation) {
      return res.status(404).json({ success: false, error: 'Donation not found' });
    }
    const recipientOrgId = String(getFirstDefined(donation, ['recipientOrgId', 'recipientorgid']));
    if (recipientOrgId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'This donation is assigned to a different organization.' });
    }
    if (String(donation.status) !== 'posted') {
      return res.status(400).json({ success: false, error: 'Only posted donations can be declined.' });
    }

    const now = new Date().toISOString();
    const reason = String(req.body?.reason || '').trim();
    const { error } = await supabase
      .from('donation_records')
      .update({ status: 'declined', declinedAt: now, declinedat: now, updatedAt: now, updatedat: now })
      .eq('id', req.params.id);
    if (error) {
      return res.status(500).json({ success: false, error: explainSupabaseError(error) });
    }

    await appendDonationEvent({
      donationId: req.params.id,
      eventType: 'declined',
      actorUserId: req.user.id,
      actorRole: req.user.role,
      payload: { reason },
    });

    res.json({ success: true, status: 'declined' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/donations/:id/handoff-token', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;

    const donation = await getDonationById(req.params.id);
    if (!donation) {
      return res.status(404).json({ success: false, error: 'Donation not found' });
    }

    const createdByUserId = String(getFirstDefined(donation, ['createdByUserId', 'createdbyuserid']));
    if (createdByUserId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only the donor can generate handoff tokens.' });
    }
    if (String(donation.status) !== 'accepted') {
      return res.status(400).json({ success: false, error: 'Donation must be accepted before generating a handoff token.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const tokenHash = hashResetCode(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60).toISOString();

    const { error: previousTokenError } = await supabase
      .from('donation_handoffs')
      .delete()
      .eq('donationId', req.params.id)
      .eq('usedAt', '');
    if (previousTokenError) {
      return res.status(500).json({ success: false, error: explainSupabaseError(previousTokenError) });
    }

    const { error } = await supabase.from('donation_handoffs').insert([{
      id: crypto.randomUUID(),
      donationId: req.params.id,
      donationid: req.params.id,
      handoffTokenHash: tokenHash,
      handofftokenhash: tokenHash,
      tokenExpiresAt: expiresAt,
      tokenexpiresat: expiresAt,
      usedAt: '',
      usedat: '',
      generatedByUserId: req.user.id,
      generatedbyuserid: req.user.id,
      createdAt: now.toISOString(),
      createdat: now.toISOString(),
    }]);
    if (error) {
      return res.status(500).json({ success: false, error: explainSupabaseError(error) });
    }

    await appendDonationEvent({
      donationId: req.params.id,
      eventType: 'handoff_token_generated',
      actorUserId: req.user.id,
      actorRole: req.user.role,
      payload: { tokenExpiresAt: expiresAt },
    });

    res.json({ success: true, handoffToken: token, expiresAt });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/donations/:id/confirm-handoff', async (req, res) => {
  try {
    await requireAuth(req, res, () => {});
    if (!req.user) return;
    if (req.user.role !== 'organization') {
      return res.status(403).json({ success: false, error: 'Only organization users can confirm handoff.' });
    }

    const donation = await getDonationById(req.params.id);
    if (!donation) {
      return res.status(404).json({ success: false, error: 'Donation not found' });
    }

    const recipientOrgId = String(getFirstDefined(donation, ['recipientOrgId', 'recipientorgid']));
    if (recipientOrgId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'This donation is assigned to a different organization.' });
    }
    if (String(donation.status) !== 'accepted') {
      return res.status(400).json({ success: false, error: 'Only accepted donations can be confirmed.' });
    }

    const handoffToken = String(req.body?.handoffToken || '').trim();
    if (!handoffToken) {
      return res.status(400).json({ success: false, error: 'handoffToken is required' });
    }

    const tokenHash = hashResetCode(handoffToken);
    const { data: handoff, error: handoffError } = await supabase
      .from('donation_handoffs')
      .select('*')
      .eq('donationId', req.params.id)
      .eq('handoffTokenHash', tokenHash)
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (handoffError || !handoff) {
      return res.status(400).json({ success: false, error: 'Invalid handoff token' });
    }

    const usedAt = getFirstDefined(handoff, ['usedAt', 'usedat']);
    const tokenExpiresAt = getFirstDefined(handoff, ['tokenExpiresAt', 'tokenexpiresat']);
    if (usedAt) {
      return res.status(400).json({ success: false, error: 'Handoff token has already been used' });
    }
    if (new Date(tokenExpiresAt).getTime() < Date.now()) {
      return res.status(400).json({ success: false, error: 'Handoff token expired' });
    }

    const receivedQuantity = Number(req.body?.receivedQuantity || donation.quantity || 0);
    const receivedUnit = String(req.body?.receivedUnit || donation.unit || 'units').trim() || 'units';
    const receiptNote = String(req.body?.receiptNote || '').trim();
    const foodUseCertified = req.body?.foodUseCertified === true;
    if (!foodUseCertified) {
      return res.status(400).json({ success: false, error: 'Confirm the food donation use statement before completing the handoff.' });
    }
    const now = new Date().toISOString();

    const { error: handoffUpdateError } = await supabase
      .from('donation_handoffs')
      .update({
        usedAt: now,
        usedat: now,
        receivedByUserId: req.user.id,
        receivedbyuserid: req.user.id,
        receivedQuantity,
        receivedquantity: receivedQuantity,
        receivedUnit,
        receivedunit: receivedUnit,
        receiptNote,
        receiptnote: receiptNote,
      })
      .eq('id', getFirstDefined(handoff, ['id']));

    if (handoffUpdateError) {
      return res.status(500).json({ success: false, error: explainSupabaseError(handoffUpdateError) });
    }

    const { error: donationUpdateError } = await supabase
      .from('donation_records')
      .update({ status: 'received', receivedAt: now, receivedat: now, updatedAt: now, updatedat: now })
      .eq('id', req.params.id);

    if (donationUpdateError) {
      return res.status(500).json({ success: false, error: explainSupabaseError(donationUpdateError) });
    }

    await appendDonationEvent({
      donationId: req.params.id,
      eventType: 'handoff_confirmed',
      actorUserId: req.user.id,
      actorRole: req.user.role,
      payload: {
        receivedQuantity,
        receivedUnit,
        receiptNote,
        foodUseCertified,
        noGoodsOrServicesProvided: true,
      },
    });

    const receivedDonation = { ...donation, status: 'received', receivedAt: now, receivedat: now };
    const acknowledgment = await buildDonationAcknowledgment(receivedDonation);
    res.json({ success: true, status: 'received', acknowledgment });
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Brisio backend running on port ${PORT}`);
  console.log(`Using Supabase: ${supabaseUrl}`);
});
