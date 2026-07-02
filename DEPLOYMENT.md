# Deploying to Railway

This backend is a NestJS app. Railway's Nixpacks builder auto-detects Node and uses the scripts below — `railway.json` is already configured.

## Steps

1. Push this branch (`claude/verify-addition-8ual9f`) to GitHub (already done).
2. In Railway: **New Project → Deploy from GitHub repo** → select `abduallaziz/apiv1.0.2` → branch `claude/verify-addition-8ual9f`.
3. Add a Redis instance to the project (Railway → **New → Database → Redis**) — required for the BullMQ outbox worker. Railway injects `REDIS_URL` automatically if you reference it as a variable.
4. Set the environment variables below in **Railway → Variables** (do not commit a `.env` file). See `.env.production.example` for the full list:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET` (32+ random chars), `JWT_EXPIRY`, `JWT_REFRESH_EXPIRY`
   - `REDIS_URL` (reference the Redis service Railway creates)
   - `PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (or `PAYMENT_PROVIDER=mock` to skip Stripe for testing)
   - `RESEND_API_KEY`, `EMAIL_FROM` (leave `RESEND_API_KEY` empty for mock email mode)
   - `FRONTEND_URL` — set this to your Vercel deployment URL once it exists, so CORS/redirects work
   - `NODE_ENV=production`
5. Run migrations once against the target Supabase database before first boot (from your machine, with the same `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` exported locally):
   ```
   npm run migrate
   npm run seed:permissions
   ```
6. Deploy. Railway runs `npm run start:prod` (seeds permissions idempotently, then starts the server) per `railway.json`.
7. Note the public Railway URL (e.g. `https://api-xxxx.up.railway.app`) — you'll need it as `NEXT_PUBLIC_API_URL` (with `/api/v1` appended) when deploying the frontend to Vercel.

No merge into `main`/`master` is performed by any of this — Railway deploys directly from the feature branch.
