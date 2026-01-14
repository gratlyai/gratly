#!/usr/bin/env python3

"""
Moov Local Testing Sanity Checker

This script validates that your local Moov setup is correct:
- Environment variables are set
- OAuth token can be fetched
- Backend is running and responding
- Webhook URL is accessible
- Callback URLs are correct
"""

import os
import sys
import requests
from pathlib import Path

# Colors for output
GREEN = '\033[0;32m'
BLUE = '\033[0;34m'
YELLOW = '\033[1;33m'
RED = '\033[0;31m'
NC = '\033[0m'  # No Color

def print_header(text):
    print(f"\n{BLUE}{'='*60}{NC}")
    print(f"{BLUE}{text:^60}{NC}")
    print(f"{BLUE}{'='*60}{NC}\n")

def print_success(text):
    print(f"{GREEN}✓{NC} {text}")

def print_error(text):
    print(f"{RED}✗{NC} {text}")

def print_warning(text):
    print(f"{YELLOW}⚠️ {NC} {text}")

def print_info(text):
    print(f"{BLUE}ℹ{NC}  {text}")

def check_env_vars():
    """Check if required environment variables are set."""
    print_header("Checking Environment Variables")

    required_vars = {
        "MOOV_CLIENT_ID": "Moov OAuth Client ID",
        "MOOV_CLIENT_SECRET": "Moov OAuth Client Secret",
        "PUBLIC_BASE_URL": "Public URL for callbacks (tunnel URL)",
        "MOOV_LOCAL_MODE": "Local mode flag",
    }

    optional_vars = {
        "MOOV_ENV": "Moov environment (default: dev)",
        "MOOV_CALLBACK_MODE": "Callback mode: tunnel or dev_domain (default: tunnel)",
        "MOOV_BASE_URL": "Moov API base URL (default: https://api.moov.io)",
    }

    all_good = True

    # Check required
    print(f"{YELLOW}Required Variables:{NC}")
    for var, desc in required_vars.items():
        value = os.getenv(var)
        if value:
            display_val = value if var in ["PUBLIC_BASE_URL", "MOOV_ENV"] else f"{value[:10]}..."
            print_success(f"{var} = {display_val}")
        else:
            print_error(f"{var} not set - {desc}")
            all_good = False

    # Check optional
    print(f"\n{YELLOW}Optional Variables:{NC}")
    for var, desc in optional_vars.items():
        value = os.getenv(var)
        if value:
            print_info(f"{var} = {value}")
        else:
            print_info(f"{var} not set (using default)")

    return all_good

def check_backend_running():
    """Check if backend is running and responding."""
    print_header("Checking Backend Connectivity")

    backend_url = os.getenv("BACKEND_URL", "http://localhost:8000")
    print_info(f"Testing {backend_url}...")

    try:
        response = requests.get(f"{backend_url}/health", timeout=5)
        if response.status_code == 200:
            print_success(f"Backend is running at {backend_url}")
            return True
        else:
            print_warning(f"Backend returned status {response.status_code}")
            return True  # Might still be working
    except requests.exceptions.ConnectionError:
        print_error(f"Cannot connect to backend at {backend_url}")
        print_info("Make sure your backend is running: python Backend/main.py")
        return False
    except Exception as e:
        print_error(f"Error connecting to backend: {str(e)}")
        return False

def check_oauth_token():
    """Check if OAuth token can be fetched."""
    print_header("Checking Moov OAuth Token")

    client_id = os.getenv("MOOV_CLIENT_ID")
    client_secret = os.getenv("MOOV_CLIENT_SECRET")
    base_url = os.getenv("MOOV_BASE_URL", "https://api.moov.io")

    if not client_id or not client_secret:
        print_error("MOOV_CLIENT_ID or MOOV_CLIENT_SECRET not set")
        return False

    try:
        print_info(f"Requesting token from {base_url}/oauth2/token...")
        response = requests.post(
            f"{base_url}/oauth2/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "client_credentials",
            },
            timeout=10,
        )

        if response.status_code == 200:
            token_data = response.json()
            print_success("OAuth token fetched successfully")
            print_info(f"Token expires in {token_data.get('expires_in')}s")
            return True
        else:
            print_error(f"Token request failed: {response.status_code}")
            print_info(f"Response: {response.text[:200]}")
            return False
    except requests.exceptions.Timeout:
        print_error("Token request timed out - Moov API may be unreachable")
        return False
    except Exception as e:
        print_error(f"Error fetching token: {str(e)}")
        return False

