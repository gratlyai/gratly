# Pre-Deployment Validation Checklist for dev.gratly.ai

**Purpose**: Validate that all critical components are configured before pushing Moov code to dev.gratly.ai.

**Estimated Confidence**: Currently 30-40% "just works". With this checklist completed: 70-80% confidence.

---

## Question 1: Will code auto-deploy to AWS?

### Current Status
❌ **NO CI/CD PIPELINE FOUND** - No automated deployment infrastructure detected.

### Investigation Results
Searched repo root for CI/CD config files:
- ❌ `.github/workflows/` (GitHub Actions)
- ❌ `.gitlab-ci.yml` (GitLab CI)
- ❌ `buildspec.yml` (AWS CodeBuild)
- ❌ `Jenkinsfile` (Jenkins)
- ❌ `.circleci/config.yml` (CircleCI)
- ❌ `.travis.yml` (Travis CI)

### What You Need to Check
1. **AWS Console**: Does your AWS account have CodePipeline configured?
   - Go to AWS → CodePipeline → Pipelines
   - Check if "gratly" or "dev-gratly" pipeline exists
   - If yes: What branch triggers it? (dev, main, etc.)

2. **Git Remote**: Where is your repo hosted?
   ```bash
   git remote -v
   ```
   - **GitHub**: Check for webhook that triggers CodeBuild
   - **AWS CodeCommit**: Check CodePipeline console for triggers
   - **Other**: Confirm CI/CD setup location

3. **Manual Deployment Alternative**
   If no CI/CD exists, you'll need to:
   ```bash
   # Option A: Push to branch that AWS monitors (if CodePipeline exists)
   git push origin dev

   # Option B: SSH into dev.gratly.ai and pull manually
   ssh user@dev.gratly.ai
   cd /app
   git pull origin dev
   python Backend/main.py  # Restart backend
   ```

### Action Items
- [ ] Check AWS CodePipeline console for existing pipeline
- [ ] Confirm CI/CD location (GitHub Actions, CodeBuild, manual, etc.)
- [ ] Test deployment process: Push to dev branch and verify change appears on dev.gratly.ai

---

## Question 2: Will scripts.sql run automatically on the database?

### Current Status
✅ **BUILT-IN MIGRATION SYSTEM EXISTS** - Auto-migrations are available but must be enabled.

### How It Works

**Backend/main.py** (lines 248-251):
```python
@app.on_event("startup")
def _run_startup_migrations() -> None:
    if _should_run_migrations():                    # ← Check if enabled
        _apply_scripts_sql_once()                   # ← Run migrations
    init_scheduler()
```

**Migration Trigger**: `RUN_DB_MIGRATIONS` environment variable

```python
def _should_run_migrations() -> bool:
    raw = (_get_env_or_ini("RUN_DB_MIGRATIONS") or "").strip().lower()
    return raw in ("1", "true", "yes", "y")
```

**Migration Tracking**:
- Creates table: `GRATLYDB.MIGRATIONS` (stores applied migrations)
- Migration key: SHA256 hash of `DB/scripts.sql` (first 12 chars)
- Status: Only runs once per unique `scripts.sql` content
- Lock: Uses `GET_LOCK('gratly_migrations', 30)` to prevent concurrent runs

**Idempotent Errors** (ignored):
- Error 1050: Table already exists
- Error 1060: Column already exists
- Error 1061: Duplicate key name
- Error 1091: Can't drop column

### Prerequisites

For migrations to run automatically, BOTH must be true:

1. **Environment Variable Set**
   ```bash
   # On dev.gratly.ai server, check:
   echo $RUN_DB_MIGRATIONS

   # Should output one of: 1, true, yes, y
   # If empty, migrations WON'T RUN
   ```

2. **Database Connection Available**
   - Backend must be able to reach MySQL/MariaDB
   - Check: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
   ```bash
   # These must all be set:
   echo $DB_HOST       # e.g., localhost or db.internal.aws
   echo $DB_USER       # e.g., gratly_user
   echo $DB_PASSWORD   # (should not be empty)
   echo $DB_NAME       # e.g., GRATLYDB
   ```

### Verification Steps

1. **SSH into dev.gratly.ai** and check env vars:
   ```bash
   # SSH first
   ssh user@dev.gratly.ai

   # Check migration env var
   grep RUN_DB_MIGRATIONS /app/.env
   # OR if using AWS Systems Manager Parameter Store:
   aws ssm get-parameters --names RUN_DB_MIGRATIONS
   ```

