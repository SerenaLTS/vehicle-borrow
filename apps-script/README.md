# Vehicle Management MVP (Google Sheets + Apps Script)

This pilot replaces the core vehicle list and borrow/return workflow. The spreadsheet is the database; Apps Script serves a small web app. It does not yet migrate bookings, fines, reminders, attachments, or the existing Next.js interface.

## Data tabs

- `Vehicles`: one row per fleet vehicle. Admins maintain vehicle records and status.
- `Loans`: one row per borrow; return updates the same row.
- `Users`: approved Google Workspace users and their `employee` / `admin` role.

Use the exact row 1 headers provided by the workbook. Add an initial user to `Users`, with an exact Workspace email, display name, role `admin`, and access status `approved`. Add pilot users with role `employee` and status `approved`.

## Install and run

1. Open the Google Sheet and copy its ID from `/spreadsheets/d/<ID>/`.
2. In **Extensions → Apps Script**, create `Code.gs` and `Index.html`, then paste the corresponding files from this folder.
3. In Apps Script **Project Settings → Script Properties**, add `SHEET_ID` with the spreadsheet ID.
4. Run `setupDatabase` once in the editor and authorize it. It creates missing tabs and adds headers if row 1 is blank.
5. Fill the `Users` tab with approved pilot users. Fill `Vehicles` with a small set of fleet records. Make sure available vehicles have status `available`.
6. In **Deploy → New deployment → Web app**, choose **Execute as: Me** and restrict access to your Google Workspace domain. Share the Sheet only with the small admin group; employees use the web app and are separately checked against `Users`.
7. Open the deployed URL using an approved Workspace account. Test one borrow and one return with non-production sample data first.

If `Session.getActiveUser().getEmail()` is blank in your Workspace policy, do not deploy this version as an open web app; use a Workspace-authenticated deployment/access configuration that exposes the signed-in user's email.

## Pilot safeguards and limits

- Every server request checks the signed-in email against an approved `Users` row.
- Borrow and return writes use a script lock to reduce simultaneous double-booking.
- Only the borrower or an admin can return a loan.
- This is a small-team pilot. Google Sheets is not a relational database; complex booking overlap logic, fine workflows, reminders, file access control, and high-concurrency fleet use remain out of scope.
- Protect the `Users` sheet and limit spreadsheet editor access because sheet editors can change the data directly.

## Rollout path

1. Inventory current Supabase tables and define field mappings; this MVP maps only `vehicles`, `vehicle_loans`, and a minimal user allowlist.
2. Export and reconcile a copy of those tables. Preserve existing IDs where possible; validate plate uniqueness, loan references, and active-loan/status consistency.
3. Pilot this Sheet and Apps Script with a few users and test borrow, return, permissions, and simultaneous borrow attempts.
4. Add audit history and bookings/approvals; migrate those workflows as separate steps.
5. Run old and new workflows in parallel for an agreed period, compare records, then freeze writes in the old app and do a final delta import.
6. Retire Supabase only after backups, access review, and rollback checks are complete.

Never overwrite production data during the pilot. Keep the Supabase application as the source of truth until migration sign-off.
