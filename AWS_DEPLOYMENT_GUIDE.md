# AWS Deployment Guide - Amplify + App Runner

Your setup is **fully automated**:
- **Frontend**: AWS Amplify (auto-deploys on Git push)
- **Backend**: AWS App Runner (auto-deploys on Git push)

No manual SSH or restarts needed!

---

## Step 1: Verify Environment Variables Are Set on App Runner

### 1a: Go to AWS Console

1. Search for **"App Runner"** in AWS Console
2. Click on your Gratly backend service (likely named `gratly-backend` or similar)

### 1b: Configure Environment Variables

In the App Runner service page:
1. Click **Configuration** tab
2. Scroll down to **Environment variables**
3. Click **Edit** to add variables

Add these 3 variables (from your `.env` file):

| Variable | Value | Where to Get |
|----------|-------|-------------|
| `MOOV_BASE_URL` | `https://api.moov.io` (or sandbox URL) | Moov dashboard |
| `MOOV_API_KEY` | your_api_key | Your `.env` file / Moov credentials |
| `MOOV_PLATFORM_ACCOUNT_ID` | your_platform_account_id | Your `.env` file / Moov credentials |

Also add for database migrations:

| Variable | Value |
|----------|-------|
| `RUN_DB_MIGRATIONS` | `true` |

**Important**: These should already be set from previous deployment. Just verify or update them.

### 1c: Save Changes

Click **Save** - App Runner will automatically restart with new env vars.

---

## Step 2: Verify Frontend Environment Variables (Amplify)

### 2a: Go to AWS Console

1. Search for **"Amplify"** in AWS Console
2. Click on your Gratly frontend app

### 2b: Check Environment Variables

1. Click **App Settings** (left sidebar)
2. Click **Environment variables**
3. Verify these are set (if needed for Moov):

| Variable | Value |
|----------|-------|
| `REACT_APP_API_URL` | `https://dev.gratly.ai` (or your actual backend URL) |
| `REACT_APP_MOOV_SANDBOX` | `true` (if using sandbox) |

---

## Step 3: Push Code to dev Branch

On your local machine:

```bash
cd /Users/sandeep/Desktop/Gratly

# Verify git status is clean
git status
# Should show: "working tree clean"

# Push to dev branch
git push origin dev

# Confirm it pushed
git log origin/dev --oneline -3
# Should show your recent commits at top
```

---

## Step 4: Automatic Deployment Starts

### Frontend (Amplify)
1. Go to **Amplify Console**
2. Look for your app
3. You should see a new deployment in progress (blue bar at top)
4. Wait for it to complete (usually 2-5 minutes)
5. Check the status: **Hosting environments** → Your branch
6. Should show green checkmark when done

### Backend (App Runner)
1. Go to **App Runner Console**
2. Click your service
3. You should see a new deployment in **Deployments** tab
4. Status will show: **In progress** → **Active**
5. Wait for it to complete (usually 3-10 minutes)
6. Should show green checkmark when done

---

## Step 5: Verify Backend Deployment

Once App Runner shows **Active** (green):

```bash
# Test the backend API
curl https://dev.gratly.ai/healthz

# Should return:
# {"status":"ok"}
```

---

## Step 6: Monitor Deployment Logs

### Check Frontend Logs (Amplify)
1. Amplify Console → Your app
2. Click the deployment in progress
3. Scroll down to see build logs
4. Look for: "Frontend deployed successfully"

### Check Backend Logs (App Runner)
1. App Runner Console → Your service
2. Click **Logs** tab
3. Look for:
   - "Applying migration scripts_sql_xxx from scripts.sql"
   - "Migration... applied successfully"
   - "Scheduler initialized"
   - "Application startup complete"

---

## Step 7: Configure Moov Dashboard

Go to https://moov-sandbox.com and configure:

### 7a: Add Webhook URL
1. Settings → **Webhooks**
2. Add webhook with URL: `https://dev.gratly.ai/api/webhooks/moov`
3. Copy the **Webhook Secret** that appears
4. Add this to App Runner environment variables:
   - Variable: `MOOV_WEBHOOK_SECRET`
   - Value: `whsec_xxxxx` (the secret you copied)

### 7b: Set Return URL (if available)
Some Moov settings allow configuring return URLs:
1. Settings → **Connected Apps** or **OAuth Configuration**
2. Set return URL: `https://dev.gratly.ai/moov/return`

---

## Step 8: Test Moov Flows

### Test Restaurant Payment Method
```bash
# In browser:
https://dev.gratly.ai/gratly-profile
```

1. Click **"Add or Update Payment Method"**
2. You should be redirected to Moov onboarding
3. Complete bank account or debit card setup
4. You should be redirected back to gratly-profile

**Success**: ✓ Restaurant onboarding works

### Test Employee Payment Method
```bash
# In browser:
https://dev.gratly.ai
```

1. Log in as an employee
2. Go to **Profile** or **Settings**
3. Click **"Add Payment Method"**
4. Complete Moov onboarding
5. Payment method should appear in profile

