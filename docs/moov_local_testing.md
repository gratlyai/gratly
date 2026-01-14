# Moov Local Development Testing Guide

This guide explains how to test Moov integrations locally on `localhost:8000` even though Moov doesn't issue client credentials for localhost.

## Overview

Gratly supports two modes for local Moov testing:

1. **Tunnel Mode** (Recommended): Use ngrok or similar to expose localhost to the internet
2. **Dev Domain Mode**: Use dev.gratly.ai as the callback destination and poll for status updates locally

## Quick Start (5 minutes)

### Prerequisites

- Python 3.8+
- Node.js (for frontend)
- macOS with `brew` (or install tools manually)
- Moov sandbox account with dev credentials

### Step 1: Get Moov Credentials

1. Go to https://moov-sandbox.com
2. Sign up or log in
3. Go to Settings → API Keys
4. Copy your `Client ID` and `Client Secret`
5. Create a test account (restaurant or employee) for testing

### Step 1.5: Set Up ngrok (Tunnel Mode Only)

**First time only**: Authenticate ngrok

1. Go to https://dashboard.ngrok.com/signup (free account)
2. Sign in and go to https://dashboard.ngrok.com/get-started/your-authtoken
3. Copy the command shown (e.g., `ngrok config add-authtoken 2X1X1X...`)
4. Run it in your terminal:
   ```bash
   ngrok config add-authtoken YOUR_TOKEN_HERE
   ```

### Step 2: Set Up Tunnel (Tunnel Mode)

```bash
# Install ngrok
brew install ngrok

# Start the tunnel script (this will output your PUBLIC_BASE_URL)
./scripts/dev/moov_tunnel.sh --port 8000
```

This will print something like:
```
PUBLIC_BASE_URL=https://abc123.ngrok.io
```

Keep this terminal open.

### Step 3: Configure Environment

Create or update `.env` in the repo root:

```bash
# Moov OAuth credentials (from step 1)
MOOV_CLIENT_ID=your-client-id-here
MOOV_CLIENT_SECRET=your-client-secret-here

# Local mode
MOOV_LOCAL_MODE=true
MOOV_ENV=local
MOOV_CALLBACK_MODE=tunnel

# Public URL (from tunnel script)
PUBLIC_BASE_URL=https://abc123.ngrok.io

# Optional
MOOV_BASE_URL=https://api.moov.io
```

### Step 4: Verify Configuration

```bash
python scripts/dev/check_moov_local.py
```

This will:
- ✓ Check environment variables
- ✓ Validate OAuth credentials
- ✓ Test backend connectivity
- ✓ Print webhook and callback URLs

### Step 5: Configure Moov Dashboard

1. Go to https://moov-sandbox.com/settings/webhooks
2. Add/update webhook:
   - **URL**: `{PUBLIC_BASE_URL}/api/webhooks/moov`
   - Example: `https://abc123.ngrok.io/api/webhooks/moov`
3. Go to Settings → Connected Apps (if available)
4. Configure return/callback URLs to use your `PUBLIC_BASE_URL`

### Step 6: Start Backend and Frontend

```bash
# Terminal 1: Backend
cd Backend
python main.py

# Terminal 2: Frontend
cd Frontend
npm start
```

### Step 7: Test

1. Navigate to http://localhost:3000 (or your frontend port)
2. Go to Billing or Payment Methods
3. Click "Add or Update Payment Method"
4. Complete the onboarding in the Moov hosted flow
5. You should be redirected back to your app
6. Check backend logs for webhook events

---

## Advanced: Dev Domain Mode (Polling)

If you can't use a tunnel (firewall, network restrictions), use dev domain mode:

### Configuration

```bash
MOOV_LOCAL_MODE=true
MOOV_CALLBACK_MODE=dev_domain
DEV_DOMAIN_BASE_URL=https://dev.gratly.ai

# Don't set PUBLIC_BASE_URL (uses dev domain instead)
```

### How It Works

