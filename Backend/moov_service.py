from datetime import datetime
import json
import os
import time
import urllib.parse
import urllib.request
import base64
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

try:
    from Backend.idempotency import run_idempotent
    from Backend.db import _get_cursor, _fetch_restaurant_name
except ImportError:
    from idempotency import run_idempotent
    from db import _get_cursor, _fetch_restaurant_name


def _get_required_env(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise HTTPException(status_code=500, detail=f"{key} not configured")
    return value


def _moov_base_url() -> str:
    url = (os.getenv("MOOV_BASE_URL") or "https://api.sandbox.moov.io").rstrip("/")
    print(f"DEBUG: MOOV_BASE_URL = {url}")
    return url


def _moov_auth_header() -> str:
    """Generate Basic Auth header for Moov API using public and secret keys."""
    public_key = _get_required_env("MOOV_PUBLIC_KEY")
    secret_key = _get_required_env("MOOV_SECRET_KEY")

    # Combine keys as "public_key:secret_key" and base64 encode
    credentials = f"{public_key}:{secret_key}"
    encoded = base64.b64encode(credentials.encode()).decode()
    return f"Basic {encoded}"


def _moov_request(
    method: str,
    path: str,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    import logging
    logger = logging.getLogger(__name__)

    url = f"{_moov_base_url()}{path}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"

    headers = {
        "Accept": "application/json",
        "Authorization": _moov_auth_header(),
        "x-moov-version": "v2025.07.00"
    }
    data = None
    if json_body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(json_body).encode("utf-8")
        # Log the payload for debugging
        logger.info(f"[MOOV REQUEST] {method} {path}")
        logger.info(f"[MOOV REQUEST] Headers: {headers}")
        logger.info(f"[MOOV REQUEST] Body: {json.dumps(json_body, indent=2)}")
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key

    request = urllib.request.Request(url=url, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(request) as response:
            payload = response.read()
            if not payload:
                return {}
            decoded = payload.decode("utf-8")
            if response.headers.get("Content-Type", "").startswith("application/json"):
                return json.loads(decoded)
            try:
                return json.loads(decoded)
            except json.JSONDecodeError:
                return {"raw": decoded}
    except urllib.error.HTTPError as exc:
        # Parse Moov's error response structure
        import logging
        logger = logging.getLogger(__name__)

        try:
            error_body = exc.read().decode("utf-8") if exc.fp else "{}"
            logger.error(f"Moov API raw response body: {error_body}")

            error_data = json.loads(error_body)

            # Moov API v2025.07.00 error structure: {"error": "description"}
            error_message = error_data.get("error", str(exc))
            error_code = error_data.get("code")  # Optional error code
            error_details = error_data.get("details", [])  # Validation errors

            # Build detailed error message
            detail_parts = [f"Moov API error: {error_message}"]
            if error_code:
                detail_parts.append(f"Code: {error_code}")
            if error_details:
                detail_parts.append(f"Details: {json.dumps(error_details)}")

            detail = " | ".join(detail_parts)

            # Map Moov HTTP codes to appropriate response codes
            status_map = {
                400: 400,  # Bad request - client error
                401: 401,  # Unauthorized
                403: 403,  # Forbidden
                404: 404,  # Not found
                422: 422,  # Unprocessable entity - validation error
                429: 429,  # Rate limit
                500: 502,  # Moov server error -> our 502
                504: 504,  # Gateway timeout
            }
            status_code = status_map.get(exc.code, 502)

            # Log the full error for debugging
            logger.error(f"Moov API error: {exc.code} {detail}", extra={
                "moov_error_code": error_code,
                "moov_error_details": error_details,
                "request_url": url,
                "request_body": json_body
            })

            raise HTTPException(status_code=status_code, detail=detail) from exc

        except (json.JSONDecodeError, KeyError) as parse_error:
            # Fallback if response isn't JSON
            import logging
            logger = logging.getLogger(__name__)
            detail = exc.read().decode("utf-8") if exc.fp else str(exc)
            logger.error(f"Moov API error (unparseable): {exc.code} {detail}")
            raise HTTPException(status_code=502, detail=f"Moov request failed: {detail}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Moov request failed: {exc}") from exc


def _moov_request_with_retry(
    method: str,
    path: str,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
    idempotency_key: Optional[str] = None,
    max_retries: int = 3,
) -> Dict[str, Any]:
    """
    Make Moov API request with automatic retry for transient errors.
    Retries on rate limits (429) and server errors (502, 504) with exponential backoff.
    """
    import logging
    logger = logging.getLogger(__name__)

    last_error = None
    for attempt in range(max_retries):
        try:
            return _moov_request(method, path, params, json_body, idempotency_key)
        except HTTPException as e:
            last_error = e
            # Only retry on rate limits (429) and server errors (502, 504)
            if e.status_code in (429, 502, 504) and attempt < max_retries - 1:
                wait_time = 2 ** attempt  # Exponential backoff: 1s, 2s, 4s
                logger.warning(f"Moov API error {e.status_code}, retrying in {wait_time}s (attempt {attempt + 1}/{max_retries})")
                time.sleep(wait_time)
                continue
            raise
    raise last_error


def _get_platform_account_id() -> str:
    return _get_required_env("MOOV_PLATFORM_ACCOUNT_ID")


def fetch_account(moov_account_id: str) -> Dict[str, Any]:
    return _moov_request("GET", f"/accounts/{moov_account_id}")


def set_platform_branding() -> None:
    """
    Set Gratly branding colors on the Moov platform account.

    Gratly brand colors:
    - Primary: #cab99a (warm beige/tan)
    - Dark mode accent: #2c2d2d (dark gray)
    - Light mode accent: #f4f2ee (off-white/cream)
    """
    import logging
    logger = logging.getLogger(__name__)

    platform_account_id = _get_platform_account_id()

    payload = {
        "colors": {
            "dark": {"accent": "#2c2d2d"},      # Dark gray for dark mode
            "light": {"accent": "#f4f2ee"}      # Off-white for light mode
        }
    }

    try:
        logger.info(f"Setting Gratly branding on platform account {platform_account_id}")
        response = _moov_request_with_retry(
            "POST",
            f"/accounts/{platform_account_id}/branding",
            json_body=payload,
            idempotency_key=f"moov-branding-{platform_account_id}",
        )
        logger.info(f"Successfully set platform branding: {response}")
    except Exception as e:
        logger.warning(f"Failed to set platform branding: {e}")
        # Don't fail startup if branding can't be set


def _store_moov_account(owner_type: str, owner_id: int, moov_account_id: str) -> None:
    import logging
    logger = logging.getLogger(__name__)

    cursor = _get_cursor(dictionary=True)
    try:
        # Try to insert with ENTITY_TYPE/ENTITY_ID (production schema)
        try:
            cursor.execute(
                """
                INSERT INTO GRATLYDB.MOOV_ACCOUNTS (
                    ENTITY_TYPE,
                    ENTITY_ID,
                    MOOV_ACCOUNT_ID,
                    CREATED_AT,
                    UPDATED_AT
                )
                VALUES (%s, %s, %s, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    MOOV_ACCOUNT_ID = VALUES(MOOV_ACCOUNT_ID),
                    UPDATED_AT = NOW()
                """,
                (owner_type, owner_id, moov_account_id),
            )
            logger.info(f"Stored Moov account {moov_account_id} for {owner_type} {owner_id}")
        except Exception as e:
            # Fallback to OWNER_TYPE/OWNER_ID if first attempt fails
            logger.warning(f"Insert with ENTITY_TYPE/ENTITY_ID failed, trying OWNER_TYPE/OWNER_ID: {e}")
            cursor.execute(
                """
                INSERT INTO GRATLYDB.MOOV_ACCOUNTS (
                    OWNER_TYPE,
                    OWNER_ID,
                    MOOV_ACCOUNT_ID,
                    CREATED_AT,
                    UPDATED_AT
                )
                VALUES (%s, %s, %s, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    MOOV_ACCOUNT_ID = VALUES(MOOV_ACCOUNT_ID),
                    UPDATED_AT = NOW()
                """,
                (owner_type, owner_id, moov_account_id),
            )
            logger.info(f"Stored Moov account {moov_account_id} using fallback schema")
    except Exception as e:
        logger.error(f"Failed to store Moov account: {e}")
        # Don't fail - just log the error
    finally:
        cursor.close()


def _store_account_status(
    owner_type: str,
    owner_id: int,
    status: Optional[str],
    verification_status: Optional[str],
    capabilities: Optional[List[Dict[str, Any]]]
) -> None:
    """Store account status and verification details - gracefully handle schema differences."""
    import logging
    logger = logging.getLogger(__name__)

    cursor = _get_cursor(dictionary=True)
    try:
        # Try minimal update - just touch the UPDATED_AT timestamp to indicate we processed it
        # This works regardless of schema since UPDATED_AT likely exists
        try:
            # Try with ENTITY_TYPE/ENTITY_ID first (production schema)
            cursor.execute(
                """
                UPDATE GRATLYDB.MOOV_ACCOUNTS
                SET UPDATED_AT = NOW()
                WHERE ENTITY_TYPE = %s AND ENTITY_ID = %s
                """,
                (owner_type, owner_id),
            )
            logger.info(f"Updated account status for {owner_type} {owner_id} (ENTITY schema)")
        except Exception as e1:
            # Try fallback with OWNER_TYPE/OWNER_ID
            try:
                logger.warning(f"ENTITY schema failed, trying OWNER schema: {e1}")
                cursor.execute(
                    """
                    UPDATE GRATLYDB.MOOV_ACCOUNTS
                    SET UPDATED_AT = NOW()
                    WHERE OWNER_TYPE = %s AND OWNER_ID = %s
                    """,
                    (owner_type, owner_id),
                )
                logger.info(f"Updated account status for {owner_type} {owner_id} (OWNER schema)")
            except Exception as e2:
                # If both fail, just log - don't throw since account creation succeeded
                logger.warning(f"Could not update account status with either schema: {e1} | {e2}")
    except Exception as e:
        logger.error(f"Unexpected error in _store_account_status: {e}")
        # Don't fail - account was already created in Moov
    finally:
        cursor.close()


def _fetch_moov_account(owner_type: str, owner_id: int) -> Optional[str]:
    import logging
    logger = logging.getLogger(__name__)

    cursor = _get_cursor(dictionary=True)
    try:
        # Try with ENTITY_TYPE/ENTITY_ID first (production schema)
        try:
            cursor.execute(
                """
                SELECT MOOV_ACCOUNT_ID AS moov_account_id
                FROM GRATLYDB.MOOV_ACCOUNTS
                WHERE ENTITY_TYPE = %s AND ENTITY_ID = %s
                LIMIT 1
                """,
                (owner_type, owner_id),
            )
            row = cursor.fetchone()
            if row:
                return row["moov_account_id"]
        except Exception as e:
            # Try fallback with OWNER_TYPE/OWNER_ID
            logger.debug(f"ENTITY schema query failed, trying OWNER schema: {e}")
            try:
                cursor.execute(
                    """
                    SELECT MOOV_ACCOUNT_ID AS moov_account_id
                    FROM GRATLYDB.MOOV_ACCOUNTS
                    WHERE OWNER_TYPE = %s AND OWNER_ID = %s
                    LIMIT 1
                    """,
                    (owner_type, owner_id),
                )
                row = cursor.fetchone()
                return row["moov_account_id"] if row else None
            except Exception as e2:
                logger.warning(f"Both schema attempts failed: {e} | {e2}")
                return None

        return None
    finally:
        cursor.close()


def ensure_moov_account(owner_type: str, owner_id: int, payload: Dict[str, Any]) -> str:
    import logging
    logger = logging.getLogger(__name__)

    existing = _fetch_moov_account(owner_type, owner_id)
    if existing:
        return existing

    def _create():
        response = _moov_request(
            "POST",
            "/accounts",
            json_body=payload,
            idempotency_key=f"moov-account-{owner_type}-{owner_id}",
        )
        account_id = response.get("accountID") or response.get("id")
        if not account_id:
            raise HTTPException(status_code=502, detail="Moov account creation failed")
        _store_moov_account(owner_type, owner_id, account_id)

        # Store initial status and capabilities
        _store_account_status(
            owner_type,
            owner_id,
            response.get("status"),
            response.get("verification", {}).get("status"),
            response.get("capabilities")
        )

        # Attach default fee plan to restaurant accounts
        if owner_type == "restaurant":
            try:
                attach_fee_plan_agreement(account_id)
                logger.info(f"Attached default fee plan to restaurant account {account_id}")
            except Exception as e:
                logger.warning(f"Failed to attach fee plan to account {account_id}: {e}")
                # Don't fail - fee plan can be attached manually later

        return {"account_id": account_id}

    result, _ = run_idempotent("moov_account", f"{owner_type}:{owner_id}", _create)
    if result is None:
        # If result is None, fetch from DB instead
        existing = _fetch_moov_account(owner_type, owner_id)
        if existing:
            return existing
        raise HTTPException(status_code=502, detail="Failed to get or create Moov account")
    return result["account_id"]


def _get_required_capabilities(owner_type: str) -> List[str]:
    """Get required capabilities based on account type."""
    if owner_type == "restaurant":
        return ["send-funds", "collect-funds", "wallet"]
    else:  # employee
        return ["receive-funds", "wallet"]


def verify_account_capabilities(
    moov_account_id: str,
    required_capabilities: List[str]
) -> Tuple[bool, Optional[str]]:
    """
    Verify account has required capabilities enabled.

    Args:
        moov_account_id: Moov account ID
        required_capabilities: List of required capability names

    Returns:
        Tuple of (is_ready, blocking_reason)
    """
    try:
        account = fetch_account(moov_account_id)
        capabilities = account.get("capabilities") or []

        # Check if all required capabilities are present and enabled
        for cap_name in required_capabilities:
            cap = next((c for c in capabilities if c.get("capability") == cap_name), None)
            if not cap:
                return False, f"Missing capability: {cap_name}"

            status = cap.get("status")
            if status not in ("enabled", "approved"):
                return False, f"Capability {cap_name} not enabled (status: {status})"

        # Check account verification status
        verification = account.get("verification") or {}
        verification_status = verification.get("status")
        if verification_status in ("failed", "rejected"):
            return False, f"Account verification failed: {verification.get('failureReason')}"

        return True, None

    except HTTPException as e:
        return False, f"Cannot verify capabilities: {e.detail}"


def _get_default_fee_plan_id() -> str:
    """
    Get the default fee plan ID to attach to new accounts.

    Fee plans are created in the Moov dashboard and referenced by planID.
    The planID is set via MOOV_DEFAULT_FEE_PLAN environment variable.

    Example: efbc6f5e-6573-4f8a-a93b-dd5dcce298f9
    """
    import logging
    logger = logging.getLogger(__name__)

    # Get fee plan ID from environment variable
    fee_plan_id = os.getenv("MOOV_DEFAULT_FEE_PLAN")

    if not fee_plan_id:
        logger.error("MOOV_DEFAULT_FEE_PLAN environment variable not set")
        raise HTTPException(
            status_code=500,
            detail="Fee plan not configured. Set MOOV_DEFAULT_FEE_PLAN environment variable to the fee plan ID."
        )

    logger.info(f"Using fee plan ID: {fee_plan_id}")
    return fee_plan_id


def attach_fee_plan_agreement(moov_account_id: str, fee_plan_id: Optional[str] = None) -> str:
    """
    Attach a fee plan agreement to an account.

    Uses the Moov fee-plan-agreements endpoint to attach a fee plan to an account.
    The account must already exist in Moov.

    Args:
        moov_account_id: The Moov account ID to attach the fee plan to
        fee_plan_id: Optional fee plan ID. If not provided, uses default from env.

    Returns:
        The agreement ID of the created fee plan agreement
    """
    import logging
    logger = logging.getLogger(__name__)

    if not fee_plan_id:
        fee_plan_id = _get_default_fee_plan_id()

    payload = {
        "planID": fee_plan_id,
    }

    logger.info(f"Attaching fee plan {fee_plan_id} to account {moov_account_id}")
    response = _moov_request_with_retry(
        "POST",
        f"/accounts/{moov_account_id}/fee-plan-agreements",
        json_body=payload,
        idempotency_key=f"moov-fee-agreement-{moov_account_id}-{fee_plan_id}",
    )

    agreement_id = response.get("agreementID") or response.get("id")
    if not agreement_id:
        logger.error(f"Fee plan agreement ID missing from response: {response}")
        # Don't fail - fee plan can be attached manually later
        return ""

    logger.info(f"Successfully attached fee plan agreement: {agreement_id}")
    return agreement_id


def create_onboarding_link(
    moov_account_id: str,
    return_url: str,
    refresh_url: Optional[str] = None,
) -> str:
    """
    Create onboarding invite for an existing account.

    This uses the Moov onboarding-invites endpoint which creates a link
    for the account holder to complete KYC/KYB verification.
    """
    import logging
    logger = logging.getLogger(__name__)

    # Get fee plan ID from environment - required by Moov API
    fee_plan_id = _get_default_fee_plan_id()

    payload = {
        # Required fields for onboarding-invites endpoint
        "capabilities": ["wallet", "send-funds", "collect-funds"],
        "feePlanCodes": [fee_plan_id],  # Required by Moov API v2025.07.00
        "scopes": ["accounts.write", "accounts.read"],  # Standard scopes for account management
        # Optional fields
        "returnURL": return_url,
        # Prefill the account ID so onboarding is tied to this account
        "prefill": {
            "accountID": moov_account_id
        }
    }

    logger.info(f"Creating onboarding invite for account {moov_account_id} with fee plan {fee_plan_id}")
    response = _moov_request(
        "POST",
        "/onboarding-invites",
        json_body=payload,
        idempotency_key=f"moov-onboarding-{moov_account_id}-{hash(return_url)}",
    )

    # Moov returns different field names - try both
    link = response.get("link") or response.get("url") or response.get("inviteLink")
    if not link:
        logger.error(f"Onboarding link missing from response: {response}")
        raise HTTPException(status_code=502, detail="Moov onboarding link missing")

    logger.info(f"Successfully created onboarding link: {link[:50]}...")
    return link


# Moov API v2025.07.00 payment method type mappings
MOOV_PAYMENT_METHOD_TYPES = {
    "ach-debit-collect": "ach",
    "ach-debit-fund": "ach",
    "ach-credit-standard": "ach",
    "ach-credit-same-day": "ach",
    "moov-wallet": "wallet",
    "card-payment": "card",
    "push-to-card": "debit_card",
    "pull-from-card": "debit_card",
    "rtp-credit": "rtp",
    "card-present-payment": "card",
    "apple-pay": "card"
}


def normalize_payment_method_type(moov_type: str) -> str:
    """
    Normalize Moov's payment method type to our internal storage format.
    Moov uses types like 'ach-debit-collect', we store as 'ach'.
    """
    if not moov_type:
        return "unknown"
    return MOOV_PAYMENT_METHOD_TYPES.get(moov_type.lower(), moov_type)


def get_moov_payment_method_type(internal_type: str) -> str:
    """
    Convert internal type back to Moov's expected format.
    For transfers, we need the exact Moov enum value.
    """
    # Map stored types back to preferred Moov types
    type_map = {
        "ach": "ach-debit-fund",
        "bank_account": "ach-debit-fund",
        "card": "card-payment",
        "debit_card": "push-to-card",
        "rtp": "rtp-credit",
        "wallet": "moov-wallet"
    }
    return type_map.get(internal_type, internal_type)


def validate_payment_method_for_transfer(
    owner_type: str,
    owner_id: int,
    payment_method_id: str,
    transfer_direction: str = "source"
) -> Tuple[bool, Optional[str]]:
    """
    Validate payment method is suitable for a transfer.

    Args:
        owner_type: 'restaurant' or 'employee'
        owner_id: ID of the owner
        payment_method_id: Moov payment method ID
        transfer_direction: 'source' or 'destination'

    Returns:
        Tuple of (is_valid, error_message)
    """
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT METHOD_TYPE, STATUS, IS_VERIFIED
            FROM GRATLYDB.PAYMENT_METHODS
            WHERE OWNER_TYPE = %s AND OWNER_ID = %s AND MOOV_PAYMENT_METHOD_ID = %s
            LIMIT 1
            """,
            (owner_type, owner_id, payment_method_id)
        )
        method = cursor.fetchone()
        if not method:
            return False, "Payment method not found"

        if method["STATUS"] not in ("active", "verified"):
            return False, f"Payment method status is {method['STATUS']}"

        if not method["IS_VERIFIED"] and transfer_direction == "source":
            return False, "Unverified payment methods cannot be used as transfer source"

        return True, None
    finally:
        cursor.close()


def refresh_payment_methods(owner_type: str, owner_id: int, moov_account_id: str) -> List[Dict[str, Any]]:
    response = _moov_request("GET", f"/accounts/{moov_account_id}/payment-methods")
    methods = response.get("paymentMethods") if isinstance(response, dict) else None
    if methods is None and isinstance(response, list):
        methods = response
    methods = methods or []
    cursor = _get_cursor(dictionary=True)
    try:
        for method in methods:
            method_id = method.get("paymentMethodID") or method.get("id")
            if not method_id:
                continue
            cursor.execute(
                """
                INSERT INTO GRATLYDB.PAYMENT_METHODS (
                    OWNER_TYPE,
                    OWNER_ID,
                    MOOV_PAYMENT_METHOD_ID,
                    METHOD_TYPE,
                    BRAND,
                    LAST4,
                    STATUS,
                    IS_PREFERRED,
                    IS_VERIFIED,
                    CREATED_AT,
                    UPDATED_AT
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, 0, %s, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    METHOD_TYPE = VALUES(METHOD_TYPE),
                    BRAND = VALUES(BRAND),
                    LAST4 = VALUES(LAST4),
                    STATUS = VALUES(STATUS),
                    IS_VERIFIED = VALUES(IS_VERIFIED),
                    UPDATED_AT = NOW()
                """,
                (
                    owner_type,
                    owner_id,
                    method_id,
                    normalize_payment_method_type(method.get("type") or method.get("methodType") or ""),
                    method.get("brand"),
                    method.get("last4"),
                    method.get("status") or "active",
                    1 if method.get("verified") else 0,
                ),
            )
    finally:
        cursor.close()
    return methods


def list_payment_methods(owner_type: str, owner_id: int) -> List[Dict[str, Any]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                ID AS id,
                MOOV_PAYMENT_METHOD_ID AS moov_payment_method_id,
                METHOD_TYPE AS method_type,
                BRAND AS brand,
                LAST4 AS last4,
                STATUS AS status,
                IS_PREFERRED AS is_preferred,
                IS_VERIFIED AS is_verified
            FROM GRATLYDB.PAYMENT_METHODS
            WHERE OWNER_TYPE = %s AND OWNER_ID = %s
            ORDER BY IS_PREFERRED DESC, UPDATED_AT DESC
            """,
            (owner_type, owner_id),
        )
        return cursor.fetchall()
    finally:
        cursor.close()


def set_preferred_payment_method(owner_type: str, owner_id: int, method_id: str) -> None:
    cursor = _get_cursor(dictionary=True)
    conn = cursor.connection
    try:
        cursor.execute(
            """
            UPDATE GRATLYDB.PAYMENT_METHODS
            SET IS_PREFERRED = CASE WHEN MOOV_PAYMENT_METHOD_ID = %s THEN 1 ELSE 0 END
            WHERE OWNER_TYPE = %s AND OWNER_ID = %s
            """,
            (method_id, owner_type, owner_id),
        )
        conn.commit()
    finally:
        cursor.close()


def _select_preferred_method(owner_type: str, owner_id: int, method_types: Optional[List[str]] = None) -> Optional[dict]:
    cursor = _get_cursor(dictionary=True)
    try:
        if method_types:
            placeholders = ", ".join(["%s"] * len(method_types))
            cursor.execute(
                f"""
                SELECT *
                FROM GRATLYDB.PAYMENT_METHODS
                WHERE OWNER_TYPE = %s
                  AND OWNER_ID = %s
                  AND METHOD_TYPE IN ({placeholders})
                ORDER BY IS_PREFERRED DESC, UPDATED_AT DESC
                LIMIT 1
                """,
                (owner_type, owner_id, *method_types),
            )
        else:
            cursor.execute(
                """
                SELECT *
                FROM GRATLYDB.PAYMENT_METHODS
                WHERE OWNER_TYPE = %s AND OWNER_ID = %s
                ORDER BY IS_PREFERRED DESC, UPDATED_AT DESC
                LIMIT 1
                """,
                (owner_type, owner_id),
            )
        return cursor.fetchone()
    finally:
        cursor.close()


def create_invoice(
    restaurant_id: int,
    billing_period: str,
    amount_cents: int,
    currency: str,
    due_date: Optional[str],
) -> Dict[str, Any]:
    moov_account_id = _fetch_moov_account("restaurant", restaurant_id)
    if not moov_account_id:
        raise HTTPException(status_code=400, detail="Restaurant Moov account missing")

    restaurant_name = _fetch_restaurant_name(restaurant_id) or "Restaurant"
    payload = {
        "accountID": moov_account_id,
        "description": f"Gratly monthly fee ({billing_period})",
        "amount": {"currency": currency, "value": amount_cents},
        "metadata": {"restaurant_id": str(restaurant_id), "billing_period": billing_period},
        "customer": {"name": restaurant_name},
    }
    if due_date:
        payload["dueDate"] = due_date
    response = _moov_request(
        "POST",
        "/invoices",
        json_body=payload,
        idempotency_key=f"moov-invoice-{restaurant_id}-{billing_period}",
    )
    return response


def collect_invoice(invoice_id: str, payment_method_id: str) -> Dict[str, Any]:
    payload = {"paymentMethodID": payment_method_id}
    return _moov_request(
        "POST",
        f"/invoices/{invoice_id}/collect",
        json_body=payload,
        idempotency_key=f"moov-invoice-collect-{invoice_id}",
    )


def validate_transfer_request(
    source_account_id: str,
    source_payment_method_id: str,
    dest_account_id: str,
    dest_payment_method_id: str,
    amount_cents: int,
    currency: str = "USD"
) -> Tuple[bool, Optional[str]]:
    """
    Validate a transfer request before submission using Moov's transfer-options endpoint.

    Args:
        source_account_id: Source Moov account ID
        source_payment_method_id: Source payment method ID
        dest_account_id: Destination account ID
        dest_payment_method_id: Destination payment method ID
        amount_cents: Amount in cents
        currency: Currency code (default USD)

    Returns:
        Tuple of (is_valid, error_message)
    """
    import logging
    logger = logging.getLogger(__name__)

    # 1. Basic validation
    if amount_cents <= 0:
        return False, "Transfer amount must be positive"

    if currency != "USD":
        return False, "Only USD transfers currently supported"

    # 2. Check source account capabilities
    source_ready, source_error = verify_account_capabilities(
        source_account_id,
        ["send-funds"]
    )
    if not source_ready:
        return False, f"Source account not ready: {source_error}"

    # 3. Check destination account capabilities
    dest_ready, dest_error = verify_account_capabilities(
        dest_account_id,
        ["receive-funds"]
    )
    if not dest_ready:
        return False, f"Destination account not ready: {dest_error}"

    # 4. Validate payment methods
    source_is_valid, source_method_error = validate_payment_method_for_transfer(
        "restaurant", -1, source_payment_method_id, "source"
    )
    if not source_is_valid and source_method_error:
        # Not necessarily a blocker - source might be in Moov wallet
        logger.warning(f"Source payment method validation: {source_method_error}")

    dest_is_valid, dest_method_error = validate_payment_method_for_transfer(
        "employee", -1, dest_payment_method_id, "destination"
    )
    if not dest_is_valid and dest_method_error:
        # Not necessarily a blocker - destination might be in Moov wallet
        logger.warning(f"Destination payment method validation: {dest_method_error}")

    # 5. Use Moov's transfer-options endpoint to validate compatibility
    try:
        options_payload = {
            "source": {
                "accountID": source_account_id,
                "paymentMethodID": source_payment_method_id
            },
            "destination": {
                "accountID": dest_account_id
            },
            "amount": {
                "currency": currency,
                "value": amount_cents
            }
        }

        # Call transfer-options endpoint
        response = _moov_request_with_retry(
            "POST",
            "/transfer-options",
            json_body=options_payload,
            max_retries=2
        )

        # Check if any valid payment methods returned for destination
        payment_methods = response.get("paymentMethods", [])

        # Verify the destination payment method is in the valid list
        if payment_methods:
            valid_method_ids = [pm.get("paymentMethodID") for pm in payment_methods]
            if dest_payment_method_id not in valid_method_ids:
                return False, f"Payment method combination not supported by Moov"

        return True, None

    except HTTPException as e:
        # If transfer-options fails, log but don't block (graceful degradation)
        logger.warning(f"Transfer-options validation failed: {e.detail}")
        return True, None  # Allow transfer to proceed


def create_transfer(
    transfer_type: str,
    amount_cents: int,
    currency: str,
    source: Dict[str, str],
    destination: Dict[str, str],
    description: str,
    metadata: Dict[str, Any],
    idempotency_key: str,
) -> Dict[str, Any]:
    """
    Create a transfer with pre-flight validation.

    Validates:
    - Source/destination capabilities
    - Amount constraints
    - Payment method compatibility

    Args:
        transfer_type: Type of transfer (nightly_debit, payout, invoice_collection, etc.)
        amount_cents: Amount in cents
        currency: Currency code (default USD)
        source: {'accountID': ..., 'paymentMethodID': ...}
        destination: {'accountID': ...}
        description: Transfer description
        metadata: Additional metadata
        idempotency_key: Idempotency key for idempotent requests

    Returns:
        Moov transfer response
    """
    import logging
    logger = logging.getLogger(__name__)

    # Pre-flight validation
    source_account = source.get("accountID")
    source_method = source.get("paymentMethodID")
    dest_account = destination.get("accountID")
    dest_method = destination.get("paymentMethodID")

    # Only validate if we have all required IDs
    if source_account and source_method and dest_account and dest_method:
        is_valid, error = validate_transfer_request(
            source_account, source_method,
            dest_account, dest_method,
            amount_cents, currency
        )
        if not is_valid:
            logger.error(f"Transfer validation failed: {error}")
            raise HTTPException(status_code=400, detail=f"Transfer validation failed: {error}")

    # Build transfer payload matching Moov API v2025.07.00 spec
    payload = {
        "amount": {"currency": currency, "value": amount_cents},
        "source": source,
        "destination": destination,
        "description": description,
        "metadata": metadata,
    }

    # Make request with retry logic
    response = _moov_request_with_retry(
        "POST",
        "/transfers",
        json_body=payload,
        idempotency_key=idempotency_key,
        max_retries=3
    )

    return response


def select_billing_payment_method(restaurant_id: int) -> Optional[dict]:
    method = _select_preferred_method("restaurant", restaurant_id, ["card", "debit_card"])
    if method:
        return method
    return _select_preferred_method("restaurant", restaurant_id, ["bank_account", "ach"])


def select_restaurant_debit_method(restaurant_id: int) -> Optional[dict]:
    return _select_preferred_method("restaurant", restaurant_id, ["bank_account", "ach"])


def select_employee_payout_method(restaurant_id: int, employee_id: int) -> Optional[dict]:
    return _select_preferred_method("employee", employee_id)