**Success**: ✓ Employee payment methods work

---

## Step 9: Verify Webhooks Are Arriving

```bash
# SSH to your database server (or RDS console):
mysql -u gratly_user -p GRATLYDB

# Check webhook events:
SELECT
  event_id,
  event_type,
  received_at
FROM WEBHOOK_EVENTS
WHERE provider='moov'
ORDER BY received_at DESC
LIMIT 10;

# Should show events like:
# account.verified
# account.created
# transfer.completed
# etc.

exit
```

**Success**: ✓ Webhooks are being received

---

## Step 10: Verify Background Jobs

```bash
# Check if jobs are registered by viewing App Runner logs:
```

In **App Runner Logs**:
1. Look for lines containing: `Added job:`
2. Should show:
   - `Added job: nightly_debit_batch_job`
   - `Added job: run_collections`
   - `Added job: run_payout_job`
   - `Added job: run_billing_job`

**Success**: ✓ Background jobs are running

---

## Complete Checklist

- [ ] Environment variables set in App Runner (MOOV_CLIENT_ID, MOOV_CLIENT_SECRET, RUN_DB_MIGRATIONS=true)
- [ ] Code pushed to dev branch
- [ ] Amplify deployment completed (green checkmark)
- [ ] App Runner deployment completed (green checkmark)
- [ ] Backend health check passes: `curl https://dev.gratly.ai/healthz` → `{"status":"ok"}`
- [ ] Moov webhook URL configured: `https://dev.gratly.ai/api/webhooks/moov`
- [ ] Moov webhook secret set as `MOOV_WEBHOOK_SECRET` in App Runner
- [ ] Restaurant onboarding flow tested (✓ redirects back from Moov)
- [ ] Employee payment methods flow tested (✓ can add payment method)
- [ ] Webhook events arriving (✓ visible in WEBHOOK_EVENTS table)
- [ ] Background jobs registered (✓ visible in App Runner logs)

---

## Troubleshooting

### Amplify Deployment Failed
1. Go to **Amplify Console** → Your app
2. Click the failed deployment
3. Check build logs for errors (usually in the cyan/blue section)
4. Common issues:
   - Syntax error in code (check git log)
   - Missing environment variable
   - Build timeout

### App Runner Deployment Failed
1. Go to **App Runner Console** → Your service
2. Click **Deployments** tab
3. Click the failed deployment
4. Check logs for:
   - Python syntax errors
   - Database migration failures
   - Missing dependencies
5. Redeploy by pushing code again: `git push origin dev`

### API Request Fails (502 error)
```bash
# In App Runner environment variables, verify:
MOOV_BASE_URL=https://api.moov.io
MOOV_API_KEY=correct_api_key_from_env
MOOV_PLATFORM_ACCOUNT_ID=correct_account_id_from_env

# Check your .env file for correct values
```

### Migrations Didn't Run
```bash
# Check App Runner environment variables:
RUN_DB_MIGRATIONS=true

# Should be "true" not "false" or empty
```

### Webhooks Not Arriving
1. Verify webhook URL in Moov dashboard: `https://moov-sandbox.com/settings/webhooks`
   - Should be: `https://dev.gratly.ai/api/webhooks/moov`
2. Check webhook secret is set in App Runner: `MOOV_WEBHOOK_SECRET=whsec_xxxxx`
3. Test manually (from Moov dashboard) to trigger a webhook
4. Check database for events: `SELECT * FROM WEBHOOK_EVENTS WHERE provider='moov' ORDER BY received_at DESC LIMIT 1`

---

## Monitoring After Deployment

### Daily Checks
```bash
# Check webhooks arrived today
mysql -u gratly_user -p GRATLYDB
SELECT COUNT(*) FROM WEBHOOK_EVENTS
WHERE provider='moov' AND DATE(received_at) = CURDATE();
```

### Check Error Logs
1. **App Runner Logs** - Search for "error" or "failed"
2. **Amplify Logs** - Search for failed builds

### Monitor Background Jobs
- Jobs run at:
  - **1 AM UTC**: Payout job (`run_payout_job`)
  - **2 AM UTC**: Nightly debit job (`nightly_debit_batch_job`)
  - **3 AM UTC**: Collections job (`run_collections`)
  - **1st of month**: Billing job (`run_billing_job`)

Check logs at these times to see jobs running.

---

## Summary

Since you have **automatic AWS deployment**:

1. **Push code** → Git
2. **Amplify auto-deploys frontend** (2-5 min)
3. **App Runner auto-deploys backend** (3-10 min)
4. **Verify** with health check + manual testing

**No manual SSH, no manual restarts needed!**

The only pre-configuration needed:
- ✅ Moov credentials in App Runner env vars
- ✅ Database configured
- ✅ Moov webhook URL configured in Moov dashboard

---

**You're ready to deploy! Just push the code.** 🚀

```bash
git push origin dev
```

Then watch Amplify and App Runner deploy automatically. Done!