2. **After deploying code**, check backend logs:
   ```bash
   tail -f /app/backend.log | grep -i migration

   # Success output:
   # "Applying migration scripts_sql_abc123xyz... from scripts.sql."
   # "Migration scripts_sql_abc123xyz... applied successfully."

   # Skip output (already ran):
   # "Migration scripts_sql_abc123xyz... already applied; skipping."

   # Error output:
   # (database errors, missing scripts.sql, etc.)
   ```

3. **Verify in database** (if you have DB access):
   ```sql
   -- Check what migrations have run
   SELECT MIGRATION_KEY, APPLIED_AT
   FROM GRATLYDB.MIGRATIONS
   ORDER BY APPLIED_AT DESC;

   -- Should show entry like:
   -- scripts_sql_abc123xyz | 2026-01-13 15:30:45
   ```

### Action Items
- [ ] SSH into dev.gratly.ai
- [ ] Confirm `RUN_DB_MIGRATIONS=true` (or 1/yes/y) is set
- [ ] Confirm database credentials are set: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- [ ] After next deployment, check logs for migration output
- [ ] Verify new Moov tables exist in GRATLYDB

---

## Question 3: Will Moov code work on dev.gratly.ai?

### Current Status
🟡 **MOSTLY READY** - Code is complete, but configuration is critical.

### Probability Assessment

| Scenario | Confidence | Blocker |
|----------|------------|---------|
| All config set + migrations run | **90%** ✅ | None |
| Migrations run, some config missing | **40%** ⚠️ | Partial onboarding failure |
| No migrations, config set | **0%** ❌ | Database tables missing |
| Nothing configured | **0%** ❌ | Everything fails |

---

## Critical Checklist: 5 Items That MUST Be Configured

### 1. ✅ Database Schema

**Must Have**: All tables created by `DB/scripts.sql`

Tables required for Moov:
- `GRATLYDB.MOOV_ACCOUNTS` (account status tracking)
- `GRATLYDB.MOOV_CALLBACKS` (return callbacks)
- `GRATLYDB.WEBHOOK_EVENTS` (webhook audit trail)
- `GRATLYDB.MOOV_PAYMENT_METHODS` (stored payment methods)
- `GRATLYDB.TRANSFERS` (transfers/debits/payouts)
- `GRATLYDB.PAYOUT_ITEMS` (payout tracking)
- `GRATLYDB.MONTHLY_FEE_CHARGES` (billing charges)
- `GRATLYDB.NIGHTLY_DEBIT_BATCHES` (debit tracking)

**Verification**:
```sql
USE GRATLYDB;
SHOW TABLES LIKE 'MOOV%';
SHOW TABLES LIKE 'WEBHOOK%';
SHOW TABLES LIKE 'TRANSFERS%';
SHOW TABLES LIKE 'PAYOUT%';
SHOW TABLES LIKE 'MONTHLY%';
SHOW TABLES LIKE 'NIGHTLY%';
```

**Action Item**:
- [ ] Verify all tables exist OR set `RUN_DB_MIGRATIONS=true` to auto-create

---

### 2. ✅ Moov OAuth Credentials

**Must Have**: Valid OAuth credentials from Moov Sandbox

```bash
# On dev.gratly.ai, verify these are set:
echo $MOOV_CLIENT_ID       # Should NOT be empty
echo $MOOV_CLIENT_SECRET   # Should NOT be empty (don't print!)
```

**Get Credentials**:
1. Go to https://moov-sandbox.com
2. Sign in
3. Settings → API Keys
4. Copy "Client ID" and "Client Secret"

**Set on dev.gratly.ai** (choose one):

**Option A: .env file** (if using local .env)
```bash
# SSH into server
ssh user@dev.gratly.ai
cd /app
echo "MOOV_CLIENT_ID=your_id_here" >> Backend/.env
echo "MOOV_CLIENT_SECRET=your_secret_here" >> Backend/.env
```

**Option B: Environment variables** (recommended for AWS)
```bash
# AWS EC2 Instance: Add to /etc/environment or systemd service
export MOOV_CLIENT_ID=your_id_here
export MOOV_CLIENT_SECRET=your_secret_here

# Or AWS Systems Manager Parameter Store:
aws ssm put-parameter --name MOOV_CLIENT_ID --value "your_id" --type String
aws ssm put-parameter --name MOOV_CLIENT_SECRET --value "your_secret" --type SecureString
```

