# Deployment

One Vercel project serves the whole app. The React build is served from
Vercel's CDN; the same Express API you run locally is mounted as a single
serverless function under `/api`. The database is a free managed MySQL 8
instance somewhere else, because Vercel does not host databases.

```
                    https://your-app.vercel.app
┌──────────────────────────────────────────────────────────┐
│  Vercel (Hobby / free)                                   │
│                                                          │
│   /            →  React SPA, served from the CDN         │
│   /api/*       →  Express app  (api/[...slug].js)        │
│   /uploads/*   →  legacy images, rewritten to /api/…     │
└───────────────────────────┬──────────────────────────────┘
                            │ TLS
                ┌───────────▼───────────┐
                │  Managed MySQL 8      │   Aiven, free tier
                └───────────────────────┘

                ┌───────────────────────┐
                │  Cloudinary           │   product images, free tier
                └───────────────────────┘
```

Sharing one origin means no CORS round-trip before every API call, one URL to
remember, and no second dashboard to keep in sync.

Product images are **not** in the database. They upload to Cloudinary and
`products.image` holds the delivery URL, so the browser fetches photos straight
from Cloudinary's CDN — neither the API nor the database is in that path. That
keeps the free database tier's ~1 GB for inventory data, and stops a catalogue
page from turning into dozens of database round trips.

## What had to change to run serverless

| Serverless constraint | How the app handles it |
|---|---|
| No "boot" — a cold start would re-run schema sync on every request | `backend/app.js` only builds the app. Schema creation is a deliberate one-off: `npm run migrate:prod`. `backend/server.js` still syncs and seeds for local/long-lived runs. |
| Read-only filesystem | Images go to Cloudinary. With no Cloudinary account configured the app falls back to the `product_images` table, so a fresh clone and the test suite still work with no external service; either way nothing is written to disk. Images written by earlier releases keep resolving at their `/uploads/...` URLs. |
| Each instance opens its own connection pool | The cap that matters is (instances × pool size), not pool size, so production defaults to **3**. |
| Managed MySQL requires TLS | `?ssl-mode=REQUIRED` in a provider's URI means nothing to `mysql2`, which takes TLS through a driver option instead. `config/parseDbUrl.js` translates it and strips the query string — without that the first symptom is a bare handshake error that never mentions TLS. |
| Assets loaded by path are invisible to the bundler | `vercel.json` `includeFiles` pulls in the Bengali TTFs and pdfkit's font metrics. |
| In-memory rate limiting is per instance | Still blunts a burst from one client, but is not relied on as a hard global cap. Login remains protected by bcrypt cost and generic error messages. |

---

## 1. Create the database (5 minutes, free, one-time)

Any internet-reachable **MySQL 8** works. Free options:

| Provider | Notes |
|---|---|
| **Aiven** — recommended | Genuine MySQL 8 on a free plan. TLS required. |
| **Clever Cloud** | Free MySQL add-on, small storage cap. |
| **Railway** | MySQL plugin, usage-based trial credit. |

Avoid PlanetScale-style providers that drop foreign-key support: this schema
relies on them.

Collect: **host, port, user, password, database name**.

## 2. Move product images to Cloudinary — before any data migration

Sign up at <https://cloudinary.com> (free tier, no card). From the dashboard
copy the **API Environment variable**, which already has the
`cloudinary://<api_key>:<api_secret>@<cloud_name>` shape, and append it to
`backend/.env`:

```bash
echo 'CLOUDINARY_URL=paste-it-here' >> backend/.env
```

Then move any images currently held as database blobs:

```bash
cd backend
npm run images:cloudinary:dry    # report what would move
npm run images:cloudinary        # upload, then repoint products.image
```

It repoints the product row before deleting the blob, so an interrupted run
leaves the image reachable rather than dangling, and re-running is harmless.
Do this **before** step 3, so no image bytes are copied into the new database.

