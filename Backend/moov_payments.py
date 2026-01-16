import json
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Any, Dict, List, Optional

try:
    from Backend.db import _get_cursor, _fetch_restaurant_name
    from Backend.moov_service import (
        create_onboarding_link,
        ensure_moov_account,
        fetch_account,
        list_payment_methods,
        refresh_payment_methods,
        set_preferred_payment_method,
        autocomplete_address,
        enrich_business_profile,
        lookup_ach_institution,
        get_avatar,
        list_industries,
    )
    from Backend.moov_jobs import _send_billing_email
except ImportError:
    from db import _get_cursor, _fetch_restaurant_name
    from moov_service import (
        create_onboarding_link,
        ensure_moov_account,
        fetch_account,
        list_payment_methods,
        refresh_payment_methods,
        set_preferred_payment_method,
        autocomplete_address,
        enrich_business_profile,
        lookup_ach_institution,
        get_avatar,
        list_industries,
    )
    from moov_jobs import _send_billing_email

router = APIRouter()


class MoovOnboardingPayload(BaseModel):
    returnUrl: str
    refreshUrl: Optional[str] = None


class PreferredPaymentPayload(BaseModel):
    paymentMethodId: str


def _fetch_restaurant_contact(restaurant_id: int) -> Dict[str, Optional[str]]:
    import logging
    logger = logging.getLogger(__name__)

    cursor = _get_cursor(dictionary=True)
    try:
        # Try to fetch contact info from SRC_ONBOARDING
        # If columns don't exist in production, return empty dict
        try:
            cursor.execute(
                """
                SELECT RESTAURANTID
                FROM GRATLYDB.SRC_ONBOARDING
                WHERE RESTAURANTID = %s
                LIMIT 1
                """,
                (restaurant_id,),
            )
            row = cursor.fetchone()
            if not row:
                logger.warning(f"No SRC_ONBOARDING record for restaurant {restaurant_id}")
                return {}
        except Exception as e:
            logger.warning(f"Failed to query SRC_ONBOARDING: {e}")
            return {}

        # Return empty contact - actual columns may not exist in production
        return {
            "name": None,
            "email": None,
            "phone": None,
        }
    finally:
        cursor.close()


def _fetch_user_profile(user_id: int) -> Dict[str, Optional[str]]:
    import logging
    logger = logging.getLogger(__name__)

    cursor = _get_cursor(dictionary=True)
    try:
        try:
            cursor.execute(
                """
                SELECT USERID
                FROM GRATLYDB.USER_MASTER
                WHERE USERID = %s
                LIMIT 1
                """,
                (user_id,),
            )
            row = cursor.fetchone()
            if not row:
                logger.warning(f"No USER_MASTER record for user {user_id}")
                return {"name": "User", "email": None, "phone": None}
        except Exception as e:
            logger.warning(f"Failed to query USER_MASTER: {e}")
            return {"name": "User", "email": None, "phone": None}

        # Return default profile - actual columns may not exist
        return {
            "name": "User",
            "email": None,
            "phone": None,
        }
    except Exception as e:
        logger.error(f"Error in _fetch_user_profile: {e}")
        return {"name": "User", "email": None, "phone": None}
    finally:
        cursor.close()


def _upsert_moov_account_status(
    owner_type: str,
    owner_id: int,
    status: Optional[str],
    onboarding_status: Optional[str],
    capabilities_json: Optional[Dict[str, Any]] = None,
) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            UPDATE GRATLYDB.MOOV_ACCOUNTS
            SET STATUS = %s,
                ONBOARDING_STATUS = %s,
                CAPABILITIES_JSON = %s,
                UPDATED_AT = NOW()
            WHERE OWNER_TYPE = %s AND OWNER_ID = %s
            """,
            (
                status,
                onboarding_status,
                json.dumps(capabilities_json) if capabilities_json else None,
                owner_type,
                owner_id,
            ),
        )
    finally:
        cursor.close()


def _record_webhook_event(provider: str, event_id: str, event_type: str, payload: Dict[str, Any]) -> bool:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO GRATLYDB.WEBHOOK_EVENTS (
                PROVIDER,
                EVENT_ID,
                EVENT_TYPE,
                PAYLOAD_JSON,
                RECEIVED_AT
            )
            VALUES (%s, %s, %s, %s, NOW())
            """,
            (provider, event_id, event_type, json.dumps(payload)),
        )
        return True
    except Exception:
        return False
    finally:
        cursor.close()