**Action Items**:
- [ ] Get credentials from Moov Sandbox dashboard
- [ ] Set as environment variables on dev.gratly.ai
- [ ] Test with: `curl http://dev.gratly.ai:8000/api/moov/debug/token` (should show success)

---

### 3. ✅ Moov Webhook URL Configuration

**Must Have**: Moov Dashboard webhook URL points to dev.gratly.ai

**Current Backend URL**:
- Dev onboarding return: `https://dev.gratly.ai/moov/return`
- Webhooks: `https://dev.gratly.ai/api/webhooks/moov`

**Steps**:
1. Go to https://moov-sandbox.com/settings/webhooks
2. Add or update webhook:
   - **URL**: `https://dev.gratly.ai/api/webhooks/moov`
   - **Events**: Select all events (or at minimum: account.*, transfer.*, invoice.*)
3. Copy the **Webhook Secret** from dashboard
4. Save webhook secret in dev.gratly.ai:
   ```bash
   # SSH to server and add to .env or env vars:
   export MOOV_WEBHOOK_SECRET=whsec_xxxxx
   ```

**Verification**:
```bash
# Check webhook config via debug endpoint:
curl https://dev.gratly.ai:8000/api/moov/debug/config | jq '.webhook_url'

# Should output:
# "https://dev.gratly.ai/api/webhooks/moov"
```

**Action Items**:
- [ ] Set webhook URL in Moov dashboard to: `https://dev.gratly.ai/api/webhooks/moov`
- [ ] Copy webhook secret from Moov dashboard
- [ ] Set `MOOV_WEBHOOK_SECRET` environment variable on dev.gratly.ai

---

### 4. ✅ Moov Return/Callback URL Configuration

**Must Have**: Moov sends users back to correct URL after onboarding

**Current Configuration**:
```python
# Backend/moov_payments.py uses:
link = create_onboarding_link(
    moov_account_id,
    returnUrl=payload.returnUrl,  # ← Passed by frontend
    refreshUrl=payload.refreshUrl
)
```

**Frontend Must Pass**:
- `returnUrl`: Where Moov redirects after onboarding
  - Example: `https://dev.gratly.ai/gratly-profile?moov_callback=complete`
  - This must exist as a valid frontend route

**Verification**:
1. Go to https://dev.gratly.ai/gratly-profile
   - Should load successfully (not 404)
   - Should handle `?moov_callback=complete` query param

2. Test onboarding flow manually:
   ```bash
   # Start Moov onboarding for restaurant
   curl -X POST https://dev.gratly.ai/api/restaurants/1/moov/onboarding-link \
     -H "Content-Type: application/json" \
     -d '{
       "returnUrl": "https://dev.gratly.ai/gratly-profile",
       "refreshUrl": "https://dev.gratly.ai/gratly-profile"
     }'

   # Should return:
   # { "redirectUrl": "https://moov.io/...hosted-onboarding-url..." }
   ```

**Action Items**:
- [ ] Verify `/gratly-profile` route exists on frontend
- [ ] Test onboarding endpoint returns valid Moov URL
- [ ] Test full flow: Click "Add Payment Method" → Moov flow → Redirect back to app

---

### 5. ✅ APScheduler Background Jobs

**Must Have**: Background job scheduler running for daily tasks

Jobs that need to run:
- **nightly_debit_batch_job**: Debits scheduled for restaurants (nightly at 2 AM)
- **run_collections**: Collects failed debits (nightly at 3 AM)
- **run_payout_job**: Pays out restaurants (nightly at 1 AM)
- **run_billing_job**: Bills restaurants monthly fees (monthly on 1st)

**Current Status** (Backend/main.py):
```python
@app.on_event("startup")
def _run_startup_migrations() -> None:
    if _should_run_migrations():
        _apply_scripts_sql_once()
    init_scheduler()  # ← Starts APScheduler
```

**Verification**:
```bash
# Check backend logs for scheduler startup:
tail -f /app/backend.log | grep -i "apscheduler\|scheduler"

# Should show:
# "Scheduler initialized"
# "Added job: nightly_debit_batch_job"
# "Added job: run_collections"
# "Added job: run_payout_job"
# "Added job: run_billing_job"
```

**Action Items**:
- [ ] Verify backend logs show scheduler initialized on startup
- [ ] Check that all 4 jobs are registered
- [ ] Monitor logs for job executions (timing: 1 AM, 2 AM, 3 AM UTC, 1st of month)

