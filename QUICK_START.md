# Quick Start: Local Moov Testing (5 minutes)

## Step 1: Get Moov Sandbox Credentials (2 min)

1. Go to https://moov-sandbox.com
2. Sign in (or create account)
3. Click **Settings** → **API Keys**
4. Copy your **Client ID** and **Client Secret**

## Step 2: Configure Environment (1 min)

Edit `.env` in repo root:

```bash
# Open the file
nano .env
```

Replace these lines with YOUR credentials:
```
MOOV_CLIENT_ID=your_sandbox_client_id_here
MOOV_CLIENT_SECRET=your_sandbox_client_secret_here
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X` in nano).

## Step 3: Setup ngrok (if first time)

ngrok requires authentication. Do this **once**:

1. Go to https://dashboard.ngrok.com/signup (free account)
2. Sign in to https://dashboard.ngrok.com/get-started/your-authtoken
3. Copy the `ngrok config add-authtoken` command shown there
4. Run it in terminal:
   ```bash
   ngrok config add-authtoken YOUR_TOKEN_HERE
   ```

## Step 3b: Start Tunnel (1 min)

Open a **new terminal** and run:

```bash
cd /Users/sandeep/Desktop/Gratly
./scripts/dev/moov_tunnel.sh --port 8000
```

**Copy the output**, it will look like:
```
✓ PUBLIC_BASE_URL=https://abc123.ngrok.io
```

Update `.env` with this URL:
```
PUBLIC_BASE_URL=https://abc123.ngrok.io
```

**Keep this terminal open!**

## Step 4: Start Backend (1 min)

Open **another terminal**:

```bash
cd /Users/sandeep/Desktop/Gratly/Backend
source venv/bin/activate
python main.py
```

You should see:
```
INFO:     Application startup complete
```

## Step 5: Run Sanity Check (0 min)

Open **another terminal**:

```bash
cd /Users/sandeep/Desktop/Gratly
/Users/sandeep/Desktop/Gratly/Backend/venv/bin/python3 scripts/dev/check_moov_local.py
```

You should see:
```
✓ All checks passed! Ready to test Moov locally.
```

---

## If sanity check FAILS

### Error: "MOOV_CLIENT_ID not set"
```bash
# Make sure .env exists
cat .env | grep MOOV_CLIENT_ID

# If empty, update it with your credentials
nano .env
```

### Error: "Cannot connect to backend"
```bash
# Make sure backend is running
# Terminal should show "Application startup complete"
```

### Error: "PUBLIC_BASE_URL is localhost"
```bash
# Don't use localhost for Moov, use tunnel URL
# Run: ./scripts/dev/moov_tunnel.sh --port 8000
# Copy the ngrok URL to .env
```

---

## Workflow: After Setup

Once sanity check passes, you're ready to test:

```bash
# Terminal 1: Keep tunnel running
./scripts/dev/moov_tunnel.sh --port 8000

# Terminal 2: Keep backend running
cd Backend && source venv/bin/activate && python main.py

# Terminal 3: Start frontend
cd Frontend && npm start

# Terminal 4: Run tests/curl commands
cd /Users/sandeep/Desktop/Gratly
# Test endpoints below
```

---

## Test Endpoints

Test Moov is configured:
```bash
curl http://localhost:8000/api/moov/debug/config | jq
curl http://localhost:8000/api/moov/debug/token | jq
```

Create a test onboarding link:
```bash
curl -X POST http://localhost:8000/api/restaurants/1/moov/onboarding-link \
  -H "Content-Type: application/json" \
  -d '{
    "returnUrl": "http://localhost:3000/gratly-profile",
    "refreshUrl": "http://localhost:3000/gratly-profile"
  }' | jq .redirectUrl
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `ModuleNotFoundError: requests` | Wrong Python | Use venv Python: `/Users/sandeep/Desktop/Gratly/Backend/venv/bin/python3` |
| `MOOV_CLIENT_ID not set` | Missing .env | Create .env file with credentials |
| `Cannot connect to backend` | Backend not running | Run `python Backend/main.py` |
| `PUBLIC_BASE_URL is localhost` | Using localhost instead of tunnel | Run `./scripts/dev/moov_tunnel.sh --port 8000` |
| `SSL: CERTIFICATE_VERIFY_FAILED` | SSL issue (can ignore locally) | This is a warning, not an error |

---

## Next: Deploy to dev.gratly.ai

Once everything works locally, see:
- `docs/DEPLOYMENT_CHECKLIST.md` - Pre-deployment validation
- `docs/moov_local_testing.md` - Detailed local setup guide

---

**Ready?** Run these 5 steps and you'll be testing Moov in ~5 minutes! 🚀
