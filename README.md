# 🌿 Brisio

**A real-time community resource marketplace** that matches unused business capacity with local demand using a rule-based AI scoring engine.

---

## Quick Start

### 1. Install Node.js
Download from https://nodejs.org (v18 or higher recommended)

### 2. Install dependencies
```bash
cd commonground
npm install
```

### 3. Start the server
```bash
npm start
```

### 4. Open your browser
Visit **http://localhost:3000**

That's it. The SQLite database is created automatically on first run.

---

## How It Works

### Account Roles (required)
- **Business** accounts create supply listings, set delivery ETA, set offer close time (expiry), and can send **private offers** to a specific organization.
- **Organization** accounts create demand listings, set urgency (`low`, `medium`, `high`, `critical`), and can ask AI for the **best + closest** match.
- Both roles must create an account and sign in before using listings and AI workflows.

### AI Scoring Engine
When a user searches or requests a match, the engine:

| Rule | Points |
|------|--------|
| Exact category match | +50 |
| Related category overlap | +25 |
| Per keyword overlap | +10 each |
| Supply-side priority boost | +15 |
| Urgency indicators (free, now, today, asap…) | +10 |
| Location match | +10 |

Results are ranked highest → lowest and returned instantly.

AI responses are built from live listings and computed platform statistics (no fabricated inventory, contacts, or external assumptions).

### Categories
- `space` — rooms, venues, desks, studios
- `time` — available hours, scheduling slots
- `equipment` — tools, machinery, gear
- `service` — skills, consulting, training
- `food` — surplus inventory, meals, produce
- `other` — anything else

---

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/listings` | All listings (filter: `?type=supply&category=space`) |
| POST | `/api/listings` | Create a listing |
| GET | `/api/listings/:id` | Single listing |
| PATCH | `/api/listings/:id` | Update listing |
| DELETE | `/api/listings/:id` | Delete listing |
| GET | `/api/match/:query` | AI search — ranked results |
| GET | `/api/recommend/:query` | AI recommendations for a natural-language prompt |
| GET | `/api/match-listing/:id` | Find matches for a listing |
| GET | `/api/stats` | Platform statistics |

### Example: Create a listing
```bash
curl -X POST http://localhost:3000/api/listings \
  -H "Content-Type: application/json" \
  -d '{
    "type": "supply",
    "category": "space",
    "businessName": "Downtown Coffee Co.",
    "description": "Empty meeting room available 2–5 PM weekdays. Seats 8. Free WiFi.",
    "contact": "hello@downtowncoffee.com",
    "location": "Kansas City"
  }'
```

### Example: Search/match
```bash
curl http://localhost:3000/api/match/meeting%20room%20afternoon
```

### Example: AI recommendations
```bash
curl http://localhost:3000/api/recommend/i%20need%20food%20support%20today
```

---

## Deploying to the Internet (for real nonprofits!)

### Option A: Railway (free tier, easiest)
1. Create account at https://railway.app
2. Connect your GitHub repo
3. Deploy — Railway detects Node.js automatically
4. Set `PORT` environment variable if needed

### Option B: Render (free tier)
1. Push code to GitHub
2. New Web Service on https://render.com
3. Build command: `npm install`
4. Start command: `node server.js`
5. Set email delivery secrets for password resets:
  - `RESEND_API_KEY` and `RESEND_FROM` for transactional email, or
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `RESET_EMAIL_FROM` for SMTP fallback

### Option C: VPS (DigitalOcean, Linode)
```bash
# On your server:
git clone your-repo
cd commonground
npm install
npm install -g pm2
pm2 start server.js --name commonground
pm2 save
pm2 startup
```

### Note on SQLite in production
For production with multiple users, consider migrating to PostgreSQL.
Replace `better-sqlite3` with `pg` and update the DB queries.

---

## File Structure
```
commonground/
├── server.js          ← Express server + AI scoring engine
├── package.json       ← Dependencies
├── db/
│   └── commonground.db   ← SQLite database (auto-created)
└── public/
    └── index.html     ← Full frontend UI
└── brisio-mobile/     ← Expo iOS/Android app
```

---

## For Nonprofits — Sharing with Local Businesses

When reaching out to businesses, share:
1. Your deployed URL (e.g. `https://brisio.yourtown.org`)
2. Tell them: **"Post what you're not using — empty rooms, extra hours, surplus food, unused equipment."**
3. Tell community members: **"Search for what you need and connect directly."**

**The platform is free to use and open source.**

---

## License
MIT — free to use, modify, and distribute for nonprofit and community purposes.
