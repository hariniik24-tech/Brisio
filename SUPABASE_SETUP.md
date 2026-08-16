# Supabase Migration Guide

## Overview
Your Brisio backend has been migrated from SQLite (better-sqlite3) to Supabase, a cloud-hosted PostgreSQL database with built-in authentication and real-time capabilities.

## Setup Steps

### Step 1: Create a Supabase Account & Project
1. Go to [supabase.com](https://supabase.com)
2. Sign up for a free account
3. Create a new project:
   - Choose a project name (e.g., "brisio")
   - Choose a region (closest to your users)
   - Create a strong database password
4. Wait for the project to initialize (2-3 minutes)

### Step 2: Get Your Credentials
1. In your Supabase project, go to **Settings > API**
2. Copy these values:
   - **Project URL** → use for `SUPABASE_URL`
   - **anon public** key → use for `SUPABASE_ANON_KEY`
   - **service_role secret** key → use for `SUPABASE_SERVICE_ROLE_KEY`

### Step 3: Update Environment Variables
Edit `/Users/hariniikarthikeyan/Downloads/Brisio/.env.local`:
```
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
RESEND_API_KEY=your_resend_api_key_here
RESEND_FROM=Brisio <reset@yourdomain.com>
PORT=3000
NODE_ENV=development
```

If you do not use Resend, configure SMTP instead:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `RESET_EMAIL_FROM`.

### Step 4: Create Database Schema
1. In your Supabase project, go to **SQL Editor**
2. Click **New Query**
3. Copy the entire contents of `db-schema.sql` from your project
4. Paste into the SQL Editor
5. Click **Run**

This creates all necessary tables with proper indexes.

### Step 5: Start the Server
```bash
cd /Users/hariniikarthikeyan/Downloads/Brisio
npm start
```

The server will now use Supabase instead of SQLite.

## Key Changes from SQLite to Supabase

### What Changed?
- **Local database** → **Cloud PostgreSQL database**
- **better-sqlite3** → **@supabase/supabase-js client**
- **Synchronous queries** → **Async/await queries**
- **File-based storage** → **Cloud storage with automatic backups**

### API Changes Made
- All `db.prepare().get()` → `supabase.from().select().single()`
- All `db.prepare().run()` → `supabase.from().insert()`
- All `db.exec()` → SQL migrations in Supabase console
- Password hashing remains the same (crypto.scryptSync)
- Session tokens remain the same (crypto.randomBytes)

### Async/Await Pattern
```javascript
// Old (SQLite)
const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

// New (Supabase)
const { data: user } = await supabase
  .from('users')
  .select('*')
  .eq('email', email)
  .single();
```

## Features & Advantages

✅ **Automatic Backups** - Daily backups to your Supabase account  
✅ **Real-time Capabilities** - Add real-time features later with Supabase Realtime  
✅ **Row-level Security** - Built-in RLS policies for fine-grained access control  
✅ **Scalability** - Automatically scales with your user base  
✅ **API Auto-generation** - REST API automatically generated from your schema  
✅ **Mobile-friendly** - Works seamlessly with your Expo mobile app  

## Seeding Initial Data

If you need to seed the database with sample listings (like your original SQLite setup did), you can:

1. Create a new SQL file with INSERT statements
2. Run it in the Supabase SQL Editor, OR
3. Call the `/api/listings` endpoint with sample data after authentication

Example seed data:
```sql
INSERT INTO listings (id, type, category, businessName, description, contact, location, urgent, active, createdAt, updatedAt)
VALUES 
  (gen_random_uuid(), 'supply', 'food', 'Roast & Share Cafe', 'Extra baked goods...', 'hello@roastshare.example', 'Downtown', 1, 1, now(), now()),
  (gen_random_uuid(), 'supply', 'space', 'Green Workshop Studio', 'Available event space...', 'events@greenstudio.example', 'Midtown', 0, 1, now(), now());
```

## Troubleshooting

### "Connection failed" error
- Check that your `.env.local` variables are correct
- Verify your Supabase project is active (check Supabase dashboard)

### "SUPABASE_URL is required" error
- Make sure `.env.local` file exists and is readable
- Ensure you've set all required environment variables

### "Rate limit exceeded"
- Supabase has generous free tier limits
- Check your usage in the Supabase dashboard

### Queries too slow?
- Check if indexes are created (run db-schema.sql)
- Upgrade your Supabase plan if needed

## Next Steps

1. **Test all endpoints** to ensure they work with Supabase
2. **Enable Row-level Security (RLS)** for production:
   - Supabase dashboard → Policies
   - Add policies to restrict users to their own data
3. **Set up Realtime** for live updates (optional)
4. **Connect your mobile app** to this new backend

## Support Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/introduction)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

---

**Last Updated:** 2026-07-22  
**Supabase Client Version:** @supabase/supabase-js (latest)
