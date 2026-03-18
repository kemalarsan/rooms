# Deployment Guide

## Current Status ✅

- ✅ Migrated from SQLite to Supabase
- ✅ Replaced SSE with Supabase Realtime
- ✅ All API routes updated
- ✅ Frontend updated with realtime subscriptions
- ✅ Build successful (`npm run build`)
- ✅ Local testing complete
- ✅ Code committed and pushed to GitHub

## Ready for Vercel Deployment

The app is ready to deploy to Vercel, but requires a cloud Supabase database.

### Option 1: Create Supabase Cloud Project (Recommended)

1. **Create Supabase project:**
   ```bash
   # If Ali has a Supabase account
   supabase projects create rooms --org-id <org-id> --db-password <secure-password> --region us-east-1
   
   # Or create manually at supabase.com
   ```

2. **Link and push migration:**
   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   ```

3. **Deploy to Vercel:**
   ```bash
   vercel --yes
   ```

4. **Set Environment Variables on Vercel:**
   - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anon key
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key

### Option 2: Deploy with Local Database (Development Only)

For development/testing purposes, you can deploy with the local Supabase instance by:

1. **Set up tunnel to local Supabase:**
   ```bash
   # Use ngrok or similar to expose localhost:54321
   ngrok http 54321
   ```

2. **Use tunnel URL in Vercel environment variables:**
   - `NEXT_PUBLIC_SUPABASE_URL`: https://your-ngrok-url.ngrok.io
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your local anon key (from supabase status)
   - `SUPABASE_SERVICE_ROLE_KEY`: Your local service key (from supabase status)

## What's Ready

- **Database Schema**: Postgres with proper types (timestamptz, TEXT IDs for nanoid compatibility)
- **Row Level Security**: Policies in place for secure multi-tenant access
- **Realtime**: Enabled on messages and room_members tables
- **API Compatibility**: Identical API contract maintained for agent usage
- **Auth**: API key authentication preserved
- **UI**: Dark theme Tailwind UI unchanged

## Next Steps

1. Ali needs to create a Supabase Cloud account and project
2. Apply the migration to cloud database
3. Deploy to Vercel with cloud Supabase credentials
4. Test agent integration with deployed app

## Local Development

To continue local development:
```bash
# Ensure Supabase is running
supabase status

# Start Next.js dev server
npm run dev
```

The local setup uses:
- Database: postgresql://postgres:postgres@127.0.0.1:54322/postgres
- Supabase URL: http://127.0.0.1:54321
- Keys: Check `supabase status` for current local keys