1. Moov sends callbacks to `https://dev.gratly.ai` (which is publicly accessible)
2. Callbacks are processed there and stored in the database
3. Your local frontend polls the backend for status updates
4. Backend provides polling endpoints for checking account/payment status

### Polling Endpoints

The backend provides these endpoints for local polling:

```bash
# Check account connection status
GET /api/moov/accounts/{entity_type}/{entity_id}/status

# Get payment methods
GET /api/moov/payment-methods/{entity_type}/{entity_id}

# Check transfer/payment status
GET /api/moov/transfers/{transfer_id}/status
```

### Testing Dev Domain Mode

```bash
# Configure .env
MOOV_CALLBACK_MODE=dev_domain
MOOV_LOCAL_MODE=true

# Run sanity check
python scripts/dev/check_moov_local.py

# Manually test polling
curl http://localhost:8000/api/moov/accounts/restaurant/1/status
curl http://localhost:8000/api/moov/payment-methods/employee/123
```

---

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOOV_CLIENT_ID` | (empty) | OAuth Client ID from Moov |
| `MOOV_CLIENT_SECRET` | (empty) | OAuth Client Secret from Moov |
| `MOOV_BASE_URL` | `https://api.moov.io` | Moov API endpoint |
| `MOOV_ENV` | `dev` | Environment (local, dev, prod) |
| `MOOV_LOCAL_MODE` | `false` | Enable local testing mode |
| `MOOV_CALLBACK_MODE` | `tunnel` | Callback mode (tunnel or dev_domain) |
| `PUBLIC_BASE_URL` | `http://localhost:8000` | Public URL for callbacks (set by tunnel) |
| `DEV_DOMAIN_BASE_URL` | `https://dev.gratly.ai` | Dev domain for fallback callbacks |
| `MOOV_WEBHOOK_PATH` | `/api/webhooks/moov` | Webhook endpoint path |
| `MOOV_RETURN_PATH` | `/moov/return` | Return/callback handler path |
| `MOOV_DISABLE_WEBHOOK_VERIFY` | `false` | Disable signature verification (local only!) |

### Local Mode Behavior

When `MOOV_LOCAL_MODE=true`:

- **Webhook verification** can be disabled (set `MOOV_DISABLE_WEBHOOK_VERIFY=true`)
- **Token caching** with automatic refresh 60s before expiry
- **Fallback URLs** use `PUBLIC_BASE_URL` or `DEV_DOMAIN_BASE_URL`
- **Debug endpoints** available at `/api/moov/debug/*`

---

## Debugging

### Check Current Configuration

```bash
# Via backend debug endpoint
curl http://localhost:8000/api/moov/debug/config | jq

# Output:
# {
#   "callback_mode": "tunnel",
#   "webhook_url": "https://abc123.ngrok.io/api/webhooks/moov",
#   "return_url": "https://abc123.ngrok.io/moov/return",
#   "webhook_verification_disabled": false
# }
```

### Test OAuth Token

```bash
curl http://localhost:8000/api/moov/debug/token | jq

# Output:
# {
#   "success": true,
#   "token_prefix": "eyJhbGciOiJIUzI1NiIs...",
#   "message": "Token fetch successful"
# }
```

### Check Recent Webhooks

```sql
-- In MySQL
SELECT
  event_id,
  event_type,
  processed,
  received_at
FROM GRATLYDB.WEBHOOK_EVENTS
WHERE provider = 'moov'
ORDER BY received_at DESC
LIMIT 10;
```

### Verify Tunnel is Active

```bash
# Check ngrok status
curl http://localhost:4040/api/tunnels | jq '.tunnels[0].public_url'
```

### View Backend Logs

Look for lines like:
```
[INFO] Fetching new Moov OAuth token...
[INFO] OAuth token fetched successfully (expires in 3600s)
[INFO] Recorded webhook event: transfer.completed (id=moov-evt-...)
[DEBUG] Moov return callback received: state=restaurant-1, accountId=..., status=...
```

---

## Troubleshooting

### Error: `nodename nor servname provided`

**Cause**: Backend can't reach Moov API (DNS/network issue)

