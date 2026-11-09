# ASV Odisha: anti-snake venom serum availability

A public site to check which facilities in Odisha have anti-snake venom (ASV) serum, a doctor and
24x7 service, plus an admin area where each of the 30 districts' Excel reports is uploaded.

- **Frontend:** React 18 + Vite (`client/`)
- **Backend:** Node 22 + Express 5, SQLite via the built-in `node:sqlite` (`server/`)
- Needs **Node 22.5 or newer**.

## Run it

```bash
npm install
npm run dev            # API on :4000, site on http://localhost:5173
```

Admin sign-in in development: `admin` / `Admin@12345` (change it under Admin > Account).

Optional: load the sample Nabarangpur report so the site has data: `npm run seed:demo`.

## Production

```bash
npm run build
export JWT_SECRET=$(openssl rand -base64 48)
export ADMIN_PASSWORD='a-long-password'
npm start              # serves the API and the built site on :4000
```

See `.env.example` for all settings. Back up `server/data/` (database and uploaded files).

## How uploading works

1. Admin > Upload report. Choose the district, the "stock as on" date, the `.xlsx`, and optionally the Collectorate letter PDF.
2. **Check file** validates every row without saving anything. Errors block publishing and name the row and column. Warnings (for example two facilities with identical coordinates, or one 90+ km from the rest) do not.
3. **Publish** replaces that district's live report. Earlier uploads stay in History and can be made live again or deleted.

### Uploads never fail because a district left things out

Districts do not always follow the Government of Odisha format (SL, Name of facility, Location with GPS, Is anti-venom available / quantity, Trained doctor, 24 hrs service, Date last administered). The upload accepts whatever they send:

- **Any layout.** Column names, order, title rows, the "1 2 3 ... 7" numbering row, repeated headers and "Total" rows are handled. The header row and columns are found by wording, then by what the data looks like. The admin sees **Match your columns** and can correct any match, pick another sheet, or change the header row.
- **Only the facility name is essential.** Block, type, serum, doctor, working hours, location and date are all optional. Type is worked out from the name (CHC, PHC(N), SDH...) when there is no column.
- **Loose values are understood.** "Yes (20)", "20 vials", "Yes", "NIL" for stock; "24 hrs", "24x7", "Round the clock", "9 AM to 5 PM" for hours; GPS inside an address, as decimals or degrees-minutes-seconds; dates as `dd-mm-yyyy`, `12-Mar-2026`, or two dates in one cell (the latest is used).
- **Gaps are never guessed.** A blank or unreadable value is stored as "not reported" and shown to the public as such, not as No or zero. Facilities with missing information are never counted as "ready". The admin sees a completeness summary for every upload.
- **Warnings never block.** Only an unreadable file, or a sheet with no facilities, is refused, with a message saying why.

"Ready" = serum available + trained doctor + 24x7 service, all three reported as Yes. "Low stock" is under `LOW_STOCK_THRESHOLD` (default 20) vials.

## Security notes

- Admin session is an HttpOnly, SameSite=Strict cookie holding a signed JWT; passwords are bcrypt-hashed.
- Login is rate-limited; all admin routes require the session; uploads are size-limited and checked by file signature.
- Every upload, restore, delete and sign-in is recorded in the activity log.
- Only one admin account is created automatically. Add more by inserting rows into `admins` with a bcrypt hash.

## Tests

`npm test` runs the API tests (auth, upload, validation, restore/delete) against a temporary database.
