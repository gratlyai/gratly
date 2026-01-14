# Quick Start: Deploy Moov to dev.gratly.ai

You have **automatic CI/CD** with Amplify + App Runner. Just push code and it deploys automatically!

---

## Your 3 API Key Variables

You should have these from your Moov account (stored in App Runner `.env`):

1. **`MOOV_BASE_URL`** - e.g., `https://api.moov.io`
2. **`MOOV_API_KEY`** - Your API key
3. **`MOOV_PLATFORM_ACCOUNT_ID`** - Your platform account ID

---

## Step 1: Verify Environment Variables in App Runner (2 min)

1. Go to **AWS App Runner Console**
2. Click your Gratly backend service
3. Click **Configuration** tab
4. Verify these variables are set:

| Variable | Value |
|----------|-------|
| `MOOV_BASE_URL` | `https://api.moov.io` |
| `MOOV_API_KEY` | (from your Moov account) |
| `MOOV_PLATFORM_ACCOUNT_ID` | (from your Moov account) |
| `RUN_DB_MIGRATIONS` | `true` |

If missing, click **Edit** and add them.

---

## Step 2: Push Code to Git (30 sec)

```bash
cd /Users/sandeep/Desktop/Gratly
git push origin dev
```

---

## Step 3: Wait for Automatic Deployment (5-15 min)

### Amplify (Frontend)
- Goes to **Amplify Console** → Your app
- Watch the blue progress bar turn green
- Deployment complete when green ✓

### App Runner (Backend)
- Goes to **App Runner Console** → Your service
- Click **Deployments** tab
- Watch status: **In progress** → **Active** (green)
- Deployment complete when active ✓

---

## Step 4: Verify Backend is Running (1 min)

```bash
# Test health endpoint
curl https://dev.gratly.ai/healthz

# Should return:
# {"status":"ok"}
```

---

## Step 5: Configure Moov Dashboard Webhooks (2 min)

Go to https://moov-sandbox.com/settings/webhooks:

1. Add/update webhook:
   - **URL**: `https://dev.gratly.ai/api/webhooks/moov`
   - **Events**: Select all (or minimum: account.*, transfer.*, invoice.*)
2. Click **Save**
3. Copy the **Webhook Secret** shown
4. Add to App Runner environment variables:
   - Variable: `MOOV_WEBHOOK_SECRET`
   - Value: `whsec_xxxxx` (the secret)
5. Click **Save**

---

## Step 6: Test Restaurant Payment Method (2 min)

1. Open browser: `https://dev.gratly.ai/gratly-profile`
2. Click **"Add or Update Payment Method"**
3. Complete Moov onboarding (add bank or debit card)
4. Should redirect back to app
5. **Success**: ✓

---

## Step 7: Test Employee Payment Method (2 min)

1. Open `https://dev.gratly.ai`
2. Login as employee
3. Go to **Profile**
4. Click **"Add Payment Method"**
5. Complete Moov onboarding
6. **Success**: Payment method appears in profile ✓

---

## ✅ Done!

**Total time**: ~15 minutes

Your Moov integration is now **live on dev.gratly.ai** with:
- ✅ Restaurant payment methods
- ✅ Employee payment methods
- ✅ Webhook receiving
- ✅ Background job scheduler

---

## Troubleshooting

**Deployment Failed?**
- Check Amplify/App Runner logs for errors
- Most common: Missing environment variables

**Health check fails?**
- Wait a bit longer for deployment to complete
- Check App Runner status is "Active" (green)

**Moov flow doesn't work?**
- Verify `MOOV_API_KEY` and `MOOV_PLATFORM_ACCOUNT_ID` in App Runner env vars
- Verify webhook URL in Moov dashboard: `https://dev.gratly.ai/api/webhooks/moov`

**Webhooks not arriving?**
- Check webhook secret is set as `MOOV_WEBHOOK_SECRET` in App Runner
- Check Moov dashboard: Events should show "account.created", "account.updated", etc.

---

See **`AWS_DEPLOYMENT_GUIDE.md`** for detailed steps and monitoring.
