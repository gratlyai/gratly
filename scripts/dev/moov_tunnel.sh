#!/bin/bash

# Moov Local Testing Tunnel Setup Script
#
# This script helps expose your local backend to the internet so Moov can send
# webhooks and return callbacks to your localhost development environment.
#
# Supports multiple tunnel providers (ngrok, cloudflare, etc.)
# Usage: ./scripts/dev/moov_tunnel.sh --port 8000 [--provider ngrok]

set -e

PORT=8000
PROVIDER=""
PROVIDER_DETECTED=""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}=== Moov Local Testing Tunnel Setup ===${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --port)
            PORT="$2"
            shift 2
            ;;
        --provider)
            PROVIDER="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

print_header
echo ""

# Detect available tunnel provider if not specified
if [ -z "$PROVIDER" ]; then
    if command -v ngrok &> /dev/null; then
        PROVIDER="ngrok"
        PROVIDER_DETECTED="yes"
    elif command -v cloudflared &> /dev/null; then
        PROVIDER="cloudflare"
        PROVIDER_DETECTED="yes"
    fi
fi

# If no provider found, show instructions
if [ -z "$PROVIDER" ]; then
    print_error "No tunnel provider found. Please install one:"
    echo ""
    echo "Option 1: ngrok (recommended)"
    echo "  brew install ngrok"
    echo "  https://ngrok.com/"
    echo ""
    echo "Option 2: Cloudflare Tunnel"
    echo "  brew install cloudflare/cloudflare/cloudflared"
    echo "  https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/"
    echo ""
    echo "Option 3: Manual (or other provider):"
    echo "  Export PUBLIC_BASE_URL manually in your .env file"
    echo "  Example: PUBLIC_BASE_URL=https://your-tunnel-url.ngrok.io"
    exit 1
fi

print_info "Using provider: $PROVIDER"
if [ "$PROVIDER_DETECTED" = "yes" ]; then
    print_success "Provider auto-detected"
fi

echo ""
print_info "Starting tunnel on port $PORT..."
echo ""

# Start tunnel based on provider
case $PROVIDER in
    ngrok)
        if ! command -v ngrok &> /dev/null; then
            print_error "ngrok not found. Install: brew install ngrok"
            exit 1
        fi

        # Start ngrok
        echo "Starting ngrok..."
        ngrok http $PORT --log=stdout | while IFS= read -r line; do
            # Extract the public URL from ngrok output
            if [[ $line == *"URL"* ]] && [[ $line == *"https://"* ]]; then
                PUBLIC_URL=$(echo "$line" | grep -oP 'https://[^:]+\.ngrok\.io' | head -1)
                if [ ! -z "$PUBLIC_URL" ]; then
                    echo ""
                    print_success "Tunnel is live!"
                    echo ""
                    echo "═══════════════════════════════════════════════════════════════"
                    print_success "PUBLIC_BASE_URL=$PUBLIC_URL"
                    echo "═══════════════════════════════════════════════════════════════"
                    echo ""
                    print_info "Add to your .env file:"
                    echo ""
                    echo "  PUBLIC_BASE_URL=$PUBLIC_URL"
                    echo ""
                    print_info "Webhook URL:"
                    echo "  $PUBLIC_URL/api/webhooks/moov"
                    echo ""
                    print_info "Return/Callback URL:"
                    echo "  $PUBLIC_URL/moov/return"
                    echo ""
                    print_warning "Keep this terminal open while testing"
                    echo ""
                    print_info "Next steps:"
                    echo "  1. Copy PUBLIC_BASE_URL to your .env"
                    echo "  2. Restart your backend (python main.py)"
                    echo "  3. Configure Moov sandbox:"
                    echo "     https://moov-sandbox.com/settings/webhooks"
                    echo "     Webhook URL: $PUBLIC_URL/api/webhooks/moov"
                    echo "  4. Test with ./scripts/dev/check_moov_local.py"
                    echo ""
                fi
            fi
            echo "$line"
        done
        ;;

    cloudflare)
        if ! command -v cloudflared &> /dev/null; then
            print_error "cloudflared not found"
            exit 1
        fi

        print_warning "Cloudflare Tunnel setup requires additional configuration"
        echo "Run: cloudflared tunnel run --url http://localhost:$PORT"
        echo ""
        print_info "Then configure your tunnel domain in the Moov dashboard"
        ;;

    *)
        print_error "Provider not supported: $PROVIDER"
        exit 1
        ;;
esac
