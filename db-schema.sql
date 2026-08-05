-- Brisio Database Schema for Supabase
-- Run this SQL in the Supabase SQL Editor to create all tables

-- Create listings table
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('supply','demand')),
  category TEXT NOT NULL,
  businessName TEXT NOT NULL,
  description TEXT NOT NULL,
  contact TEXT DEFAULT '',
  location TEXT DEFAULT '',
  urgent INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  ownerUserId TEXT DEFAULT '',
  deliverWithinHours INTEGER,
  offerClosesAt TEXT DEFAULT '',
  urgencyLevel TEXT DEFAULT 'normal',
  isPrivate INTEGER DEFAULT 0,
  targetOrganizationId TEXT DEFAULT '',
  resourceName TEXT DEFAULT '',
  resourceType TEXT DEFAULT '',
  quantity TEXT DEFAULT '',
  availabilityNotes TEXT DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Create engagements table
CREATE TABLE IF NOT EXISTS engagements (
  id TEXT PRIMARY KEY,
  listingId TEXT NOT NULL,
  listingOwnerId TEXT NOT NULL,
  requesterUserId TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('requested','accepted','preparing','on_the_way','delivered','completed','declined','cancelled')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Create engagement_messages table
CREATE TABLE IF NOT EXISTS engagement_messages (
  id TEXT PRIMARY KEY,
  engagementId TEXT NOT NULL,
  senderUserId TEXT NOT NULL,
  senderName TEXT NOT NULL,
  body TEXT NOT NULL,
  etaNote TEXT DEFAULT '',
  locationNote TEXT DEFAULT '',
  createdAt TEXT NOT NULL
);

-- Create reports table
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  listingId TEXT DEFAULT '',
  reporterName TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT DEFAULT '',
  createdAt TEXT NOT NULL
);

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('business','organization','admin')),
  displayName TEXT NOT NULL,
  organizationName TEXT DEFAULT '',
  location TEXT DEFAULT '',
  createdAt TEXT NOT NULL
);

-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_listings_type ON listings(type);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category);
CREATE INDEX IF NOT EXISTS idx_listings_active ON listings(active);
CREATE INDEX IF NOT EXISTS idx_listings_ownerUserId ON listings(ownerUserId);
CREATE INDEX IF NOT EXISTS idx_engagements_listingId ON engagements(listingId);
CREATE INDEX IF NOT EXISTS idx_engagements_requesterUserId ON engagements(requesterUserId);
CREATE INDEX IF NOT EXISTS idx_engagements_listingOwnerId ON engagements(listingOwnerId);
CREATE INDEX IF NOT EXISTS idx_engagement_messages_engagementId ON engagement_messages(engagementId);
CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
