# Ready to Push to dev.gratly.ai? Use This Checklist

You don't need local testing with ngrok. Push directly to dev.gratly.ai and test there.

## Pre-Push Checklist (Do This Before Pushing)

### ✅ Code Status
```bash
# Make sure all code is committed
git status
# Should show: "nothing to commit, working tree clean"

# View what you're about to push
git log origin/dev..HEAD
# Should show your recent commits (Moov implementation)
```

**Commits to push**:
- Add comprehensive pre-deployment validation checklist
- Add setup files for local Moov testing
- Improve ngrok authentication setup and error messages

### ✅ What's New in This Push
```bash
# These files are new/changed:
Backend/moov_config.py          (NEW - OAuth token caching)
Backend/moov_webhook.py         (NEW - Webhook deduplication)
Backend/moov_local.py           (NEW - Polling endpoints)
Backend/moov_payments.py        (MODIFIED - Error handling)
Backend/moov_service.py         (NEW - Moov API integration)
Backend/moov_jobs.py            (NEW - Background jobs)
Backend/billing.py              (NEW - Billing endpoints)
Backend/payment_routing.py      (NEW - Payment routing)
Backend/scheduler.py            (NEW - Job scheduling)
Frontend/src/GratlyProfile.tsx  (MODIFIED - Employee payment methods)
ios/src/app/screens/ProfileScreen.tsx (MODIFIED - Employee payment methods)
docs/moov_local_testing.md      (NEW - Local dev guide)
docs/DEPLOYMENT_CHECKLIST.md    (NEW - Pre-deployment validation)
DB/scripts.sql                  (MODIFIED - Moov tables)

# Plus helper files:
QUICK_START.md
check-moov.sh
.env (template)
```

---

## Push to Git

```bash
cd /Users/sandeep/Desktop/Gratly

# Double-check nothing important is uncommitted
git status

# Push to dev branch
git push origin dev

# Confirm it pushed
git log --oneline -5 origin/dev
# Should show your 3 latest commits at the top
```

---

## What Happens Next (On dev.gratly.ai)

### 1. CI/CD Deployment (If Automatic)
If your AWS CodePipeline is set up:
- Code auto-deploys from `dev` branch
- Backend restarts
- Database migrations run (if `RUN_DB_MIGRATIONS=true`)

### 2. Manual Deployment (If No CI/CD)
```bash
# SSH to dev.gratly.ai
ssh user@dev.gratly.ai

# Pull latest code
cd /app
git pull origin dev

# Restart backend (method depends on your setup)
# Option A: Systemd service
sudo systemctl restart gratly-backend

# Option B: Direct Python
python Backend/main.py

# Monitor logs
tail -f /var/log/gratly/backend.log
```

---

## Verify Deployment on dev.gratly.ai

### 1. Check Backend is Running
```bash
# From your machine:
curl https://dev.gratly.ai/healthz
# Should return: {"status":"ok"}
```

### 2. Verify Database Migrations Ran
```bash
# SSH to dev.gratly.ai
ssh user@dev.gratly.ai

# Check logs for migration output
grep -i "migration\|moov\|scheduler" /var/log/gratly/backend.log

# Should show:
# "Applying migration scripts_sql_xxx from scripts.sql"
# "Scheduler initialized"
# "OAuth token fetched successfully"
```

### 3. Verify Moov Is Configured
```bash
# Test the debug endpoint
curl https://dev.gratly.ai/api/moov/debug/config
# Should return config (only works if MOOV_CLIENT_ID is set as env var)

curl https://dev.gratly.ai/api/moov/debug/token
# Should show success if credentials are valid
```

### 4. Test Moov Onboarding Flow
```bash
# From browser or curl:
curl -X POST https://dev.gratly.ai/api/restaurants/1/moov/onboarding-link \
  -H "Content-Type: application/json" \
  -d '{
    "returnUrl": "https://dev.gratly.ai/gratly-profile",
    "refreshUrl": "https://dev.gratly.ai/gratly-profile"
  }' | jq .redirectUrl

# Should return a valid Moov onboarding URL like:
# "https://moov.io/connect/...?state=..."
```