def _update_transfer_status(moov_transfer_id: str, status: str, failure_reason: Optional[str] = None) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            UPDATE GRATLYDB.TRANSFERS
            SET STATUS = %s,
                FAILURE_REASON = %s,
                UPDATED_AT = NOW()
            WHERE MOOV_TRANSFER_ID = %s
            """,
            (status, failure_reason, moov_transfer_id),
        )
        cursor.execute(
            """
            SELECT TRANSFER_TYPE AS transfer_type, REFERENCE_ID AS reference_id
            FROM GRATLYDB.TRANSFERS
            WHERE MOOV_TRANSFER_ID = %s
            LIMIT 1
            """,
            (moov_transfer_id,),
        )
        row = cursor.fetchone() or {}
        transfer_type = row.get("transfer_type")
        reference_id = row.get("reference_id")
        if transfer_type == "nightly_debit" and reference_id:
            cursor.execute(
                """
                UPDATE GRATLYDB.NIGHTLY_DEBIT_BATCHES
                SET STATUS = %s,
                    FAILURE_REASON = %s,
                    UPDATED_AT = NOW()
                WHERE ID = %s
                """,
                (status, failure_reason, reference_id),
            )
        if transfer_type == "payout" and reference_id:
            cursor.execute(
                """
                UPDATE GRATLYDB.PAYOUT_ITEMS
                SET STATUS = %s,
                    FAILURE_REASON = %s,
                    PAID_AT = CASE WHEN %s IN ('completed', 'paid') THEN NOW() ELSE PAID_AT END,
                    UPDATED_AT = NOW()
                WHERE ID = %s
                """,
                (status, failure_reason, status, reference_id),
            )
    finally:
        cursor.close()


def _build_restaurant_account_payload(restaurant_id: int) -> Dict[str, Any]:
    import logging
    logger = logging.getLogger(__name__)

    restaurant_name = ((_fetch_restaurant_name(restaurant_id) or "Restaurant").strip() or "Restaurant")

    # Moov API v2025.07.00 schema - only accepts these fields
    payload = {
        "accountType": "business",
        "profile": {
            "business": {
                "legalBusinessName": restaurant_name,
            }
        },
        "foreignId": f"restaurant-{restaurant_id}"
    }

    logger.info(f"[RESTAURANT PAYLOAD] Built payload: {json.dumps(payload, indent=2)}")
    return payload


def _build_employee_account_payload(user_id: int) -> Dict[str, Any]:
    import logging
    logger = logging.getLogger(__name__)

    profile = _fetch_user_profile(user_id)

    # Ensure we have a name
    name = (profile.get("name") or "User").strip()

    # Parse full name into first and last name
    name_parts = name.rsplit(" ", 1)  # Split on last space
    first_name = name_parts[0]
    last_name = name_parts[1] if len(name_parts) > 1 else ""

    # Moov API v2025.07.00 schema - only accepts these fields for individual accounts
    payload = {
        "accountType": "individual",
        "profile": {
            "individual": {
                "name": {
                    "firstName": first_name,
                    "lastName": last_name or "User",
                }
            }
        },
        "foreignId": f"employee-{user_id}"
    }

    # Add optional email if available
    email = (profile.get("email") or "").strip()
    if email:
        payload["profile"]["individual"]["email"] = email

    logger.info(f"[EMPLOYEE PAYLOAD] Built payload: {json.dumps(payload, indent=2)}")
    return payload


@router.post("/api/restaurants/{restaurant_id}/moov/onboarding-link")
def start_restaurant_onboarding(restaurant_id: int, payload: MoovOnboardingPayload):
    import logging
    logger = logging.getLogger(__name__)
    try:
        logger.info(f"Starting Moov onboarding for restaurant {restaurant_id}")
        moov_account_id = ensure_moov_account(
            "restaurant",
            restaurant_id,
            _build_restaurant_account_payload(restaurant_id),
        )
        logger.info(f"Created Moov account {moov_account_id}, generating onboarding link")
        link = create_onboarding_link(moov_account_id, payload.returnUrl, payload.refreshUrl)
        return {"redirectUrl": link}
    except Exception as e:
        logger.error(f"Error in start_restaurant_onboarding: {str(e)}", exc_info=True)
        # For localhost testing, return mock data if Moov API is unreachable
        if "nodename nor servname provided" in str(e) or "Connection" in str(e.__class__.__name__):
            logger.warning("Moov API unreachable - returning mock onboarding URL for testing")
            return {"redirectUrl": f"{payload.returnUrl}?moov_mock=true&account_id=mock-restaurant-{restaurant_id}"}
        raise


@router.post("/api/employees/{user_id}/moov/onboarding-link")
def start_employee_onboarding(user_id: int, payload: MoovOnboardingPayload):
    import logging
    logger = logging.getLogger(__name__)
    try:
        moov_account_id = ensure_moov_account(
            "employee",
            user_id,
            _build_employee_account_payload(user_id),
        )
        link = create_onboarding_link(moov_account_id, payload.returnUrl, payload.refreshUrl)
        return {"redirectUrl": link}
    except Exception as e:
        logger.error(f"Error in start_employee_onboarding: {str(e)}", exc_info=True)
        # For localhost testing, return mock data if Moov API is unreachable
        if "nodename nor servname provided" in str(e) or "Connection" in str(e.__class__.__name__):
            logger.warning("Moov API unreachable - returning mock onboarding URL for testing")
            return {"redirectUrl": f"{payload.returnUrl}?moov_mock=true&account_id=mock-employee-{user_id}"}
        raise


@router.get("/api/restaurants/{restaurant_id}/moov/connection")
def fetch_restaurant_connection(restaurant_id: int):
    import logging
    logger = logging.getLogger(__name__)
    try:
        moov_account_id = ensure_moov_account(
            "restaurant",
            restaurant_id,
            _build_restaurant_account_payload(restaurant_id),
        )
        account = fetch_account(moov_account_id)
        _upsert_moov_account_status(
            "restaurant",
            restaurant_id,
            account.get("status"),
            account.get("onboardingStatus") or account.get("onboarding_status"),
            account.get("capabilities"),
        )
        return {
            "connected": True,
            "moovAccountId": moov_account_id,
            "onboardingStatus": account.get("onboardingStatus") or account.get("onboarding_status"),
            "status": account.get("status"),
        }
    except Exception as e:
        logger.error(f"Error in fetch_restaurant_connection: {str(e)}", exc_info=True)
        # For localhost testing, return mock data if Moov API is unreachable
        if "nodename nor servname provided" in str(e):
            logger.warning("Moov API unreachable - returning mock data for testing")
            return {
                "connected": False,
                "moovAccountId": f"mock-restaurant-{restaurant_id}",
                "onboardingStatus": "pending",
                "status": "testing_mode"
            }
        raise


@router.get("/api/employees/{user_id}/moov/connection")
def fetch_employee_connection(user_id: int):
    import logging
    logger = logging.getLogger(__name__)
    try:
        moov_account_id = ensure_moov_account(
            "employee",
            user_id,
            _build_employee_account_payload(user_id),
        )
        account = fetch_account(moov_account_id)
        _upsert_moov_account_status(
            "employee",
            user_id,
            account.get("status"),
            account.get("onboardingStatus") or account.get("onboarding_status"),
            account.get("capabilities"),
        )
        return {
            "connected": True,
            "moovAccountId": moov_account_id,
            "onboardingStatus": account.get("onboardingStatus") or account.get("onboarding_status"),
            "status": account.get("status"),
        }
    except Exception as e:
        logger.error(f"Error in fetch_employee_connection: {str(e)}", exc_info=True)
        # For localhost testing, return mock data if Moov API is unreachable
        if "nodename nor servname provided" in str(e):
            logger.warning("Moov API unreachable - returning mock data for testing")
            return {
                "connected": False,
                "moovAccountId": f"mock-employee-{user_id}",
                "onboardingStatus": "pending",
                "status": "testing_mode"
            }
        raise


@router.get("/api/restaurants/{restaurant_id}/moov/payment-methods")
def get_restaurant_payment_methods(restaurant_id: int):
    methods = list_payment_methods("restaurant", restaurant_id)
    return {"methods": methods}


@router.get("/api/employees/{user_id}/moov/payment-methods")
def get_employee_payment_methods(user_id: int):
    methods = list_payment_methods("employee", user_id)
    return {"methods": methods}


@router.post("/api/restaurants/{restaurant_id}/moov/payment-methods/refresh")
def refresh_restaurant_payment_methods(restaurant_id: int):
    moov_account_id = ensure_moov_account(
        "restaurant",
        restaurant_id,
        _build_restaurant_account_payload(restaurant_id),
    )
    refresh_payment_methods("restaurant", restaurant_id, moov_account_id)
    methods = list_payment_methods("restaurant", restaurant_id)
    return {"methods": methods}


@router.post("/api/employees/{user_id}/moov/payment-methods/refresh")
def refresh_employee_payment_methods(user_id: int):
    moov_account_id = ensure_moov_account(
        "employee",
        user_id,
        _build_employee_account_payload(user_id),
    )
    refresh_payment_methods("employee", user_id, moov_account_id)
    methods = list_payment_methods("employee", user_id)
    return {"methods": methods}


@router.post("/api/restaurants/{restaurant_id}/moov/payment-methods/preferred")
def update_restaurant_preferred_method(restaurant_id: int, payload: PreferredPaymentPayload):
    set_preferred_payment_method("restaurant", restaurant_id, payload.paymentMethodId)
    return {"success": True}


@router.post("/api/employees/{user_id}/moov/payment-methods/preferred")
def update_employee_preferred_method(user_id: int, payload: PreferredPaymentPayload):
    set_preferred_payment_method("employee", user_id, payload.paymentMethodId)
    return {"success": True}


# ============================================================================
# MOOV ENRICHMENT API ENDPOINTS - Form Shortening & Data Enrichment
# ============================================================================

@router.get("/api/moov/enrichment/address")
def enrich_address(search: str, max_results: Optional[int] = None):
    """
    Autocomplete address using Moov enrichment API.

    Query Parameters:
    - search: Partial or complete address to search (required)
    - max_results: Maximum number of suggestions to return (optional)
    """
    return autocomplete_address(search, max_results)


@router.get("/api/moov/enrichment/business-profile")
def enrich_profile(email: str):
    """
    Enrich business profile using email address.

    Query Parameters:
    - email: Email address to lookup (required)

    Returns business details: address, phone, industry codes, legal name, website
    """
    profile = enrich_business_profile(email)
    if not profile:
        raise HTTPException(status_code=404, detail="No profile found for email")
    return profile


@router.get("/api/moov/enrichment/ach-institutions")
def search_ach_institutions(
    routing_number: Optional[str] = None,
    name: Optional[str] = None,
    state: Optional[str] = None,
    limit: Optional[int] = None
):
    """
    Look up ACH institutions by routing number or name.

    Query Parameters:
    - routing_number: Routing number of the institution (optional)
    - name: Name of the financial institution (optional)
    - state: State where institution is based (optional)
    - limit: Maximum results to return (optional)

    Note: Must provide either routing_number or name
    """
    if not routing_number and not name:
        raise HTTPException(status_code=400, detail="Must provide either routing_number or name")

    return lookup_ach_institution(routing_number, name, state, limit)


@router.get("/api/moov/enrichment/industries")
def get_industries():
    """
    Get all available industries with codes and categories.

    Returns array of industries with:
    - industry: classification identifier
    - displayName: human-readable name
    - category: category slug
    - categoryDisplayName: human-readable category
    - defaultMcc: default Merchant Category Code
    """
    return list_industries()


@router.post("/api/webhooks/moov")
async def handle_moov_webhook(request: Request):
    import os
    from Backend.moov_webhook import verify_webhook_signature

    # Get raw body for signature verification
    payload_raw = await request.body()
    payload = await request.json() if payload_raw else {}

    # Extract Moov signature headers (v2025.07.00)
    timestamp = request.headers.get("X-Timestamp", "")
    nonce = request.headers.get("X-Nonce", "")
    webhook_id = request.headers.get("X-Webhook-ID", "")
    signature = request.headers.get("X-Signature", "")

    # Verify signature
    webhook_secret = os.getenv("MOOV_WEBHOOK_SECRET", "")
    if not verify_webhook_signature(
        payload_raw, timestamp, nonce, webhook_id, signature, webhook_secret
    ):
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Webhook signature verification failed for {webhook_id}")
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    event_id = payload.get("id") or payload.get("eventID") or payload.get("event_id")
    event_type = payload.get("type") or payload.get("eventType") or payload.get("event_type") or "unknown"
    if not event_id:
        raise HTTPException(status_code=400, detail="Missing event id")
    if not _record_webhook_event("moov", event_id, event_type, payload):
        return {"received": True, "duplicate": True}

    data = payload.get("data") or payload
    transfer_id = data.get("transferID") or data.get("transferId") or data.get("id")
    status = data.get("status")
    failure_reason = data.get("failureReason") or data.get("reason")
    invoice_id = data.get("invoiceID") or data.get("invoiceId")

    if transfer_id and status and ("transfer" in event_type.lower() or "payment" in event_type.lower()):
        _update_transfer_status(transfer_id, status, failure_reason)

    if invoice_id and ("invoice" in event_type.lower() or "billing" in event_type.lower()):
        cursor = _get_cursor(dictionary=True)
        try:
            cursor.execute(
                """
                SELECT ID AS charge_id, RESTAURANTID AS restaurant_id, AMOUNT_CENTS AS amount_cents
                FROM GRATLYDB.MONTHLY_FEE_CHARGES
                WHERE MOOV_INVOICE_ID = %s
                LIMIT 1
                """,
                (invoice_id,),
            )
            charge_row = cursor.fetchone()

            cursor.execute(
                """
                UPDATE GRATLYDB.MONTHLY_FEE_CHARGES
                SET MOOV_INVOICE_STATUS = %s,
                    PAYMENT_STATUS = %s,
                    FAILURE_REASON = %s,
                    PAID_AT = CASE WHEN %s IN ('paid', 'completed') THEN NOW() ELSE PAID_AT END,
                    UPDATED_AT = NOW()
                WHERE MOOV_INVOICE_ID = %s
                """,
                (status, status, failure_reason, status, invoice_id),
            )

            # Send emails based on invoice payment status
            if charge_row:
                charge_id = charge_row.get("charge_id")
                restaurant_id = charge_row.get("restaurant_id")
                amount_cents = charge_row.get("amount_cents")

                if status in ("paid", "completed"):
                    _send_billing_email(
                        charge_id,
                        restaurant_id,
                        "payment_success",
                        "Payment Received - Gratly Invoice",
                        f"Your invoice payment of ${amount_cents / 100:.2f} has been successfully received.",
                    )
                elif status in ("failed", "refunded", "failed_settlement"):
                    _send_billing_email(
                        charge_id,
                        restaurant_id,
                        "payment_failed",
                        "Payment Failed - Action Required",
                        f"Your invoice payment of ${amount_cents / 100:.2f} failed. Reason: {failure_reason or 'Unknown'}. Please update your payment method.",
                    )
        finally:
            cursor.close()

    return {"received": True}