**Solution**:
- Check internet connection
- Verify `MOOV_BASE_URL` is correct (should be `https://api.moov.io`)
- Test manually: `curl https://api.moov.io/oauth2/token -d "..."`
- Check firewall/proxy settings

### Error: `401 Unauthorized` on OAuth token

**Cause**: Invalid or expired credentials

**Solution**:
- Verify `MOOV_CLIENT_ID` and `MOOV_CLIENT_SECRET` are correct
- Check that credentials are for the same Moov environment (sandbox vs prod)
- Get new credentials from https://moov-sandbox.com/settings/api

### Webhooks Not Arriving

**Tunnel Mode**:
- Check ngrok tunnel is still active: `curl http://localhost:4040/api/tunnels`
- Verify webhook URL in Moov dashboard matches tunnel URL
- Check backend logs for errors
- Manually test: `curl -X POST {PUBLIC_BASE_URL}/api/webhooks/moov -d '{"test": "payload"}'`

**Dev Domain Mode**:
- Check that callbacks are being received: `SELECT * FROM WEBHOOK_EVENTS`
- Verify `MOOV_CALLBACK_MODE=dev_domain` in dev.gratly.ai
- Check that local backend has network access to dev.gratly.ai

### Signature Verification Failed

**Cause**: Webhook signature is invalid

**Solution**:
1. In local mode, can disable verification: `MOOV_DISABLE_WEBHOOK_VERIFY=true`
2. In production: never disable (sign & verify every webhook)
3. Check that webhook secret matches Moov dashboard
4. Ensure raw payload isn't modified before verification

### Callback Not Returning to App

**Tunnel Mode**:
- Check that return URL is correct: `curl {PUBLIC_BASE_URL}/moov/return?state=test`
- Verify frontend route exists: `/moov/return`
- Check browser redirect is working

**Dev Domain Mode**:
- Callback goes to dev.gratly.ai, not localhost
- Frontend must poll `/api/moov/accounts/{type}/{id}/status` to get updates
- Add a polling interval in frontend (e.g., every 2 seconds for 30 seconds)

### iOS/Android WebView Issues

React Native WebView may have issues with:
- Self-signed certificates (tunnel may use HTTPS)
- Cookie/session handling across WebView

**Solutions**:
- Use `allowsInsecureHTTPLoads={true}` in development (NOT production)
- Ensure backend sets proper CORS headers
- Test with actual Moov URLs (not mocked)

---

## Security Notes

### Local Mode Only!

- Never enable `MOOV_DISABLE_WEBHOOK_VERIFY` in production
- Never check in `MOOV_CLIENT_SECRET` to Git
- Always use HTTPS in production (even for callbacks)
- Always verify webhook signatures in production

### Secrets in .env

The `.env` file is in `.gitignore`. Never commit it:

```bash
# Good: Git ignores
echo "MOOV_CLIENT_SECRET=xxx" >> .env

# Bad: Secrets in code/docs
print(os.getenv("MOOV_CLIENT_SECRET"))  # DON'T DO THIS
```

---

## Next Steps

1. **Try tunnel mode first** (5-10 minutes)
2. **Test an onboarding flow** (add bank account)
3. **Verify webhook arrival** (check backend logs)
4. **Test a transfer** (create a payment)
5. **Switch to dev domain mode** if tunnel doesn't work

---

## Support

For issues:

1. Run `python scripts/dev/check_moov_local.py`
2. Check backend logs
3. Review section: [Troubleshooting](#troubleshooting)
4. Check Moov docs: https://docs.moov.io/
5. Ask team on Slack

---

## Files Reference

| File | Purpose |
|------|---------|
| `Backend/moov_config.py` | Config & env var handling |
| `Backend/moov_webhook.py` | Webhook dedup & verification |
| `Backend/moov_local.py` | Return handler & polling endpoints |
| `scripts/dev/moov_tunnel.sh` | Tunnel setup helper |
| `scripts/dev/check_moov_local.py` | Configuration sanity checker |
| `docs/moov_local_testing.md` | This file |

---

**Last Updated**: 2026-01-13
**Status**: Production Ready
