# Brisio Resource Scan MVP Specification

## Goal
Make donation intake fast and reliable by scanning existing UPC/GTIN barcodes already on items, then carrying each donation through recipient acceptance, handoff confirmation, and exportable documentation.

## Scope
- In scope:
  - Barcode-driven donation creation for food inventory
  - Nonprofit acceptance and pickup confirmation
  - Donation record exports (CSV and PDF)
  - Impact metrics and documentation-safe summaries
- Out of scope for MVP:
  - Direct POS or internal retailer system integrations
  - Tax deduction calculations or tax advice
  - Full GS1 enterprise integration (can start with approved product data provider)

## User Roles
- Business user: creates donation listings from scanned items, schedules pickup windows, confirms handoff.
- Organization user: accepts donation opportunities and confirms receipt.
- Admin user: views audit events and exports records.

## End-to-End Workflow
1. Business opens Donate Inventory.
2. User scans UPC/GTIN on package.
3. Brisio resolves item details (name/brand/category), user enters quantity and optional condition notes.
4. User selects recipient organization and pickup window.
5. Brisio creates donation record with status posted.
6. Organization accepts record (status accepted).
7. At pickup/handoff, one generated handoff QR is scanned by recipient (status received).
8. Brisio stores immutable events, timestamps, and actor identities.
9. Business/organization exports donation records monthly or annually.

## API Contract (MVP)
All endpoints are under /api and require auth unless noted.

### 1) Product Lookup
- Method: POST
- Path: /api/products/lookup
- Purpose: resolve product metadata from scanned code
- Request body:
```json
{
  "barcode": "012345678905",
  "format": "upc-a"
}
```
- Response body:
```json
{
  "success": true,
  "product": {
    "gtin": "00012345678905",
    "upc": "012345678905",
    "name": "Honey Oat Cereal",
    "brand": "Example Foods",
    "category": "food"
  },
  "source": "provider-name"
}
```
- Notes:
  - Return success false with a friendly not-found error when unresolved.
  - Keep source so future audits show where metadata came from.

### 2) Create Donation
- Method: POST
- Path: /api/donations
- Request body:
```json
{
  "donorLocationId": "store-omaha-001",
  "recipientOrgId": "org-together",
  "item": {
    "gtin": "00012345678905",
    "upc": "012345678905",
    "name": "Honey Oat Cereal",
    "brand": "Example Foods",
    "category": "food"
  },
  "quantity": 12,
  "unit": "units",
  "estimatedUnitValue": 1.85,
  "currency": "USD",
  "expiresAt": "2026-08-20T22:00:00.000Z",
  "pickupWindowStart": "2026-08-16T20:00:00.000Z",
  "pickupWindowEnd": "2026-08-16T22:00:00.000Z",
  "conditionNotes": "sealed case"
}
```
- Response body:
```json
{
  "success": true,
  "donation": {
    "id": "don_BRS_1048",
    "status": "posted",
    "createdAt": "2026-08-16T19:54:10.000Z"
  }
}
```

### 3) List Donations
- Method: GET
- Path: /api/donations
- Query params:
  - status
  - donorLocationId
  - recipientOrgId
  - from
  - to
  - page
  - pageSize
- Response: paginated list with totals.

### 4) Donation Details
- Method: GET
- Path: /api/donations/:id
- Response includes:
  - donation payload snapshot
  - current status
  - event timeline
  - handoff confirmation data

### 5) Accept Donation (Organization)
- Method: POST
- Path: /api/donations/:id/accept
- Request body:
```json
{
  "acceptedByUserId": "user_org_42",
  "note": "Pickup team arriving in 30 minutes"
}
```
- Result: status moves posted -> accepted.

### 6) Decline Donation (Organization)
- Method: POST
- Path: /api/donations/:id/decline
- Request body:
```json
{
  "reason": "Capacity reached for today"
}
```
- Result: status moves posted -> declined.

### 7) Generate Handoff Token/QR
- Method: POST
- Path: /api/donations/:id/handoff-token
- Purpose: generate single-use token encoded into QR for pickup confirmation.
- Response body:
```json
{
  "success": true,
  "handoffToken": "hto_abc123...",
  "expiresAt": "2026-08-16T23:00:00.000Z"
}
```

### 8) Confirm Handoff
- Method: POST
- Path: /api/donations/:id/confirm-handoff
- Request body:
```json
{
  "handoffToken": "hto_abc123...",
  "receivedByUserId": "user_org_42",
  "receivedQuantity": 12,
  "receivedUnit": "units",
  "receiptNote": "All items received in sealed packaging"
}
```
- Result: status moves accepted -> received.

### 9) Export Donations
- Method: GET
- Path: /api/donations/export
- Query params:
  - format=csv|pdf
  - from
  - to
  - donorOrgId or donorLocationId
- Result:
  - CSV download for accounting teams
  - PDF summary document for reporting

### 10) Impact Summary
- Method: GET
- Path: /api/donations/impact-summary
- Query params:
  - from
  - to
  - donorOrgId
- Response:
```json
{
  "success": true,
  "summary": {
    "itemsDonated": 1390,
    "estimatedInventoryValue": 1842.00,
    "recipientCount": 7,
    "completedPickups": 42
  }
}
```

## Donation Status Model
- posted
- accepted
- declined
- received
- cancelled

Rule examples:
- Only recipient org can accept/decline posted donations.
- Only accepted donations can generate handoff tokens.
- Handoff confirmation requires valid non-expired token.

## Database Schema Draft (Supabase/Postgres)
Add these tables to support the feature while preserving immutable event history.