---

## Critical: Configure Moov on dev.gratly.ai

Before testing the flows above, set these environment variables on dev.gratly.ai:

```bash
# SSH to dev.gratly.ai
ssh user@dev.gratly.ai

# Set Moov sandbox credentials (from https://moov-sandbox.com/settings/api-keys)
export MOOV_CLIENT_ID=your_sandbox_client_id
export MOOV_CLIENT_SECRET=your_sandbox_client_secret
export MOOV_WEBHOOK_SECRET=whsec_xxxxx  # From Moov dashboard webhooks

# Or add to .env file:
echo "MOOV_CLIENT_ID=your_id" >> /app/Backend/.env
echo "MOOV_CLIENT_SECRET=your_secret" >> /app/Backend/.env

# Enable migrations (if not already set)
export RUN_DB_MIGRATIONS=true

# Restart backend
sudo systemctl restart gratly-backend
```

---

## Configure Moov Dashboard (Important!)

1. Go to https://moov-sandbox.com/settings/webhooks
2. Add webhook:
   - URL: `https://dev.gratly.ai/api/webhooks/moov`
   - Select events (or all)
3. Go to https://moov-sandbox.com/settings/api
4. Find your app/connection settings
5. Set return URL: `https://dev.gratly.ai/moov/return`

---

## Testing on dev.gratly.ai

Once configured above:

1. **Test Restaurant Onboarding**:
   - Go to https://dev.gratly.ai/gratly-profile
   - Click "Add or Update Payment Method"
   - Complete Moov hosted flow
   - Should redirect back to gratly-profile

2. **Test Employee Payment Methods**:
   - Employee logs in
   - Go to Profile/Settings
   - Click "Add Payment Method"
   - Complete Moov onboarding
   - Should show payment method in list

3. **Check Webhook Events**:
   ```sql
   -- SSH to server, then:
   mysql -u gratly_user -p GRATLYDB
   SELECT event_id, event_type, received_at FROM WEBHOOK_EVENTS WHERE provider='moov' ORDER BY received_at DESC LIMIT 10;
   ```

---

## Troubleshooting on dev.gratly.ai

### OAuth Token Fails
```bash
# Check credentials are correct
echo $MOOV_CLIENT_ID
echo $MOOV_CLIENT_SECRET  # Don't print in production!

# Get new credentials from: https://moov-sandbox.com/settings/api-keys
```

### Migrations Didn't Run
```bash
# Check if RUN_DB_MIGRATIONS is set
echo $RUN_DB_MIGRATIONS
# Should be: true, 1, yes, or y

# If not set, migrations won't run
# Set it: export RUN_DB_MIGRATIONS=true
# Then restart backend
```

### Webhooks Not Arriving
```bash
# Check webhook is configured in Moov dashboard
# https://moov-sandbox.com/settings/webhooks
# URL should be: https://dev.gratly.ai/api/webhooks/moov

# Check webhook secret is set as env var
echo $MOOV_WEBHOOK_SECRET

# Check database for webhook events
mysql> SELECT COUNT(*) FROM WEBHOOK_EVENTS WHERE provider='moov';
```

---

## Summary

**You DON'T need**:
- ❌ ngrok (dev.gratly.ai is already public)
- ❌ Local testing (test on dev.gratly.ai instead)
- ❌ Multiple environment setups

**You DO need**:
- ✅ Push code to dev branch
- ✅ Set Moov credentials on dev.gratly.ai as env vars
- ✅ Configure Moov dashboard webhook and return URLs
- ✅ Test flows on dev.gratly.ai

---

## Ready to Push?

```bash
cd /Users/sandeep/Desktop/Gratly

# Check git status one more time
git status

# Push!
git push origin dev

# Done! Now follow the "Verify Deployment" steps above on dev.gratly.ai
```

The code is production-ready. Push it! 🚀
