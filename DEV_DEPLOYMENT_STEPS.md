# Exact Steps to Deploy on dev.gratly.ai

Follow these steps **exactly** in order.

---

## Step 1: SSH Into dev.gratly.ai Server

```bash
ssh user@dev.gratly.ai
```

Replace `user` with your actual username (ask your DevOps/IT team if you don't know).

You should see a prompt like:
```
user@dev-server:~$
```

---

## Step 2: Pull Latest Code

```bash
cd /app
git pull origin dev
```

You should see output like:
```
remote: Counting objects: 5, done.
Receiving objects: 100% (5/5), done.
Unpacking objects: 100% (5/5), done.
From github.com/...
   abc1234..2a6afa6  dev -> origin/dev
Updating abc1234..2a6afa6
Fast-forward
 DEPLOYMENT_READY.md         | 276 ++++
 scripts/dev/moov_tunnel.sh  |  20 +
 ...
```

---

## Step 3: Check Current Environment Variables

```bash
# Check what's currently set
env | grep -E "MOOV|RUN_DB|DB_"
```

Look for:
- `MOOV_CLIENT_ID` - Should exist or be empty
- `MOOV_CLIENT_SECRET` - Should exist or be empty
- `RUN_DB_MIGRATIONS` - Should exist or be empty
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` - Should already exist

---

## Step 4: Get Moov Sandbox Credentials

**On your personal machine** (NOT on dev.gratly.ai):

1. Go to: https://moov-sandbox.com/settings/api-keys
2. Sign in to your Moov sandbox account
3. Copy your **Client ID** and **Client Secret**
4. You'll use these in the next step

---

## Step 5: Set Moov Environment Variables on Server

**Back on dev.gratly.ai server**:

### Option A: Set in .env file (if using local .env)

```bash
# Check if Backend/.env exists
ls -la /app/Backend/.env

# If it exists, edit it:
nano /app/Backend/.env
```

Add or update these lines:
```
MOOV_CLIENT_ID=your_client_id_from_step_4
MOOV_CLIENT_SECRET=your_client_secret_from_step_4
MOOV_LOCAL_MODE=true
RUN_DB_MIGRATIONS=true
```

Save: `Ctrl+O`, `Enter`, `Ctrl+X`

### Option B: Set as System Environment Variables (Recommended for AWS)

```bash
# Add to your systemd service file or AWS environment
# If using systemd, edit the service file:
sudo nano /etc/systemd/system/gratly-backend.service

# Under [Service] section, add:
Environment="MOOV_CLIENT_ID=your_client_id_from_step_4"
Environment="MOOV_CLIENT_SECRET=your_client_secret_from_step_4"
Environment="MOOV_LOCAL_MODE=true"
Environment="RUN_DB_MIGRATIONS=true"

# Save: Ctrl+O, Enter, Ctrl+X

# Reload systemd:
sudo systemctl daemon-reload
```

### Option C: AWS Elastic Beanstalk

If using Elastic Beanstalk:
```bash
# Go to EB console → Configurations → Updates and Deployments
# Add environment variables:
MOOV_CLIENT_ID=your_client_id_from_step_4
MOOV_CLIENT_SECRET=your_client_secret_from_step_4
MOOV_LOCAL_MODE=true
RUN_DB_MIGRATIONS=true
```

---

## Step 6: Verify Environment Variables Are Set

```bash
# Check they were saved
echo $MOOV_CLIENT_ID
echo $MOOV_CLIENT_SECRET
echo $RUN_DB_MIGRATIONS

# Should output your values (or blank if not yet reloaded)
```

If blank, you may need to **log out and log back in** or **reload the terminal**:
```bash
source ~/.bashrc
# or
logout  # then SSH back in
```

---

## Step 7: Restart Backend Service

```bash
# If using systemd:
sudo systemctl restart gratly-backend

# If running Python directly:
# Kill current process:
pkill -f "python.*main.py"

# Start in background:
cd /app/Backend
nohup python main.py > /tmp/gratly.log 2>&1 &

# Or use screen/tmux:
screen -S gratly-backend
cd /app/Backend
python main.py
# Ctrl+A then D to detach
```

---

## Step 8: Monitor Startup (Watch for Migrations & Scheduler)

```bash
# If using systemd, check logs:
sudo journalctl -u gratly-backend -f --lines=50

# If running directly, watch output:
tail -f /tmp/gratly.log

# Look for these success messages:
# "Applying migration scripts_sql_xxx from scripts.sql"
# "Migration scripts_sql_xxx applied successfully"
# "Scheduler initialized"
# "Application startup complete"
```

Wait until you see **"Application startup complete"** - this means backend is ready.

Press `Ctrl+C` to exit logs.

---

## Step 9: Verify Backend Is Running

```bash
# Test health endpoint
curl http://localhost:8000/healthz

# Should return:
# {"status":"ok"}
```

---

## Step 10: Verify Database Migrations Ran

```bash
# Connect to database
mysql -u gratly_user -p GRATLYDB
# (It will ask for password)

# Check if migrations ran:
SELECT MIGRATION_KEY, APPLIED_AT FROM MIGRATIONS ORDER BY APPLIED_AT DESC;

# Should show entry like:
# scripts_sql_abc123xyz | 2026-01-13 22:30:45

# Check if Moov tables exist:
SHOW TABLES LIKE 'MOOV%';
# Should show: MOOV_ACCOUNTS, MOOV_CALLBACKS, MOOV_PAYMENT_METHODS, etc.

# Exit MySQL:
exit
```

---

## Step 11: Verify Moov Configuration

```bash
# Check debug endpoint
curl http://localhost:8000/api/moov/debug/config

# Should return JSON like:
# {
#   "local_mode": true,
#   "callback_mode": "tunnel",
#   "webhook_url": "https://dev.gratly.ai/api/webhooks/moov",
#   "webhook_verification_disabled": false
# }

# Test OAuth token
curl http://localhost:8000/api/moov/debug/token

# Should return:
# {
#   "success": true,
#   "token_prefix": "eyJhbGciOiJIUzI1NiIs...",
#   "message": "Token fetch successful"
# }
```

If `"success": false`, your credentials are wrong. Go back to Step 5 and double-check.

---

## Step 12: Configure Moov Dashboard

**On your personal machine** (https://moov-sandbox.com):

### 12a: Add Webhook

1. Go to: https://moov-sandbox.com/settings/webhooks
2. Click **"Add Webhook"** (or update existing)
3. Set:
   - **URL**: `https://dev.gratly.ai/api/webhooks/moov`
   - **Events**: Select all (or at minimum: account.*, transfer.*, invoice.*)
4. Click **Save**
5. **Copy the Webhook Secret** that appears
6. **Important**: Set this as environment variable on dev.gratly.ai

### 12b: Set Webhook Secret on Server

Back on dev.gratly.ai:
```bash
# If using .env:
echo "MOOV_WEBHOOK_SECRET=whsec_xxxxx" >> /app/Backend/.env

# If using systemd env vars, add to service file:
Environment="MOOV_WEBHOOK_SECRET=whsec_xxxxx"
sudo systemctl daemon-reload
sudo systemctl restart gratly-backend
```

### 12c: Add Return/Callback URL (if available in Moov dashboard)

Some Moov settings let you configure return URLs:
1. Look for: Settings → Connected Apps or OAuth Configuration
2. Set return URL to: `https://dev.gratly.ai/moov/return`

---

## Step 13: Test Moov Onboarding Flow - Restaurant

Open a browser and test:

```bash
# URL bar:
https://dev.gratly.ai/gratly-profile
```

1. Click **"Add or Update Payment Method"** button
2. You should be redirected to Moov hosted onboarding
3. Complete the flow (add bank account or debit card)
4. You should be redirected back to `https://dev.gratly.ai/gratly-profile`

**Success**: You're back on the app after completing Moov onboarding ✓

---

## Step 14: Test Moov Onboarding Flow - Employee

```bash
# Employee login
https://dev.gratly.ai
# Login as an employee account
```

1. Go to **Profile** or **Settings**
2. Click **"Add Payment Method"** or **"Add Payment Method"**
3. Should launch Moov onboarding
4. Complete bank/debit card addition
5. Should return to profile with payment method added

**Success**: Payment method appears in your profile ✓

---

## Step 15: Verify Webhook Events Were Received

```bash
# SSH back to dev.gratly.ai, then:
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
# account.updated
# account.created
# etc.

exit
```

**Success**: Webhooks are arriving ✓

---

## Step 16: Verify Background Jobs Are Running

```bash
# SSH to dev.gratly.ai, then:
sudo journalctl -u gratly-backend -f --lines=100 | grep -i "apscheduler\|job\|scheduler"

# Or check logs directly:
grep -i "added job\|job started\|scheduler" /var/log/gratly/backend.log | tail -20

# Should show something like:
# "Added job: nightly_debit_batch_job"
# "Added job: run_collections"
# "Added job: run_payout_job"
# "Added job: run_billing_job"
```

---

## ✅ Deployment Complete!

If you passed all the checks above, Moov is now **fully deployed** on dev.gratly.ai.

### Summary of What's Running

- ✅ Backend with Moov integration
- ✅ Database with Moov tables and schema
- ✅ OAuth token caching and refresh
- ✅ Webhook receiving and processing
- ✅ Background job scheduler
- ✅ Onboarding flows (web + mobile)
- ✅ Payment method management

---

## Troubleshooting

### OAuth Token Fails ("success": false)

```bash
# Check credentials are correct
echo $MOOV_CLIENT_ID
echo $MOOV_CLIENT_SECRET

# Get new credentials from:
# https://moov-sandbox.com/settings/api-keys

# Update .env or env vars
# Restart backend
```

### Migrations Didn't Run

```bash
# Check if RUN_DB_MIGRATIONS is set
echo $RUN_DB_MIGRATIONS
# Should output: true, 1, yes, or y

# If empty, set it:
export RUN_DB_MIGRATIONS=true

# Check logs for migration errors:
sudo journalctl -u gratly-backend -f | grep -i migration
```

### Webhooks Not Arriving

```bash
# Verify webhook URL in Moov dashboard:
# https://moov-sandbox.com/settings/webhooks
# Should be: https://dev.gratly.ai/api/webhooks/moov

# Check if webhook secret is set:
echo $MOOV_WEBHOOK_SECRET

# Verify endpoint is accessible:
curl https://dev.gratly.ai/api/webhooks/moov -X POST -d '{"test": "payload"}'
# Should NOT give 404
```

### Backend Not Starting

```bash
# Check logs for errors:
sudo journalctl -u gratly-backend -f --lines=100

# Or if running directly:
cd /app/Backend
python main.py
# Watch output for error messages

# Common issues:
# - MOOV_CLIENT_SECRET missing or wrong
# - Database connection failed
# - Port 8000 already in use
```

---

## Next: Monitor in Production

After deployment:

1. **Daily**: Check webhook events are arriving
   ```sql
   SELECT COUNT(*) FROM WEBHOOK_EVENTS WHERE provider='moov' AND DATE(received_at) = CURDATE();
   ```

2. **Daily**: Check background jobs ran
   ```bash
   grep -i "job" /var/log/gratly/backend.log | tail -5
   ```

3. **Weekly**: Check for errors in logs
   ```bash
   grep -i "error\|failed" /var/log/gratly/backend.log | wc -l
   ```

---

**You're done! Moov is now live on dev.gratly.ai.** 🚀