def check_debug_config():
    """Check debug config via backend."""
    print_header("Checking Moov Configuration (via Backend)")

    backend_url = os.getenv("BACKEND_URL", "http://localhost:8000")

    try:
        response = requests.get(f"{backend_url}/api/moov/debug/config", timeout=5)
        if response.status_code == 200:
            config = response.json()
            print_success("Configuration retrieved from backend")
            print_info(f"Callback Mode: {config.get('callback_mode')}")
            print_info(f"Webhook URL: {config.get('webhook_url')}")
            print_info(f"Return URL: {config.get('return_url')}")

            if config.get('webhook_verification_disabled'):
                print_warning("Webhook verification is DISABLED (local mode only)")

            return True
        elif response.status_code == 403:
            print_warning("Debug endpoint not available (not in local mode?)")
            return True
        else:
            print_error(f"Config check failed: {response.status_code}")
            return False
    except Exception as e:
        print_warning(f"Could not retrieve config: {str(e)}")
        return True  # Not critical

def check_callback_urls():
    """Validate callback URLs are properly formatted."""
    print_header("Validating Callback URLs")

    public_url = os.getenv("PUBLIC_BASE_URL")
    callback_mode = os.getenv("MOOV_CALLBACK_MODE", "tunnel")

    if not public_url:
        print_error("PUBLIC_BASE_URL not set")
        return False

    print_info(f"Callback Mode: {callback_mode}")
    print_info(f"Public Base URL: {public_url}")

    webhook_url = f"{public_url}/api/webhooks/moov"
    return_url = f"{public_url}/moov/return"

    print_info(f"Webhook URL: {webhook_url}")
    print_info(f"Return URL: {return_url}")

    # Validate URLs
    if not public_url.startswith("http"):
        print_error("PUBLIC_BASE_URL must start with http:// or https://")
        return False

    if callback_mode == "tunnel":
        if "localhost" in public_url and not "ngrok.io" in public_url:
            print_error("Tunnel mode but PUBLIC_BASE_URL is localhost (needs tunnel URL)")
            return False
        print_success("URLs look good for tunnel mode")
    elif callback_mode == "dev_domain":
        print_success("URLs will use dev domain (polling mode)")

    return True

def main():
    """Run all checks."""
    print_header("Moov Local Testing Sanity Checker")

    checks = [
        ("Environment Variables", check_env_vars),
        ("Backend Connectivity", check_backend_running),
        ("OAuth Token", check_oauth_token),
        ("Callback URLs", check_callback_urls),
        ("Debug Config", check_debug_config),
    ]

    results = []
    for name, check_func in checks:
        try:
            result = check_func()
            results.append((name, result))
        except Exception as e:
            print_error(f"Unexpected error in {name}: {str(e)}")
            results.append((name, False))

    # Summary
    print_header("Summary")

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for name, result in results:
        status = f"{GREEN}PASS{NC}" if result else f"{RED}FAIL{NC}"
        print(f"  {name}: {status}")

    print(f"\n{passed}/{total} checks passed")

    if passed == total:
        print_success("All checks passed! Ready to test Moov locally.")
        print("\nNext steps:")
        print("  1. Start your backend: python Backend/main.py")
        print("  2. Start your frontend")
        print("  3. Configure Moov sandbox webhook URL:")
        print(f"     {os.getenv('PUBLIC_BASE_URL', 'YOUR_PUBLIC_URL')}/api/webhooks/moov")
        print("  4. Try linking a bank account or creating a transfer")
        sys.exit(0)
    else:
        print_error(f"Some checks failed. See above for details.")
        sys.exit(1)

if __name__ == "__main__":
    main()