```sql
CREATE TABLE IF NOT EXISTS donation_records (
  id TEXT PRIMARY KEY,
  donorOrgId TEXT NOT NULL,
  donorLocationId TEXT NOT NULL,
  recipientOrgId TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('posted','accepted','declined','received','cancelled')),
  gtin TEXT DEFAULT '',
  upc TEXT DEFAULT '',
  productName TEXT NOT NULL,
  productBrand TEXT DEFAULT '',
  productCategory TEXT DEFAULT 'food',
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL DEFAULT 'units',
  estimatedUnitValue NUMERIC,
  estimatedTotalValue NUMERIC,
  currency TEXT DEFAULT 'USD',
  conditionNotes TEXT DEFAULT '',
  expiresAt TEXT DEFAULT '',
  pickupWindowStart TEXT DEFAULT '',
  pickupWindowEnd TEXT DEFAULT '',
  acceptedAt TEXT DEFAULT '',
  declinedAt TEXT DEFAULT '',
  receivedAt TEXT DEFAULT '',
  createdByUserId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS donation_events (
  id TEXT PRIMARY KEY,
  donationId TEXT NOT NULL,
  eventType TEXT NOT NULL CHECK(eventType IN (
    'posted','accepted','declined','handoff_token_generated','handoff_confirmed','cancelled','updated'
  )),
  actorUserId TEXT NOT NULL,
  actorRole TEXT NOT NULL CHECK(actorRole IN ('business','organization','admin','system')),
  payloadJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS donation_handoffs (
  id TEXT PRIMARY KEY,
  donationId TEXT NOT NULL,
  handoffTokenHash TEXT NOT NULL,
  tokenExpiresAt TEXT NOT NULL,
  usedAt TEXT DEFAULT '',
  generatedByUserId TEXT NOT NULL,
  receivedByUserId TEXT DEFAULT '',
  receivedQuantity NUMERIC,
  receivedUnit TEXT DEFAULT '',
  receiptNote TEXT DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_donation_records_status ON donation_records(status);
CREATE INDEX IF NOT EXISTS idx_donation_records_donorLocationId ON donation_records(donorLocationId);
CREATE INDEX IF NOT EXISTS idx_donation_records_recipientOrgId ON donation_records(recipientOrgId);
CREATE INDEX IF NOT EXISTS idx_donation_records_createdAt ON donation_records(createdAt);
CREATE INDEX IF NOT EXISTS idx_donation_events_donationId ON donation_events(donationId);
CREATE INDEX IF NOT EXISTS idx_donation_handoffs_donationId ON donation_handoffs(donationId);
```

## Mobile App Screen Flow (Scan to Handoff)

### Business App
1. Donate Inventory Home
- CTA: Scan item barcode
- Quick actions: Drafts, Posted, Completed

2. Scanner Screen
- Camera scanner for UPC/GTIN
- Manual code entry fallback
- Error states: unreadable code, unknown product

3. Donation Compose Screen
- Product auto-filled from lookup
- Inputs: quantity, unit, optional expiration, condition notes, pickup window
- Recipient selection control
- Estimated value input with helper text

4. Review and Post
- Summary card
- CTA: Post Donation

5. Handoff Screen
- Shows donation ID and recipient
- Generate one-time handoff QR
- Status chip: accepted/received

### Organization App
1. Incoming Donations List
- Filters: new, accepted, scheduled, completed

2. Donation Detail
- Product and quantity details
- Pickup window and donor location
- Actions: Accept or Decline

3. Pickup Confirmation
- Scan handoff QR
- Confirm received quantity
- Submit receipt note

## UI Copy Blocks (Tax-Safe)
Use these exact strings to avoid tax-advice risk.

### Donation Summary Card
- Title: Donation records
- Line: 327 items donated
- Line: Estimated inventory value: $1,842
- Line: Recipient: Qualified nonprofit
- Line: Documentation available

### Compliance Footer
- Tax treatment should be determined by your organization tax professional.

### Export Modal
- Export donation records for accounting and compliance workflows.
- Includes donor, recipient, item, quantity, timestamps, and receipt status.

### Handoff Confirmation
- Received by {OrganizationName}
- {DateTime}
- {Quantity} {Unit}
- Donation ID {DonationId}

## Validation Rules
- quantity must be > 0
- pickupWindowEnd must be after pickupWindowStart
- receivedQuantity cannot exceed posted quantity without explicit override permission
- recipientOrgId must refer to organization account type
- handoff token is single-use and expires

## Security and Audit Requirements
- Every status change writes donation_events row.
- Never delete donation events; append only.
- Export requests should be logged with requester user ID and timestamp.
- Redact sensitive notes from broad analytics endpoints.

## Pilot-Ready Metrics
- Median time from scan to post
- Median time from post to accept
- Median time from accept to handoff
- Completion rate (posted -> received)
- Rejection/decline reasons by category
- Export usage rate by business accounts

## Phase 2 and 3 Extensions
- Phase 2:
  - Auto-suggest recipients based on distance/capacity
  - Multi-item donation bundle in one handoff
  - Weight capture support (lb/kg)
- Phase 3:
  - Authorized enterprise API adapters (retailer systems)
  - Donation auto-creation from disposition feeds
  - SLA and webhook support for large partners

## Engineering Notes for Current Brisio Codebase
- Keep API style consistent with existing /api/auth and /api/listings routes.
- Reuse existing auth/session middleware.
- Use deterministic IDs and UTC timestamps.
- Keep donation copy and reporting language neutral and compliance-safe.
