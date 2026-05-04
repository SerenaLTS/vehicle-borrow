# vehicle-usage-management

Internal vehicle usage management system built with Next.js, Supabase, and Vercel.

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
SMTP_HOST=smtp.yourmailprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@yourcompany.com
SMTP_PASS=your-app-password-or-smtp-password
SMTP_FROM=vehicle-usage-management <your-email@yourcompany.com>
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
   - `Site URL` to your deployed Vercel domain later, for example `https://vehicle-usage-management.vercel.app`
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
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_SECURE`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `SMTP_FROM`
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
   - `vin` (optional)
   - `color` (optional)
   - `status`

The schema file already inserts sample vehicles. You can keep them, edit them, or mark them as `retired` if you do not want them to appear in borrowing.
Future reservations should be created through the booking flow instead of manually setting a vehicle status to `booked`.

## Admin setup

This project uses a `public.user_roles` table to track admins.

1. Run the latest [`supabase/schema.sql`](./supabase/schema.sql) in Supabase SQL Editor.
2. Open `Table Editor -> user_roles`.
3. Find the user by email.
4. Set `is_admin` to `true` for anyone who should access `/admin`.

New auth users are synced into `user_roles` automatically.

## Important behavior

- When a user borrows a vehicle, the app creates a loan record and marks the vehicle as `borrowed`.
- When the same user returns it, the loan record is closed and the stored vehicle status goes back to `available`.
- History is never deleted, so exports remain available.
- Booking windows are stored in `vehicle_bookings` and are used to calculate whether a vehicle is currently `booked` or has an upcoming reservation.
- Vehicles with a current booking are blocked from the borrow flow, while vehicles with a future booking still appear and show the booked time window.
- Vehicles in `maintenance` do not appear in the borrow page.
- Vehicles in `retired` do not appear in the borrow page and should be used instead of deleting vehicles that already have history.
- If SMTP is configured, booking create, update, and cancel actions send email notifications. Admin-triggered booking changes notify the booked user plus all admins.

## Email notes

- You can use your own mailbox as the sender if your provider supports SMTP access.
- For Gmail, Outlook, and many company mail systems, this usually means using an app password or a dedicated SMTP credential, not your normal sign-in password.
- If the SMTP variables are not set, the app skips email sending and booking still succeeds.

## Useful commands

```bash
npm run dev
npm run build
npm run typecheck
```