## 3. Create the schema and (optionally) copy your local data

Run this **from your laptop**, once. It creates every table on the new database
and can copy your existing shop data across.

```bash
cd backend
TARGET_DATABASE_URL="mysql://user:pass@host:3306/db" npm run migrate:check    # connectivity + row counts
TARGET_DATABASE_URL="mysql://user:pass@host:3306/db" npm run migrate:prod -- --dry-run
TARGET_DATABASE_URL="mysql://user:pass@host:3306/db" npm run migrate:prod
```

The script never writes to the local database, saves a JSON backup to
`backend/backups/` first, refuses to run against a target that already holds
data (unless `--force`), and preserves primary keys so foreign keys stay intact.

**Starting empty instead?** Point `backend/.env` at the new database and run
`npm start` once locally: `server.js` creates the schema and seeds the first
admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Stop it once it prints
`Created initial admin`.

## 4. Deploy

Import the GitHub repository at <https://vercel.com/new>. Everything Vercel
needs is already in `vercel.json` — leave the framework and build settings on
their detected values.

## 5. Environment variables

In **Project → Settings → Environment Variables**, for the *Production*
environment (and *Preview*, if you want preview deploys to work):

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Service URI from step 1 |
| `DB_SSL` | `true` |
| `DB_POOL_MAX` | `3` |
| `CLOUDINARY_URL` | `cloudinary://<api_key>:<api_secret>@<cloud_name>` |
| `JWT_SECRET` | 48+ random characters — see below |
| `JWT_EXPIRES_IN` | `7d` |
| `NODE_ENV` | `production` |

Generate the secret locally and paste the output:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Do **not** set `REACT_APP_API_URL` — leaving it unset is what makes the frontend
call the API on its own origin.

`SEED_*` variables are not needed on Vercel: seeding happens in step 3.

Redeploy after adding variables — Vercel bakes them in at build time.

## 6. Verify

```bash
curl https://your-app.vercel.app/api/health?db=1
# {"status":"OK","timestamp":"…","database":"connected"}
```

`"status":"DEGRADED"` means the function is running but cannot reach MySQL:
check `DATABASE_URL`, `DB_SSL=true`, and that the provider's firewall allows
connections from anywhere (Vercel's function IPs are not fixed on the free plan).

Then sign in and walk one sale end to end.

---

## Alternative: API on a long-lived host

`render.yaml` still describes the older split deployment — React on Vercel, the
Express API on Render as an ordinary Node process. Nothing in the code
prevents it, and `server.js` is unchanged. If you go that way, set
`REACT_APP_API_URL` on the Vercel project to the API's URL, and `FRONTEND_URL`
on the API to the Vercel URL. Note that Render's free tier sleeps after 15
minutes idle, which means a ~50 second wait on the first sale of the day.

---

## Local development

```bash
cd backend  && npm install && cp .env.example .env   # then fill in .env
npm run dev                                          # API on :5000
cd ../frontend && npm install && cp .env.example .env
npm start                                            # SPA on :3000
```

Tests:

```bash
cd backend
npm test                                             # unit — no database needed
npm start                                            # in another terminal
TEST_PASSWORD=… npm run test:api                     # end-to-end against the live API
```

The end-to-end suite is safe to run against a database holding real data: it
creates its own product and category and removes both afterwards.

## Security checklist

- `.env` is git-ignored; only `.env.example` is committed.
- `JWT_SECRET` under 32 characters refuses to start the app.
- Passwords are bcrypt-hashed (cost 12) and never returned by any endpoint.
- Login answers identically for a wrong password, an unknown email and a
  disabled account, so the endpoint cannot enumerate users.
- Every `/api` route except `POST /api/auth/login` and `GET /api/health`
  requires a bearer token; user management additionally requires `role=admin`.
- All SQL goes through Sequelize with bound replacements — no string-built SQL.
- Uploads are capped at 3 MB and must be an image by both extension and MIME type.