---

## Deployment Workflow

### Step 1: Pre-Deployment Check (Do This First!)
```bash
# On your local machine:
cd /Users/sandeep/Desktop/Gratly

# Run sanity checker with updated config
MOOV_CLIENT_ID=your_sandbox_id \
MOOV_CLIENT_SECRET=your_sandbox_secret \
PUBLIC_BASE_URL=https://dev.gratly.ai \
python scripts/dev/check_moov_local.py

# Should output: "All checks passed!"
```

### Step 2: Configure dev.gratly.ai
```bash
# SSH into server
ssh user@dev.gratly.ai

# Set environment variables (one-time setup)
sudo tee -a /etc/environment << EOF
RUN_DB_MIGRATIONS=true
MOOV_CLIENT_ID=your_sandbox_id
MOOV_CLIENT_SECRET=your_sandbox_secret
MOOV_WEBHOOK_SECRET=whsec_xxxxx
DB_HOST=localhost
DB_USER=gratly_user
DB_PASSWORD=your_password
DB_NAME=GRATLYDB
EOF

# Restart to load new env vars
sudo systemctl restart gratly-backend
```

### Step 3: Deploy Code
```bash
# Option A: If CI/CD pipeline exists
git push origin dev

# Option B: Manual deployment
ssh user@dev.gratly.ai
cd /app
git pull origin dev
python Backend/main.py  # Or restart systemd service
```

### Step 4: Monitor Deployment
```bash
# SSH into server and watch logs:
ssh user@dev.gratly.ai
tail -f /app/backend.log

# Look for:
# ✅ "RUN_DB_MIGRATIONS enabled" or "Migration scripts_sql_xxx... applied"
# ✅ "OAuth token fetched successfully"
# ✅ "Scheduler initialized"
# ✅ "Application startup complete"
```

### Step 5: Verify Manually
```bash
# Test API endpoints:
curl https://dev.gratly.ai/healthz                          # Health check
curl https://dev.gratly.ai/api/moov/debug/config           # Moov config
curl https://dev.gratly.ai/api/moov/debug/token            # OAuth token test

# Test UI:
# 1. Navigate to https://dev.gratly.ai/gratly-profile
# 2. Click "Add or Update Payment Method"
# 3. Complete Moov onboarding flow
# 4. Verify redirect back to app works
```

---

## Troubleshooting

### Migrations not running
```bash
# Check env var:
echo $RUN_DB_MIGRATIONS

# Check logs:
grep -i migration /app/backend.log

# Manual fix:
RUN_DB_MIGRATIONS=true python Backend/main.py
```

### OAuth token fails
```bash
# Verify credentials in Moov dashboard match env vars:
echo $MOOV_CLIENT_ID
echo $MOOV_CLIENT_SECRET  # Don't print in real life!

# Test manually:
curl https://api.moov.io/oauth2/token \
  -d "client_id=$MOOV_CLIENT_ID" \
  -d "client_secret=$MOOV_CLIENT_SECRET" \
  -d "grant_type=client_credentials"
```

### Webhooks not arriving
```bash
# Check webhook configuration:
curl https://dev.gratly.ai/api/moov/debug/config | jq '.webhook_url'

# Verify in Moov dashboard: https://moov-sandbox.com/settings/webhooks
# Should show URL: https://dev.gratly.ai/api/webhooks/moov

# Check webhook events received:
mysql> SELECT COUNT(*) FROM GRATLYDB.WEBHOOK_EVENTS WHERE provider='moov';
```

---

## Summary: Confidence Levels

| Item | Status | Impact | Action |
|------|--------|--------|--------|
| Code is ready | ✅ Complete | - | Push to dev |
| Database migrations | 🟡 Conditional | Critical | Set `RUN_DB_MIGRATIONS=true` |
| Moov OAuth credentials | 🔴 Unknown | Critical | Get from sandbox, set env vars |
| Webhook URL configured | 🔴 Unknown | High | Configure in Moov dashboard |
| Scheduler running | 🟡 Auto | Medium | Verify in logs |

**BEFORE pushing to production**: Repeat this entire checklist for production credentials.

---

**Questions?** Check:
1. `/docs/moov_local_testing.md` - Local development guide
2. Backend logs: `tail -f /app/backend.log | grep -E "Moov|scheduler|migration"`
3. Moov docs: https://docs.moov.io/

**Last Updated**: 2026-01-13
