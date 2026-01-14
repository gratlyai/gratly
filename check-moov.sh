#!/bin/bash
# Quick wrapper to run Moov sanity checker with correct Python environment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PYTHON="$SCRIPT_DIR/Backend/venv/bin/python3"
CHECK_SCRIPT="$SCRIPT_DIR/scripts/dev/check_moov_local.py"

if [ ! -f "$VENV_PYTHON" ]; then
    echo "Error: Virtual environment not found at $SCRIPT_DIR/Backend/venv"
    echo ""
    echo "Please run first:"
    echo "  cd Backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

if [ ! -f "$CHECK_SCRIPT" ]; then
    echo "Error: Check script not found at $CHECK_SCRIPT"
    exit 1
fi

echo "Running Moov sanity checker..."
echo ""

"$VENV_PYTHON" "$CHECK_SCRIPT" "$@"
