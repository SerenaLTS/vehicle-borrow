# Vehicle Borrow

Internal vehicle borrowing tracker built with Next.js, Supabase, and Vercel.

## What is included

- Company email login with Supabase password auth
- Dashboard showing vehicles currently borrowed by the logged-in user
- Borrow flow with driver, purpose, odometer, and optional notes
- Return flow with odometer and optional notes
- Full borrowing history page
- CSV export for the history
- Supabase SQL schema with row-level security and transactional borrow/return functions

## Local setup

1. Install dependencies

```bash
npm install
```

2. Create your local environment file

```bash
cp .env.example .env.local
```

3. Fill in `.env.local`

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
COMPANY_EMAIL_DOMAIN=yourcompany.com
```

4. In Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql)

5. Start the app locally

```bash
npm run dev
```

6. Open `http://localhost:3000`

## Step-by-step Supabase setup

1. Go to Supabase and create a new project.
2. Wait until the database is ready.
3. In the left menu, open `SQL Editor`.
4. Copy the full contents of [`supabase/schema.sql`](./supabase/schema.sql) and run it.
5. In `Project Settings -> API`, copy:
   - `Project URL`
   - `anon public key`
6. Put those into `.env.local`.

## Step-by-step Auth setup

1. In Supabase, open `Authentication -> Sign In / Providers`.
2. Make sure `Email` is enabled.
3. Make sure email/password sign-in is enabled.
4. In `Authentication -> URL Configuration`, set:
   - `Site URL` to your deployed Vercel domain later, for example `https://vehicle-borrow.vercel.app`
   - `Redirect URLs` to:
     - `http://localhost:3000/auth/callback`
     - `https://YOUR-VERCEL-DOMAIN/auth/callback`
5. In this app, login is restricted by `COMPANY_EMAIL_DOMAIN`, so only emails ending in that domain can sign in.
6. This app uses company email plus self-set password login. Users create their password once, then sign in directly.

## Step-by-step Vercel deployment

1. Create a GitHub repository and upload this project.
2. Go to Vercel and click `Add New Project`.
3. Import the GitHub repository.
4. In Vercel `Environment Variables`, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `COMPANY_EMAIL_DOMAIN`
5. Click deploy.
6. After deployment finishes, copy the production domain.
7. Go back to Supabase `Authentication -> URL Configuration`.
8. Update:
   - `Site URL` to the Vercel production URL
   - add the same `/auth/callback` URL under `Redirect URLs`
9. Redeploy in Vercel if needed.

## How to add or edit vehicles

You can manage vehicles directly in Supabase:

1. Open `Table Editor`.
2. Open the `vehicles` table.
3. Add rows with:
   - `plate_number`
   - `model`
   - `status`

The schema file already inserts three sample vehicles. You can keep them, edit them, or delete them.

## Important behavior

- When a user borrows a vehicle, the app creates a loan record and marks the vehicle as `borrowed`.
- When the same user returns it, the loan record is closed and the vehicle goes back to `available`.
- History is never deleted, so exports remain available.
- Vehicles in `maintenance` do not appear in the borrow page.

## Useful commands

```bash
npm run dev
npm run build
npm run typecheck
```
