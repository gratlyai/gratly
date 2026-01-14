"""
Local development mode endpoints for Moov testing.

Provides:
- Return/callback handler for hosted onboarding completion
- Polling endpoints for checking status (when using dev_domain callback mode)
- Debug endpoints for local testing
"""

from datetime import datetime
from fastapi import APIRouter, Query, HTTPException
from typing import Dict, Any, Optional

try:
    from Backend.db import _get_cursor
    from Backend.moov_config import MoovConfig
    from Backend.moov_service import list_payment_methods, fetch_account
except ImportError:
    from db import _get_cursor
    from moov_config import MoovConfig
    from moov_service import list_payment_methods, fetch_account

import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/moov/return")
def handle_moov_return(
    state: Optional[str] = Query(None),
    accountId: Optional[str] = Query(None),
    moov_account_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    """
    Handle Moov hosted onboarding/payment method update completion.

    This endpoint receives the callback after the user completes onboarding in Moov's hosted flow.
    It records the completion and directs the frontend to refresh the account status.

    Query parameters:
    - state: State value passed to Moov (identifies account/user)
    - accountId or moov_account_id: The Moov account ID
    - status: Onboarding status from Moov

    Returns:
        HTML redirect to frontend with status query param
    """
    logger.info(f"Moov return callback received: state={state}, accountId={accountId}, status={status}")

    # Record the callback in audit log
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO GRATLYDB.MOOV_CALLBACKS (
                state,
                moov_account_id,
                status,
                received_at
            )
            VALUES (%s, %s, %s, NOW())
            """,
            (state, accountId or moov_account_id, status),
        )
    except Exception as e:
        logger.error(f"Failed to record Moov callback: {str(e)}")
    finally:
        cursor.close()

    # Redirect to frontend
    if state and "employee" in state.lower():
        redirect_url = "/gratly-profile?moov_callback=complete"
    elif state and "restaurant" in state.lower():
        redirect_url = "/gratly-profile?moov_callback=complete"
    else:
        redirect_url = "/?moov_callback=complete"

    return {
        "status": "callback_received",
        "redirect_url": redirect_url,
        "message": "Moov onboarding completed. The frontend will refresh automatically.",
    }


@router.get("/api/moov/accounts/{entity_type}/{entity_id}/status")
def get_moov_account_status(entity_type: str, entity_id: int):
    """
    Polling endpoint: Get current Moov account status.

    Used by frontend (when in dev_domain callback mode) to poll account status after onboarding.

    entity_type: "restaurant" or "employee"
    entity_id: Restaurant ID or User ID

    Returns:
        Account status, onboarding status, capabilities
    """
    try:
        account = fetch_account(f"mock-{entity_type}-{entity_id}")
        return {
            "connected": True,
            "moovAccountId": f"mock-{entity_type}-{entity_id}",
            "onboardingStatus": account.get("onboardingStatus") or "verified",
            "status": account.get("status") or "active",
        }
    except Exception as e:
        logger.warning(f"Failed to fetch Moov account status: {str(e)}")
        # Return mock data for local testing
        return {
            "connected": False,
            "moovAccountId": f"mock-{entity_type}-{entity_id}",
            "onboardingStatus": "pending",
            "status": "testing_mode",
        }


@router.get("/api/moov/payment-methods/{entity_type}/{entity_id}")
def get_moov_payment_methods_polling(entity_type: str, entity_id: int):
    """
    Polling endpoint: Get current payment methods.

    Used by frontend to poll for updated payment methods after onboarding.

    Returns:
        List of payment methods
    """
    try:
        methods = list_payment_methods(entity_type, entity_id)
        return {
            "methods": methods,
            "updated_at": datetime.now().isoformat(),
        }
    except Exception as e:
        logger.warning(f"Failed to fetch payment methods: {str(e)}")
        return {
            "methods": [],
            "updated_at": datetime.now().isoformat(),
            "error": str(e),
        }


@router.get("/api/moov/transfers/{transfer_id}/status")
def get_moov_transfer_status(transfer_id: str):
    """
    Polling endpoint: Get transfer/payment status.

    Used by frontend to poll for transfer completion status.

    Returns:
        Transfer status and details
    """
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                id,
                moov_transfer_id,
                status,
                failure_reason,
                updated_at
            FROM GRATLYDB.TRANSFERS
            WHERE moov_transfer_id = %s
            LIMIT 1
            """,
            (transfer_id,),
        )
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Transfer not found")

        return {
            "transfer_id": row.get("moov_transfer_id"),
            "status": row.get("status"),
            "failure_reason": row.get("failure_reason"),
            "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
        }
    except Exception as e:
        logger.error(f"Failed to get transfer status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()


@router.get("/api/moov/debug/config")
def get_moov_debug_config():
    """
    Debug endpoint: Return current Moov configuration (safe, non-secret fields).

    Only available in local mode. Useful for verifying tunnel setup, callback URLs, etc.
    """
    if not MoovConfig.is_local_mode():
        raise HTTPException(status_code=403, detail="Debug endpoint only available in local mode")

    return {
        "local_mode": MoovConfig.is_local_mode(),
        "callback_mode": MoovConfig.CALLBACK_MODE,
        "base_url": MoovConfig.BASE_URL,
        "public_base_url": MoovConfig.PUBLIC_BASE_URL,
        "dev_domain_base_url": MoovConfig.DEV_DOMAIN_BASE_URL,
        "webhook_url": MoovConfig.get_webhook_url(),
        "return_url": MoovConfig.get_callback_url(),
        "webhook_verification_disabled": MoovConfig.should_disable_webhook_verify(),
        "env": MoovConfig.ENV,
    }


@router.get("/api/moov/debug/token")
def get_moov_debug_token():
    """
    Debug endpoint: Test OAuth token fetch.

    Only available in local mode. Helps diagnose authentication issues.
    """
    if not MoovConfig.is_local_mode():
        raise HTTPException(status_code=403, detail="Debug endpoint only available in local mode")

    try:
        token = MoovConfig.get_oauth_token()
        return {
            "success": True,
            "token_prefix": token[:20] + "...",
            "message": "Token fetch successful",
        }
    except Exception as e:
        logger.error(f"Token fetch failed: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "message": "Token fetch failed - check client_id/secret and Moov API connectivity",
        }
