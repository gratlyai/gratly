from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Any, Dict, Optional, Tuple, List
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import hmac
import json
import logging
import os
import time
import importlib
from dotenv import load_dotenv

try:
    from Backend.db import _get_cursor
except ImportError:
    from db import _get_cursor

router = APIRouter()

logger = logging.getLogger(__name__)

DEFAULT_TOLERANCE_SECONDS = 300

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


class PaymentIntentPayload(BaseModel):
    amount: int
    currency: str
    employeeGuid: str
    restaurantGuid: str
    description: Optional[str] = None


class StripeBackfillPayload(BaseModel):
    limit: int = 50


class SettlementTransferPayload(BaseModel):
    settlementId: str
    restaurantId: Optional[int] = None
    restaurantGuid: Optional[str] = None
    businessDate: Optional[str] = None


class RestaurantDebitPayload(BaseModel):
    settlementId: str
    restaurantId: Optional[int] = None
    restaurantGuid: Optional[str] = None
    businessDate: Optional[str] = None


class RestaurantPaymentMethodPayload(BaseModel):
    paymentMethodId: str


class StripeRefreshAccountPayload(BaseModel):
    employeeGuid: Optional[str] = None
    stripeAccountId: Optional[str] = None


class StripeBulkRefreshPayload(BaseModel):
    limit: int = 50


class StripeRestaurantGuidBackfillPayload(BaseModel):
    limit: int = 500


def _require_admin_token(request: Request) -> None:
    expected = os.getenv("STRIPE_ADMIN_TOKEN")
    if not expected:
        raise HTTPException(status_code=500, detail="Stripe admin token not configured")
    provided = request.headers.get("X-Admin-Token")
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Forbidden")


def _get_stripe_module():
    try:
        stripe_module = importlib.import_module("stripe")
        stripe_error_module = getattr(stripe_module, "error", None)
        StripeError = getattr(stripe_error_module, "StripeError", Exception)
        return stripe_module, StripeError
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Stripe SDK not installed: {exc}",
        ) from exc


def _parse_signature_header(signature_header: str) -> Optional[Tuple[int, List[str]]]:
    timestamp = None
    signatures: List[str] = []
    for part in signature_header.split(","):
        key, _, value = part.strip().partition("=")
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError:
                return None
        elif key == "v1" and value:
            signatures.append(value)
    if timestamp is None or not signatures:
        return None
    return timestamp, signatures


def _verify_signature(
    payload: bytes,
    signature_header: str,
    secret: str,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
) -> bool:
    parsed = _parse_signature_header(signature_header)
    if not parsed:
        return False
    timestamp, signatures = parsed
    if abs(int(time.time()) - timestamp) > tolerance_seconds:
        return False

    signed_payload = str(timestamp).encode("utf-8") + b"." + payload
    expected_signature = hmac.new(
        secret.encode("utf-8"), signed_payload, hashlib.sha256
    ).hexdigest()

    return any(
        hmac.compare_digest(expected_signature, candidate)
        for candidate in signatures
    )


def _handle_payment_intent_succeeded(event: Dict[str, Any]) -> None:
    payment_intent = event.get("data", {}).get("object", {})
    logger.info(
        "Stripe payment_intent.succeeded received for %s",
        payment_intent.get("id"),
    )
    _log_payment_intent_event(event, payment_intent)
    _create_transfers_for_settlement(payment_intent)


def _handle_payment_intent_failed(event: Dict[str, Any]) -> None:
    payment_intent = event.get("data", {}).get("object", {})
    logger.warning(
        "Stripe payment_intent.payment_failed received for %s",
        payment_intent.get("id"),
    )
    _log_payment_intent_event(event, payment_intent)


def _handle_payment_intent_processing(event: Dict[str, Any]) -> None:
    payment_intent = event.get("data", {}).get("object", {})
    logger.info(
        "Stripe payment_intent.processing received for %s",
        payment_intent.get("id"),
    )
    _log_payment_intent_event(event, payment_intent)


def _handle_payment_intent_requires_action(event: Dict[str, Any]) -> None:
    payment_intent = event.get("data", {}).get("object", {})
    logger.info(
        "Stripe payment_intent.requires_action received for %s",
        payment_intent.get("id"),
    )
    _log_payment_intent_event(event, payment_intent)


def _log_payment_intent_event(event: Dict[str, Any], payment_intent: Dict[str, Any]) -> None:
    event_id = event.get("id")
    event_type = event.get("type")
    if not event_id or not event_type:
        return

    metadata = payment_intent.get("metadata") or {}
    employee_guid = None
    restaurant_guid = None
    if isinstance(metadata, dict):
        employee_guid = metadata.get("employee_guid") or metadata.get("employeeGuid")
        restaurant_guid = metadata.get("restaurant_guid") or metadata.get("restaurantGuid")

    payment_intent_id = payment_intent.get("id")
    amount = payment_intent.get("amount")
    currency = payment_intent.get("currency")
    status = payment_intent.get("status")
    created_unix = event.get("created") or payment_intent.get("created") or int(time.time())

    cursor = _get_cursor(dictionary=False)
    try:
        cursor.execute(
            """
            INSERT IGNORE INTO GRATLYDB.STRIPE_PAYMENT_EVENTS (
                EVENT_ID,
                EVENT_TYPE,
                PAYMENT_INTENT_ID,
                EMPLOYEEGUID,
                AMOUNT,
                CURRENCY,
                STATUS,
                CREATED_AT,
                RAW_PAYLOAD,
                RESTAURANTGUID
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, FROM_UNIXTIME(%s), %s, %s)
            """,
            (
                event_id,
                event_type,
                payment_intent_id,
                employee_guid,
                amount,
                currency,
                status,
                created_unix,
                json.dumps(event),
                restaurant_guid,
            ),
        )
        cursor.connection.commit()
    finally:
        cursor.close()


def _extract_metadata(obj: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    metadata = obj.get("metadata") or {}
    if not isinstance(metadata, dict):
        return None, None
    employee_guid = metadata.get("employee_guid") or metadata.get("employeeGuid")
    restaurant_guid = metadata.get("restaurant_guid") or metadata.get("restaurantGuid")
    return employee_guid, restaurant_guid


def _extract_metadata_from_raw(raw_payload: Optional[object]) -> Tuple[Optional[str], Optional[str]]:
    if raw_payload is None:
        return None, None
    try:
        payload = raw_payload
        if isinstance(raw_payload, str):
            payload = json.loads(raw_payload)
        data_object = payload.get("data", {}).get("object", {}) if isinstance(payload, dict) else {}
        if isinstance(data_object, dict):
            return _extract_metadata(data_object)
    except (ValueError, TypeError, AttributeError):
        return None, None
    return None, None


def _fetch_restaurant_id_by_guid(restaurant_guid: str) -> Optional[int]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT RESTAURANTID AS restaurant_id
            FROM GRATLYDB.SRC_ONBOARDING
            WHERE RESTAURANTGUID = %s
            LIMIT 1
            """,
            (restaurant_guid,),
        )
        row = cursor.fetchone()
        return row["restaurant_id"] if row else None
    finally:
        cursor.close()


def _fetch_restaurant_guid_by_id(restaurant_id: int) -> Optional[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT RESTAURANTGUID AS restaurant_guid
            FROM GRATLYDB.SRC_ONBOARDING
            WHERE RESTAURANTID = %s
            LIMIT 1
            """,
            (restaurant_id,),
        )
        row = cursor.fetchone()
        return row["restaurant_guid"] if row else None
    finally:
        cursor.close()


def _fetch_payout_final_rows(settlement_id: str, restaurant_id: int) -> List[Dict[str, Any]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT EMPLOYEEGUID AS employee_guid, NET_PAYOUT AS net_payout, BUSINESSDATE AS business_date
            FROM GRATLYDB.PAYOUT_FINAL
            WHERE PAYOUT_APPROVALID = %s
              AND RESTAURANTID = %s
            """,
            (settlement_id, restaurant_id),
        )
        return cursor.fetchall()
    finally:
        cursor.close()


def _fetch_restaurant_settings(restaurant_id: int) -> Optional[Dict[str, Any]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                RESTAURANTGUID AS restaurant_guid,
                STRIPE_CUSTOMER_ID AS stripe_customer_id,
                US_BANK_PAYMENT_METHOD_ID AS us_bank_payment_method_id,
                BANK_LAST4 AS bank_last4,
                BANK_NAME AS bank_name
            FROM GRATLYDB.STRIPE_RESTAURANT_SETTINGS
            WHERE RESTAURANTID = %s
            LIMIT 1
            """,
            (restaurant_id,),
        )
        return cursor.fetchone()
    finally:
        cursor.close()


def _upsert_restaurant_settings(
    restaurant_id: int,
    stripe_customer_id: Optional[str] = None,
    us_bank_payment_method_id: Optional[str] = None,
    bank_last4: Optional[str] = None,
    bank_name: Optional[str] = None,
) -> None:
    restaurant_guid = _fetch_restaurant_guid_by_id(restaurant_id)
    cursor = _get_cursor(dictionary=False)
    try:
        cursor.execute(
            """
            INSERT INTO GRATLYDB.STRIPE_RESTAURANT_SETTINGS (
                RESTAURANTGUID,
                RESTAURANTID,
                STRIPE_CUSTOMER_ID,
                US_BANK_PAYMENT_METHOD_ID,
                BANK_LAST4,
                BANK_NAME
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                RESTAURANTGUID = COALESCE(VALUES(RESTAURANTGUID), RESTAURANTGUID),
                STRIPE_CUSTOMER_ID = COALESCE(VALUES(STRIPE_CUSTOMER_ID), STRIPE_CUSTOMER_ID),
                US_BANK_PAYMENT_METHOD_ID = COALESCE(VALUES(US_BANK_PAYMENT_METHOD_ID), US_BANK_PAYMENT_METHOD_ID),
                BANK_LAST4 = COALESCE(VALUES(BANK_LAST4), BANK_LAST4),
                BANK_NAME = COALESCE(VALUES(BANK_NAME), BANK_NAME)
            """,
            (
                restaurant_guid,
                restaurant_id,
                stripe_customer_id,
                us_bank_payment_method_id,
                bank_last4,
                bank_name,
            ),
        )
        cursor.connection.commit()
    finally:
        cursor.close()


def _fetch_settlement_business_date(settlement_id: str, restaurant_id: int) -> Optional[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT BUSINESSDATE AS business_date
            FROM GRATLYDB.PAYOUT_FINAL
            WHERE PAYOUT_APPROVALID = %s
              AND RESTAURANTID = %s
            LIMIT 1
            """,
            (settlement_id, restaurant_id),
        )
        row = cursor.fetchone()
        return row["business_date"] if row else None
    finally:
        cursor.close()


def _get_carry_forward(employee_guid: str, restaurant_id: int) -> int:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT CARRY_FORWARD_CENTS AS carry_forward_cents
            FROM GRATLYDB.STRIPE_EMPLOYEE_CARRY_FORWARD
            WHERE EMPLOYEEGUID = %s AND RESTAURANTID = %s
            LIMIT 1
            """,
            (employee_guid, restaurant_id),
        )
        row = cursor.fetchone()
        return int(row["carry_forward_cents"] or 0) if row else 0
    finally:
        cursor.close()


def _set_carry_forward(employee_guid: str, restaurant_id: int, carry_forward_cents: int) -> None:
    restaurant_guid = _fetch_restaurant_guid_by_id(restaurant_id)
    cursor = _get_cursor(dictionary=False)
    try:
        cursor.execute(
            """
            INSERT INTO GRATLYDB.STRIPE_EMPLOYEE_CARRY_FORWARD (
                RESTAURANTGUID,
                EMPLOYEEGUID,
                RESTAURANTID,
                CARRY_FORWARD_CENTS
            )
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE CARRY_FORWARD_CENTS = VALUES(CARRY_FORWARD_CENTS)
            """,
            (restaurant_guid, employee_guid, restaurant_id, carry_forward_cents),
        )
        cursor.connection.commit()
    finally:
        cursor.close()


def _fetch_connected_account(employee_guid: str) -> Optional[Dict[str, Any]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT STRIPE_ACCOUNT_ID AS stripe_account_id,
                   PAYOUTS_ENABLED AS payouts_enabled,
                   ACCOUNT_DEAUTHORIZED AS account_deauthorized
            FROM GRATLYDB.STRIPE_CONNECTED_ACCOUNTS
            WHERE EMPLOYEEGUID = %s
            LIMIT 1
            """,
            (employee_guid,),
        )
        return cursor.fetchone()
    finally:
        cursor.close()


def _update_connected_account_status(
    stripe_account_id: str,
    charges_enabled: bool,
    payouts_enabled: bool,
    details_submitted: bool,
    disabled_reason: Optional[str],
    account_deauthorized: bool,
    employee_guid: Optional[str] = None,
) -> None:
    cursor = _get_cursor(dictionary=False)
    try:
        cursor.execute(
            """
            UPDATE GRATLYDB.STRIPE_CONNECTED_ACCOUNTS
            SET
                CHARGES_ENABLED = %s,
                PAYOUTS_ENABLED = %s,
                DETAILS_SUBMITTED = %s,
                DISABLED_REASON = %s,
                ACCOUNT_DEAUTHORIZED = %s
            WHERE STRIPE_ACCOUNT_ID = %s
            """,
            (
                int(charges_enabled),
                int(payouts_enabled),
                int(details_submitted),
                disabled_reason,
                int(account_deauthorized),
                stripe_account_id,
            ),
        )
        if cursor.rowcount == 0 and employee_guid:
            cursor.execute(
                """
                SELECT RESTAURANTGUID AS restaurant_guid
                FROM GRATLYDB.SRC_EMPLOYEES
                WHERE EMPLOYEEGUID = %s
                LIMIT 1
                """,
                (employee_guid,),
            )
            row = cursor.fetchone()
            restaurant_guid = row[0] if row else None
            cursor.execute(
                """
                INSERT INTO GRATLYDB.STRIPE_CONNECTED_ACCOUNTS (
                    RESTAURANTGUID,
                    EMPLOYEEGUID,
                    STRIPE_ACCOUNT_ID,
                    CHARGES_ENABLED,
                    PAYOUTS_ENABLED,
                    DETAILS_SUBMITTED,
                    DISABLED_REASON,
                    ACCOUNT_DEAUTHORIZED
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    restaurant_guid,
                    employee_guid,
                    stripe_account_id,
                    int(charges_enabled),
                    int(payouts_enabled),
                    int(details_submitted),
                    disabled_reason,
                    int(account_deauthorized),
                ),
            )
        cursor.connection.commit()
    finally:
        cursor.close()


def _record_settlement_transfer(
    settlement_id: str,
    employee_guid: str,
    transfer_id: str,
    amount_cents: int,
    fee_cents: int,
    carry_forward_cents: int,
    restaurant_guid: Optional[str],
) -> None:
    cursor = _get_cursor(dictionary=False)
    try:
        cursor.execute(
            """
            INSERT IGNORE INTO GRATLYDB.STRIPE_SETTLEMENT_TRANSFERS (
                RESTAURANTGUID,
                SETTLEMENT_ID,
                EMPLOYEEGUID,
                TRANSFER_ID,
                AMOUNT_CENTS,
                FEE_CENTS,
                CARRY_FORWARD_CENTS
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                restaurant_guid,
                settlement_id,
                employee_guid,
                transfer_id,
                amount_cents,
                fee_cents,
                carry_forward_cents,
            ),
        )
        cursor.connection.commit()
    finally:
        cursor.close()


def _settlement_transfer_exists(settlement_id: str, employee_guid: str) -> bool:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT 1
            FROM GRATLYDB.STRIPE_SETTLEMENT_TRANSFERS
            WHERE SETTLEMENT_ID = %s AND EMPLOYEEGUID = %s
            LIMIT 1
            """,
            (settlement_id, employee_guid),
        )
        return bool(cursor.fetchone())
    finally:
        cursor.close()


def _to_cents(amount: Optional[object]) -> int:
    if amount is None:
        return 0
    try:
        value = Decimal(str(amount))
    except Exception:
        return 0
    cents = (value * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(cents)


def _create_transfers_for_settlement(payment_intent: Dict[str, Any]) -> Dict[str, Any]:
    metadata = payment_intent.get("metadata") or {}
    if not isinstance(metadata, dict):
        return {"transfersCreated": 0, "transfersSkipped": 0}

    settlement_id = metadata.get("settlement_id")
    restaurant_guid = metadata.get("restaurant_guid") or metadata.get("restaurantGuid")
    restaurant_id = metadata.get("restaurant_id")
    business_date = metadata.get("business_date")

    if not settlement_id:
        logger.info("Stripe payment intent missing settlement_id; skipping transfers")
        return {"transfersCreated": 0, "transfersSkipped": 0}

    if not restaurant_id and restaurant_guid:
        restaurant_id = _fetch_restaurant_id_by_guid(restaurant_guid)

    if not restaurant_id:
        logger.warning("Missing restaurant id for settlement %s", settlement_id)
        return {"transfersCreated": 0, "transfersSkipped": 0}

    logger.info(
        "Starting settlement transfers for %s (restaurant %s)",
        settlement_id,
        restaurant_id,
    )

    restaurant_guid_resolved = restaurant_guid or _fetch_restaurant_guid_by_id(int(restaurant_id))

    rows = _fetch_payout_final_rows(settlement_id, int(restaurant_id))
    if not rows:
        logger.warning("No payout rows for settlement %s", settlement_id)
        return {"settlementId": settlement_id, "restaurantId": int(restaurant_id), "rows": 0, "transfersCreated": 0, "transfersSkipped": 0}

    stripe, StripeError = _get_stripe_module()
    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY")
    if not stripe_secret_key:
        logger.warning("Stripe secret key not configured; skipping transfers")
        return {"settlementId": settlement_id, "restaurantId": int(restaurant_id), "rows": len(rows), "transfersCreated": 0, "transfersSkipped": len(rows)}
    stripe.api_key = stripe_secret_key

    fee_cents = 100
    created_count = 0
    skipped_count = 0
    for row in rows:
        employee_guid = row.get("employee_guid")
        if not employee_guid:
            skipped_count += 1
            continue
        if _settlement_transfer_exists(settlement_id, employee_guid):
            skipped_count += 1
            continue

        net_cents = _to_cents(row.get("net_payout"))
        carry_forward_cents = _get_carry_forward(employee_guid, int(restaurant_id))
        effective_cents = net_cents + carry_forward_cents

        transfer_cents = effective_cents - fee_cents
        if transfer_cents <= 0:
            _set_carry_forward(employee_guid, int(restaurant_id), effective_cents)
            skipped_count += 1
            continue

        account = _fetch_connected_account(employee_guid)
        if not account or not account.get("stripe_account_id"):
            logger.warning("Missing Stripe account for %s", employee_guid)
            _set_carry_forward(employee_guid, int(restaurant_id), effective_cents)
            skipped_count += 1
            continue

        if not account.get("payouts_enabled") or account.get("account_deauthorized"):
            logger.warning("Stripe account not payout-ready for %s", employee_guid)
            _set_carry_forward(employee_guid, int(restaurant_id), effective_cents)
            skipped_count += 1
            continue

        try:
            transfer = stripe.Transfer.create(
                amount=transfer_cents,
                currency="usd",
                destination=account.get("stripe_account_id"),
                metadata={
                    "settlement_id": settlement_id,
                    "employee_guid": employee_guid,
                    "business_date": business_date,
                    "fee_cents": fee_cents,
                },
                idempotency_key=f"tr_{settlement_id}_{employee_guid}",
            )
        except StripeError:
            logger.exception("Stripe transfer failed for %s", employee_guid)
            skipped_count += 1
            continue

        _set_carry_forward(employee_guid, int(restaurant_id), 0)
        _record_settlement_transfer(
            settlement_id=settlement_id,
            employee_guid=employee_guid,
            transfer_id=transfer.get("id"),
            amount_cents=transfer_cents,
            fee_cents=fee_cents,
            carry_forward_cents=carry_forward_cents,
            restaurant_guid=restaurant_guid_resolved,
        )
        created_count += 1
    result = {
        "settlementId": settlement_id,
        "restaurantId": int(restaurant_id),
        "rows": len(rows),
        "transfersCreated": created_count,
        "transfersSkipped": skipped_count,
    }
    logger.info(
        "Finished settlement transfers for %s (created %s, skipped %s)",
        settlement_id,
        created_count,
        skipped_count,
    )
    return result


def _handle_charge_dispute_event(event: Dict[str, Any]) -> None:
    dispute = event.get("data", {}).get("object", {}) or {}
    event_id = event.get("id")
    event_type = event.get("type")
    if not event_id or not event_type:
        return

    employee_guid, restaurant_guid = _extract_metadata(dispute)
    dispute_id = dispute.get("id")
    charge_id = dispute.get("charge")
    amount = dispute.get("amount")
    currency = dispute.get("currency")
    status = dispute.get("status")
    reason = dispute.get("reason")
    created_unix = event.get("created") or dispute.get("created") or int(time.time())

    if not employee_guid or not restaurant_guid:
        employee_guid, restaurant_guid = _resolve_metadata_from_charge(charge_id)

    cursor = _get_cursor(dictionary=False)
    try:
        cursor.execute(
            """
            INSERT IGNORE INTO GRATLYDB.STRIPE_DISPUTE_EVENTS (
                EVENT_ID,
                EVENT_TYPE,
                DISPUTE_ID,
                CHARGE_ID,
                EMPLOYEEGUID,
                AMOUNT,
                CURRENCY,
                STATUS,
                REASON,
                CREATED_AT,
                RAW_PAYLOAD,
                RESTAURANTGUID
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, FROM_UNIXTIME(%s), %s, %s)
            """,
            (
                event_id,
                event_type,
                dispute_id,
                charge_id,
                employee_guid,
                amount,
                currency,
                status,
                reason,
                created_unix,
                json.dumps(event),
                restaurant_guid,
            ),
        )
        cursor.connection.commit()
    finally:
        cursor.close()


def _handle_balance_available(event: Dict[str, Any]) -> None:
    event_id = event.get("id")
    event_type = event.get("type")
    if not event_id or not event_type:
        return

    created_unix = event.get("created") or int(time.time())
    cursor = _get_cursor(dictionary=False)
    try:
        cursor.execute(
            """
            INSERT IGNORE INTO GRATLYDB.STRIPE_BALANCE_EVENTS (
                EVENT_ID,
                EVENT_TYPE,
                RESTAURANTGUID,
                CREATED_AT,
                RAW_PAYLOAD
            )
            VALUES (%s, %s, %s, FROM_UNIXTIME(%s), %s)
            """,
            (
                event_id,
                event_type,
                None,
                created_unix,
                json.dumps(event),
            ),
        )
        cursor.connection.commit()
    finally:
        cursor.close()


def _handle_transfer_event(event: Dict[str, Any]) -> None:
    transfer = event.get("data", {}).get("object", {}) or {}
    event_id = event.get("id")
    event_type = event.get("type")
    if not event_id or not event_type:
        return

    employee_guid, restaurant_guid = _extract_metadata(transfer)
    transfer_id = transfer.get("id")
    amount = transfer.get("amount")
    currency = transfer.get("currency")
    destination = transfer.get("destination")
    status = transfer.get("status")
    created_unix = event.get("created") or transfer.get("created") or int(time.time())

    if not employee_guid or not restaurant_guid:
        employee_guid, restaurant_guid = _resolve_metadata_from_transfer(transfer_id)

    cursor = _get_cursor(dictionary=False)
    try:
        cursor.execute(
            """
            INSERT IGNORE INTO GRATLYDB.STRIPE_TRANSFER_EVENTS (
                EVENT_ID,
                EVENT_TYPE,
                TRANSFER_ID,
                EMPLOYEEGUID,
                AMOUNT,
                CURRENCY,
                STATUS,
                DESTINATION_ACCOUNT,
                CREATED_AT,
                RAW_PAYLOAD,
                RESTAURANTGUID
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, FROM_UNIXTIME(%s), %s, %s)
            """,
            (
                event_id,
                event_type,
                transfer_id,
                employee_guid,
                amount,
                currency,
                status,
                destination,
                created_unix,
                json.dumps(event),
                restaurant_guid,
            ),
        )
        cursor.connection.commit()
    finally:
        cursor.close()


def _handle_payout_event(event: Dict[str, Any]) -> None:
    payout = event.get("data", {}).get("object", {}) or {}
    event_id = event.get("id")
    event_type = event.get("type")
    if not event_id or not event_type:
        return

    employee_guid, restaurant_guid = _extract_metadata(payout)
    payout_id = payout.get("id")
    amount = payout.get("amount")
    currency = payout.get("currency")
    status = payout.get("status")
    arrival_date = payout.get("arrival_date")
    payout_method = payout.get("method")
    destination = payout.get("destination")
    account_id = event.get("account")
    created_unix = event.get("created") or payout.get("created") or int(time.time())

    if not employee_guid or not restaurant_guid:
        employee_guid, restaurant_guid = _resolve_metadata_from_account(account_id)

    cursor = _get_cursor(dictionary=False)
    try:
        cursor.execute(
            """
            INSERT IGNORE INTO GRATLYDB.STRIPE_PAYOUT_EVENTS (
                EVENT_ID,
                EVENT_TYPE,
                PAYOUT_ID,
                EMPLOYEEGUID,
                AMOUNT,
                CURRENCY,
                STATUS,
                ARRIVAL_DATE,
                PAYOUT_METHOD,
                DESTINATION,
                ACCOUNT_ID,
                CREATED_AT,
                RAW_PAYLOAD,
                RESTAURANTGUID
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, FROM_UNIXTIME(%s), %s, %s)
            """,
            (
                event_id,
                event_type,
                payout_id,
                employee_guid,
                amount,
                currency,
                status,
                arrival_date,
                payout_method,
                destination,
                account_id,
                created_unix,
                json.dumps(event),
                restaurant_guid,
            ),
        )
        cursor.connection.commit()
    finally:
        cursor.close()


def _resolve_metadata_from_charge(charge_id: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    if not charge_id:
        return None, None
    stripe, StripeError = _get_stripe_module()
    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY")
    if not stripe_secret_key:
        return None, None
    stripe.api_key = stripe_secret_key
    try:
        charge = stripe.Charge.retrieve(charge_id)
        return _extract_metadata(charge)
    except StripeError:
        return None, None


def _resolve_metadata_from_transfer(transfer_id: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    if not transfer_id:
        return None, None
    stripe, StripeError = _get_stripe_module()
    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY")
    if not stripe_secret_key:
        return None, None
    stripe.api_key = stripe_secret_key
    try:
        transfer = stripe.Transfer.retrieve(transfer_id)
        return _extract_metadata(transfer)
    except StripeError:
        return None, None


def _resolve_metadata_from_account(account_id: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    if not account_id:
        return None, None
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                sca.EMPLOYEEGUID AS employee_guid,
                se.RESTAURANTGUID AS restaurant_guid
            FROM GRATLYDB.STRIPE_CONNECTED_ACCOUNTS sca
            LEFT JOIN GRATLYDB.SRC_EMPLOYEES se
                ON se.EMPLOYEEGUID = sca.EMPLOYEEGUID
            WHERE sca.STRIPE_ACCOUNT_ID = %s
            LIMIT 1
            """,
            (account_id,),
        )
        row = cursor.fetchone()
        employee_guid = row["employee_guid"] if row else None
        restaurant_guid = row["restaurant_guid"] if row else None
    finally:
        cursor.close()
    return employee_guid, restaurant_guid


def _update_metadata_fields(
    table: str,
    event_id: str,
    employee_guid: Optional[str],
    restaurant_guid: Optional[str],
) -> None:
    cursor = _get_cursor(dictionary=False)
    try:
        cursor.execute(
            f"""
            UPDATE GRATLYDB.{table}
            SET EMPLOYEEGUID = COALESCE(%s, EMPLOYEEGUID),
                RESTAURANTGUID = COALESCE(%s, RESTAURANTGUID)
            WHERE EVENT_ID = %s
            """,
            (employee_guid, restaurant_guid, event_id),
        )
        cursor.connection.commit()
    finally:
        cursor.close()


def _backfill_dispute_events(limit: int) -> int:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT EVENT_ID, CHARGE_ID, RAW_PAYLOAD, EMPLOYEEGUID, RESTAURANTGUID
            FROM GRATLYDB.STRIPE_DISPUTE_EVENTS
            WHERE (EMPLOYEEGUID IS NULL OR RESTAURANTGUID IS NULL)
            LIMIT %s
            """,
            (limit,),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()
    updated = 0
    for row in rows:
        employee_guid, restaurant_guid = _extract_metadata_from_raw(row.get("RAW_PAYLOAD"))
        if not employee_guid or not restaurant_guid:
            employee_guid, restaurant_guid = _resolve_metadata_from_charge(row.get("CHARGE_ID"))
        if employee_guid or restaurant_guid:
            _update_metadata_fields(
                "STRIPE_DISPUTE_EVENTS",
                row.get("EVENT_ID"),
                employee_guid,
                restaurant_guid,
            )
            updated += 1
    return updated


def _backfill_transfer_events(limit: int) -> int:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT EVENT_ID, TRANSFER_ID, RAW_PAYLOAD, EMPLOYEEGUID, RESTAURANTGUID
            FROM GRATLYDB.STRIPE_TRANSFER_EVENTS
            WHERE (EMPLOYEEGUID IS NULL OR RESTAURANTGUID IS NULL)
            LIMIT %s
            """,
            (limit,),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()
    updated = 0
    for row in rows:
        employee_guid, restaurant_guid = _extract_metadata_from_raw(row.get("RAW_PAYLOAD"))
        if not employee_guid or not restaurant_guid:
            employee_guid, restaurant_guid = _resolve_metadata_from_transfer(row.get("TRANSFER_ID"))
        if employee_guid or restaurant_guid:
            _update_metadata_fields(
                "STRIPE_TRANSFER_EVENTS",
                row.get("EVENT_ID"),
                employee_guid,
                restaurant_guid,
            )
            updated += 1
    return updated


def _backfill_payout_events(limit: int) -> int:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT EVENT_ID, ACCOUNT_ID, RAW_PAYLOAD, EMPLOYEEGUID, RESTAURANTGUID
            FROM GRATLYDB.STRIPE_PAYOUT_EVENTS
            WHERE (EMPLOYEEGUID IS NULL OR RESTAURANTGUID IS NULL)
            LIMIT %s
            """,
            (limit,),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()
    updated = 0
    for row in rows:
        employee_guid, restaurant_guid = _extract_metadata_from_raw(row.get("RAW_PAYLOAD"))
        if not employee_guid or not restaurant_guid:
            employee_guid, restaurant_guid = _resolve_metadata_from_account(row.get("ACCOUNT_ID"))
        if employee_guid or restaurant_guid:
            _update_metadata_fields(
                "STRIPE_PAYOUT_EVENTS",
                row.get("EVENT_ID"),
                employee_guid,
                restaurant_guid,
            )
            updated += 1
    return updated


def _backfill_restaurant_guid_by_employee(table: str, limit: int) -> int:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            f"""
            SELECT t.EVENT_ID, t.EMPLOYEEGUID
            FROM GRATLYDB.{table} t
            WHERE (t.RESTAURANTGUID IS NULL OR t.RESTAURANTGUID = '')
              AND t.EMPLOYEEGUID IS NOT NULL
            LIMIT %s
            """,
            (limit,),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()

    updated = 0
    for row in rows:
        employee_guid = row.get("EMPLOYEEGUID")
        if not employee_guid:
            continue
        cursor = _get_cursor(dictionary=False)
        try:
            cursor.execute(
                """
                UPDATE GRATLYDB.{table} t
                JOIN GRATLYDB.SRC_EMPLOYEES se
                  ON se.EMPLOYEEGUID = t.EMPLOYEEGUID
                SET t.RESTAURANTGUID = se.RESTAURANTGUID
                WHERE t.EVENT_ID = %s
                """.format(table=table),
                (row.get("EVENT_ID"),),
            )
            cursor.connection.commit()
            updated += cursor.rowcount
        finally:
            cursor.close()
    return updated


def _backfill_restaurant_guid_by_restaurant_id(table: str, limit: int) -> int:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            f"""
            SELECT t.RESTAURANTID
            FROM GRATLYDB.{table} t
            WHERE (t.RESTAURANTGUID IS NULL OR t.RESTAURANTGUID = '')
              AND t.RESTAURANTID IS NOT NULL
            LIMIT %s
            """,
            (limit,),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()

    updated = 0
    for row in rows:
        restaurant_id = row.get("RESTAURANTID")
        if restaurant_id is None:
            continue
        cursor = _get_cursor(dictionary=False)
        try:
            cursor.execute(
                """
                UPDATE GRATLYDB.{table} t
                JOIN GRATLYDB.SRC_ONBOARDING so
                  ON so.RESTAURANTID = t.RESTAURANTID
                SET t.RESTAURANTGUID = so.RESTAURANTGUID
                WHERE t.RESTAURANTID = %s
                """.format(table=table),
                (restaurant_id,),
            )
            cursor.connection.commit()
            updated += cursor.rowcount
        finally:
            cursor.close()
    return updated


def _backfill_restaurant_guid_connected_accounts(limit: int) -> int:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT EMPLOYEEGUID
            FROM GRATLYDB.STRIPE_CONNECTED_ACCOUNTS
            WHERE (RESTAURANTGUID IS NULL OR RESTAURANTGUID = '')
              AND EMPLOYEEGUID IS NOT NULL
            LIMIT %s
            """,
            (limit,),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()

    updated = 0
    for row in rows:
        employee_guid = row.get("EMPLOYEEGUID")
        if not employee_guid:
            continue
        cursor = _get_cursor(dictionary=False)
        try:
            cursor.execute(
                """
                UPDATE GRATLYDB.STRIPE_CONNECTED_ACCOUNTS sca
                JOIN GRATLYDB.SRC_EMPLOYEES se
                  ON se.EMPLOYEEGUID = sca.EMPLOYEEGUID
                SET sca.RESTAURANTGUID = se.RESTAURANTGUID
                WHERE sca.EMPLOYEEGUID = %s
                """,
                (employee_guid,),
            )
            cursor.connection.commit()
            updated += cursor.rowcount
        finally:
            cursor.close()
    return updated


def _backfill_restaurant_guid_settlement_transfers(limit: int) -> int:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT SETTLEMENT_ID, EMPLOYEEGUID
            FROM GRATLYDB.STRIPE_SETTLEMENT_TRANSFERS
            WHERE (RESTAURANTGUID IS NULL OR RESTAURANTGUID = '')
              AND EMPLOYEEGUID IS NOT NULL
            LIMIT %s
            """,
            (limit,),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()

    updated = 0
    for row in rows:
        settlement_id = row.get("SETTLEMENT_ID")
        employee_guid = row.get("EMPLOYEEGUID")
        if not settlement_id or not employee_guid:
            continue
        cursor = _get_cursor(dictionary=False)
        try:
            cursor.execute(
                """
                UPDATE GRATLYDB.STRIPE_SETTLEMENT_TRANSFERS st
                JOIN GRATLYDB.SRC_EMPLOYEES se
                  ON se.EMPLOYEEGUID = st.EMPLOYEEGUID
                SET st.RESTAURANTGUID = se.RESTAURANTGUID
                WHERE st.SETTLEMENT_ID = %s AND st.EMPLOYEEGUID = %s
                """,
                (settlement_id, employee_guid),
            )
            cursor.connection.commit()
            updated += cursor.rowcount
        finally:
            cursor.close()
    return updated

def _fetch_employee_guid_for_account(account_id: str) -> Optional[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT EMPLOYEEGUID AS employee_guid
            FROM GRATLYDB.STRIPE_CONNECTED_ACCOUNTS
            WHERE STRIPE_ACCOUNT_ID = %s
            LIMIT 1
            """,
            (account_id,),
        )
        row = cursor.fetchone()
        return row["employee_guid"] if row else None
    finally:
        cursor.close()


def _upsert_connected_account_status(
    account_id: str,
    employee_guid: Optional[str],
    charges_enabled: bool,
    payouts_enabled: bool,
    details_submitted: bool,
    disabled_reason: Optional[str],
    account_deauthorized: bool,
) -> None:
    resolved_employee_guid = _fetch_employee_guid_for_account(account_id)
    if not resolved_employee_guid and employee_guid:
        _store_connected_account_id(employee_guid, account_id)
        resolved_employee_guid = employee_guid
    if not resolved_employee_guid:
        logger.warning("Stripe account %s not linked to an employee", account_id)
        return

    _update_connected_account_status(
        stripe_account_id=account_id,
        charges_enabled=charges_enabled,
        payouts_enabled=payouts_enabled,
        details_submitted=details_submitted,
        disabled_reason=disabled_reason,
        account_deauthorized=account_deauthorized,
        employee_guid=resolved_employee_guid,
    )


def _handle_account_event(event: Dict[str, Any], deauthorized: bool = False) -> None:
    account = event.get("data", {}).get("object", {}) or {}
    account_id = account.get("id") or event.get("account")
    if not account_id:
        logger.warning("Stripe account event missing account id")
        return

    metadata = account.get("metadata") or {}
    employee_guid = None
    if isinstance(metadata, dict):
        employee_guid = metadata.get("employee_guid") or metadata.get("employeeGuid")

    charges_enabled = bool(account.get("charges_enabled")) and not deauthorized
    payouts_enabled = bool(account.get("payouts_enabled")) and not deauthorized
    details_submitted = bool(account.get("details_submitted")) and not deauthorized
    disabled_reason = account.get("disabled_reason")
    if deauthorized:
        disabled_reason = "deauthorized"

    _upsert_connected_account_status(
        account_id=account_id,
        employee_guid=employee_guid,
        charges_enabled=charges_enabled,
        payouts_enabled=payouts_enabled,
        details_submitted=details_submitted,
        disabled_reason=disabled_reason,
        account_deauthorized=deauthorized,
    )

    logger.info("Stripe account status updated for %s", account_id)


def _dispatch_event(event: Dict[str, Any]) -> None:
    event_type = event.get("type")
    if event_type == "payment_intent.succeeded":
        _handle_payment_intent_succeeded(event)
        return
    if event_type == "payment_intent.payment_failed":
        _handle_payment_intent_failed(event)
        return
    if event_type == "payment_intent.processing":
        _handle_payment_intent_processing(event)
        return
    if event_type == "payment_intent.requires_action":
        _handle_payment_intent_requires_action(event)
        return
    if event_type == "charge.dispute.created":
        _handle_charge_dispute_event(event)
        return
    if event_type == "charge.dispute.closed":
        _handle_charge_dispute_event(event)
        return
    if event_type == "account.created":
        _handle_account_event(event)
        return
    if event_type == "account.updated":
        _handle_account_event(event)
        return
    if event_type == "account.application.deauthorized":
        _handle_account_event(event, deauthorized=True)
        return
    if event_type == "balance.available":
        _handle_balance_available(event)
        return
    logger.info("Stripe event received: %s", event_type)


def _dispatch_connect_event(event: Dict[str, Any]) -> None:
    event_type = event.get("type")
    if event_type == "payout.paid":
        _handle_payout_event(event)
        return
    if event_type == "payout.failed":
        _handle_payout_event(event)
        return
    if event_type == "payout.canceled":
        _handle_payout_event(event)
        return
    if event_type == "transfer.created":
        _handle_transfer_event(event)
        return
    if event_type == "transfer.reversed":
        _handle_transfer_event(event)
        return
    logger.info("Stripe connect event received: %s", event_type)


def _fetch_connected_account_id(employee_guid: str) -> Optional[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT STRIPE_ACCOUNT_ID AS stripe_account_id
            FROM GRATLYDB.STRIPE_CONNECTED_ACCOUNTS
            WHERE EMPLOYEEGUID = %s
            LIMIT 1
            """,
            (employee_guid,),
        )
        row = cursor.fetchone()
        return row["stripe_account_id"] if row else None
    finally:
        cursor.close()


def _store_connected_account_id(employee_guid: str, stripe_account_id: str) -> None:
    cursor = _get_cursor(dictionary=False)
    try:
        cursor.execute(
            """
            SELECT RESTAURANTGUID AS restaurant_guid
            FROM GRATLYDB.SRC_EMPLOYEES
            WHERE EMPLOYEEGUID = %s
            LIMIT 1
            """,
            (employee_guid,),
        )
        row = cursor.fetchone()
        restaurant_guid = row[0] if row else None
        cursor.execute(
            """
            INSERT INTO GRATLYDB.STRIPE_CONNECTED_ACCOUNTS (RESTAURANTGUID, EMPLOYEEGUID, STRIPE_ACCOUNT_ID)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE
                STRIPE_ACCOUNT_ID = VALUES(STRIPE_ACCOUNT_ID),
                RESTAURANTGUID = COALESCE(VALUES(RESTAURANTGUID), RESTAURANTGUID)
            """,
            (restaurant_guid, employee_guid, stripe_account_id),
        )
        cursor.connection.commit()
    finally:
        cursor.close()


def _assert_employee_exists(employee_guid: str) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT EMPLOYEEGUID
            FROM GRATLYDB.SRC_EMPLOYEES
            WHERE EMPLOYEEGUID = %s
            LIMIT 1
            """,
            (employee_guid,),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Employee not found")
    finally:
        cursor.close()


@router.post("/employees/{employee_guid}/stripe-connected-account")
def create_or_fetch_connected_account(employee_guid: str):
    stripe, StripeError = _get_stripe_module()

    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY")
    if not stripe_secret_key:
        raise HTTPException(status_code=500, detail="Stripe secret key not configured")

    _assert_employee_exists(employee_guid)

    stripe.api_key = stripe_secret_key
    existing_account_id = _fetch_connected_account_id(employee_guid)

    try:
        if existing_account_id:
            account = stripe.Account.retrieve(existing_account_id)
            return {
                "accountId": existing_account_id,
                "created": False,
                "chargesEnabled": bool(account.get("charges_enabled")),
                "payoutsEnabled": bool(account.get("payouts_enabled")),
                "detailsSubmitted": bool(account.get("details_submitted")),
            }

        account = stripe.Account.create(
            type="express",
            metadata={"employee_guid": employee_guid},
            capabilities={
                "card_payments": {"requested": True},
                "transfers": {"requested": True},
            },
        )
        _store_connected_account_id(employee_guid, account["id"])
        return {
            "accountId": account["id"],
            "created": True,
            "chargesEnabled": bool(account.get("charges_enabled")),
            "payoutsEnabled": bool(account.get("payouts_enabled")),
            "detailsSubmitted": bool(account.get("details_submitted")),
        }
    except StripeError as exc:
        logger.exception("Stripe connected account error for %s", employee_guid)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/employees/{employee_guid}/stripe-connected-account")
def get_connected_account(employee_guid: str):
    _assert_employee_exists(employee_guid)
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                STRIPE_ACCOUNT_ID AS account_id,
                CHARGES_ENABLED AS charges_enabled,
                PAYOUTS_ENABLED AS payouts_enabled,
                DETAILS_SUBMITTED AS details_submitted,
                DISABLED_REASON AS disabled_reason,
                ACCOUNT_DEAUTHORIZED AS account_deauthorized
            FROM GRATLYDB.STRIPE_CONNECTED_ACCOUNTS
            WHERE EMPLOYEEGUID = %s
            LIMIT 1
            """,
            (employee_guid,),
        )
        row = cursor.fetchone()
    finally:
        cursor.close()
    if not row or not row.get("account_id"):
        return {"accountId": None}
    return {
        "accountId": row.get("account_id"),
        "chargesEnabled": bool(row.get("charges_enabled")),
        "payoutsEnabled": bool(row.get("payouts_enabled")),
        "detailsSubmitted": bool(row.get("details_submitted")),
        "disabledReason": row.get("disabled_reason"),
        "accountDeauthorized": bool(row.get("account_deauthorized")),
    }


@router.post("/employees/{employee_guid}/stripe-onboarding-link")
def create_onboarding_link(employee_guid: str):
    stripe, StripeError = _get_stripe_module()

    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY")
    if not stripe_secret_key:
        raise HTTPException(status_code=500, detail="Stripe secret key not configured")

    refresh_url = os.getenv("STRIPE_CONNECT_REFRESH_URL")
    return_url = os.getenv("STRIPE_CONNECT_RETURN_URL") or "http://localhost:5173/business/100/home"
    if not refresh_url or not return_url:
        raise HTTPException(
            status_code=500,
            detail="Stripe connect URLs not configured",
        )

    _assert_employee_exists(employee_guid)

    stripe.api_key = stripe_secret_key
    account_id = _fetch_connected_account_id(employee_guid)
    if not account_id:
        raise HTTPException(status_code=404, detail="Stripe connected account not found")

    try:
        account_link = stripe.AccountLink.create(
            account=account_id,
            refresh_url=refresh_url,
            return_url=return_url,
            type="account_onboarding",
        )
        return {"url": account_link.get("url"), "expiresAt": account_link.get("expires_at")}
    except StripeError as exc:
        logger.exception("Stripe onboarding link error for %s", employee_guid)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/payments/create-intent")
def create_payment_intent(payload: PaymentIntentPayload):
    stripe, StripeError = _get_stripe_module()

    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY")
    if not stripe_secret_key:
        raise HTTPException(status_code=500, detail="Stripe secret key not configured")

    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")
    if not payload.currency:
        raise HTTPException(status_code=400, detail="Currency is required")

    _assert_employee_exists(payload.employeeGuid)

    stripe.api_key = stripe_secret_key
    try:
        intent = stripe.PaymentIntent.create(
            amount=payload.amount,
            currency=payload.currency.lower(),
            description=payload.description,
            metadata={
                "employee_guid": payload.employeeGuid,
                "restaurant_guid": payload.restaurantGuid,
            },
        )
        return {
            "id": intent.get("id"),
            "clientSecret": intent.get("client_secret"),
            "status": intent.get("status"),
        }
    except StripeError as exc:
        logger.exception("Stripe payment intent error for %s", payload.employeeGuid)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _create_restaurant_debit_for_settlement(
    settlement_id: str,
    restaurant_id: int,
    restaurant_guid: Optional[str] = None,
    business_date: Optional[str] = None,
) -> Dict[str, Any]:
    stripe, StripeError = _get_stripe_module()

    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY")
    if not stripe_secret_key:
        raise HTTPException(status_code=500, detail="Stripe secret key not configured")

    rows = _fetch_payout_final_rows(settlement_id, restaurant_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Settlement not found")

    total_cents = 0
    for row in rows:
        total_cents += _to_cents(row.get("net_payout"))

    if total_cents <= 0:
        raise HTTPException(status_code=400, detail="Settlement amount must be greater than 0")

    settings = _fetch_restaurant_settings(restaurant_id)
    if not settings or not settings.get("stripe_customer_id") or not settings.get(
        "us_bank_payment_method_id"
    ):
        raise HTTPException(status_code=400, detail="Restaurant Stripe payment method not configured")

    resolved_business_date = business_date or _fetch_settlement_business_date(settlement_id, restaurant_id)

    stripe.api_key = stripe_secret_key
    try:
        intent = stripe.PaymentIntent.create(
            amount=total_cents,
            currency="usd",
            customer=settings.get("stripe_customer_id"),
            payment_method=settings.get("us_bank_payment_method_id"),
            payment_method_types=["us_bank_account"],
            off_session=True,
            confirm=True,
            metadata={
                "settlement_id": settlement_id,
                "restaurant_id": str(restaurant_id),
                "restaurant_guid": restaurant_guid,
                "business_date": resolved_business_date,
            },
            idempotency_key=f"settlement_{settlement_id}",
        )
        return {
            "id": intent.get("id"),
            "clientSecret": intent.get("client_secret"),
            "status": intent.get("status"),
            "amount": intent.get("amount"),
        }
    except StripeError as exc:
        logger.exception("Stripe restaurant debit error for %s", settlement_id)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/payments/restaurant-debit")
def create_restaurant_debit(payload: RestaurantDebitPayload):
    if not payload.settlementId:
        raise HTTPException(status_code=400, detail="settlementId is required")

    restaurant_id = payload.restaurantId
    if not restaurant_id and payload.restaurantGuid:
        restaurant_id = _fetch_restaurant_id_by_guid(payload.restaurantGuid)

    if not restaurant_id:
        raise HTTPException(status_code=400, detail="restaurantId or restaurantGuid is required")

    return _create_restaurant_debit_for_settlement(
        settlement_id=payload.settlementId,
        restaurant_id=int(restaurant_id),
        restaurant_guid=payload.restaurantGuid,
        business_date=payload.businessDate,
    )


@router.post("/stripe/restaurants/{restaurant_id}/setup-intent")
def create_restaurant_setup_intent(restaurant_id: int):
    stripe, StripeError = _get_stripe_module()

    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY")
    if not stripe_secret_key:
        raise HTTPException(status_code=500, detail="Stripe secret key not configured")

    stripe.api_key = stripe_secret_key
    settings = _fetch_restaurant_settings(restaurant_id) or {}
    customer_id = settings.get("stripe_customer_id")

    try:
        if not customer_id:
            customer = stripe.Customer.create(
                description=f"Restaurant {restaurant_id}",
                metadata={"restaurant_id": str(restaurant_id)},
            )
            customer_id = customer.get("id")
            _upsert_restaurant_settings(restaurant_id, stripe_customer_id=customer_id)

        setup_intent = stripe.SetupIntent.create(
            customer=customer_id,
            payment_method_types=["us_bank_account"],
        )
        return {
            "clientSecret": setup_intent.get("client_secret"),
            "customerId": customer_id,
        }
    except StripeError as exc:
        logger.exception("Stripe setup intent error for restaurant %s", restaurant_id)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/stripe/restaurants/{restaurant_id}/payment-method")
def save_restaurant_payment_method(restaurant_id: int, payload: RestaurantPaymentMethodPayload):
    if not payload.paymentMethodId:
        raise HTTPException(status_code=400, detail="paymentMethodId is required")
    stripe, StripeError = _get_stripe_module()
    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY")
    if not stripe_secret_key:
        raise HTTPException(status_code=500, detail="Stripe secret key not configured")
    stripe.api_key = stripe_secret_key

    bank_last4 = None
    bank_name = None
    try:
        payment_method = stripe.PaymentMethod.retrieve(payload.paymentMethodId)
        us_bank_account = payment_method.get("us_bank_account") if payment_method else None
        if isinstance(us_bank_account, dict):
            bank_last4 = us_bank_account.get("last4")
            bank_name = us_bank_account.get("bank_name")
    except StripeError as exc:
        logger.exception("Stripe payment method lookup failed for restaurant %s", restaurant_id)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    _upsert_restaurant_settings(
        restaurant_id,
        us_bank_payment_method_id=payload.paymentMethodId,
        bank_last4=bank_last4,
        bank_name=bank_name,
    )
    return {"saved": True}


@router.get("/stripe/restaurants/{restaurant_id}/payment-method")
def get_restaurant_payment_method(restaurant_id: int):
    settings = _fetch_restaurant_settings(restaurant_id)
    if not settings or not settings.get("us_bank_payment_method_id"):
        return {"configured": False}
    return {
        "configured": True,
        "customerId": settings.get("stripe_customer_id"),
        "paymentMethodId": settings.get("us_bank_payment_method_id"),
        "bankLast4": settings.get("bank_last4"),
        "bankName": settings.get("bank_name"),
    }


@router.post("/admin/stripe/backfill-metadata")
def backfill_stripe_metadata(payload: StripeBackfillPayload, request: Request):
    _require_admin_token(request)
    limit = max(1, min(payload.limit, 500))
    return {
        "disputesUpdated": _backfill_dispute_events(limit),
        "transfersUpdated": _backfill_transfer_events(limit),
        "payoutsUpdated": _backfill_payout_events(limit),
        "limit": limit,
    }


@router.get("/admin/stripe/carry-forward")
def get_carry_forward(
    request: Request,
    restaurant_id: Optional[int] = None,
    employee_guid: Optional[str] = None,
):
    _require_admin_token(request)
    cursor = _get_cursor(dictionary=True)
    try:
        query = """
            SELECT EMPLOYEEGUID AS employeeGuid,
                   RESTAURANTID AS restaurantId,
                   CARRY_FORWARD_CENTS AS carryForwardCents,
                   UPDATED_AT AS updatedAt
            FROM GRATLYDB.STRIPE_EMPLOYEE_CARRY_FORWARD
            WHERE 1=1
        """
        params: List[object] = []
        if restaurant_id is not None:
            query += " AND RESTAURANTID = %s"
            params.append(restaurant_id)
        if employee_guid is not None:
            query += " AND EMPLOYEEGUID = %s"
            params.append(employee_guid)
        query += " ORDER BY UPDATED_AT DESC"
        cursor.execute(query, tuple(params))
        return cursor.fetchall()
    finally:
        cursor.close()


@router.post("/admin/stripe/refresh-account")
def refresh_stripe_account(payload: StripeRefreshAccountPayload, request: Request):
    _require_admin_token(request)
    stripe, StripeError = _get_stripe_module()

    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY")
    if not stripe_secret_key:
        raise HTTPException(status_code=500, detail="Stripe secret key not configured")

    stripe_account_id = payload.stripeAccountId
    if not stripe_account_id and payload.employeeGuid:
        account = _fetch_connected_account(payload.employeeGuid)
        stripe_account_id = account.get("stripe_account_id") if account else None

    if not stripe_account_id:
        raise HTTPException(status_code=400, detail="stripeAccountId or employeeGuid is required")

    stripe.api_key = stripe_secret_key
    try:
        account = stripe.Account.retrieve(stripe_account_id)
    except StripeError as exc:
        logger.exception("Stripe account refresh failed for %s", stripe_account_id)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    charges_enabled = bool(account.get("charges_enabled"))
    payouts_enabled = bool(account.get("payouts_enabled"))
    details_submitted = bool(account.get("details_submitted"))
    disabled_reason = account.get("disabled_reason")

    _update_connected_account_status(
        stripe_account_id=stripe_account_id,
        charges_enabled=charges_enabled,
        payouts_enabled=payouts_enabled,
        details_submitted=details_submitted,
        disabled_reason=disabled_reason,
        account_deauthorized=False,
        employee_guid=payload.employeeGuid,
    )

    return {
        "accountId": stripe_account_id,
        "chargesEnabled": charges_enabled,
        "payoutsEnabled": payouts_enabled,
        "detailsSubmitted": details_submitted,
        "disabledReason": disabled_reason,
    }


@router.post("/admin/stripe/refresh-accounts")
def refresh_stripe_accounts(payload: StripeBulkRefreshPayload, request: Request):
    _require_admin_token(request)
    stripe, StripeError = _get_stripe_module()

    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY")
    if not stripe_secret_key:
        raise HTTPException(status_code=500, detail="Stripe secret key not configured")

    limit = max(1, min(payload.limit, 200))
    stripe.api_key = stripe_secret_key

    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT EMPLOYEEGUID AS employee_guid, STRIPE_ACCOUNT_ID AS stripe_account_id
            FROM GRATLYDB.STRIPE_CONNECTED_ACCOUNTS
            WHERE STRIPE_ACCOUNT_ID IS NOT NULL
              AND PAYOUTS_ENABLED = 0
            ORDER BY UPDATEDAT DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cursor.fetchall()
    finally:
        cursor.close()

    updated = 0
    failed = 0
    for row in rows:
        account_id = row.get("stripe_account_id")
        employee_guid = row.get("employee_guid")
        if not account_id:
            continue
        try:
            account = stripe.Account.retrieve(account_id)
            _update_connected_account_status(
                stripe_account_id=account_id,
                charges_enabled=bool(account.get("charges_enabled")),
                payouts_enabled=bool(account.get("payouts_enabled")),
                details_submitted=bool(account.get("details_submitted")),
                disabled_reason=account.get("disabled_reason"),
                account_deauthorized=False,
                employee_guid=employee_guid,
            )
            updated += 1
        except StripeError:
            failed += 1
            logger.exception("Stripe account refresh failed for %s", account_id)

    return {"updated": updated, "failed": failed, "limit": limit}


@router.post("/admin/stripe/backfill-restaurant-guid")
def backfill_restaurant_guid(payload: StripeRestaurantGuidBackfillPayload, request: Request):
    _require_admin_token(request)
    limit = max(1, min(payload.limit, 1000))

    results = {
        "stripe_connected_accounts": _backfill_restaurant_guid_connected_accounts(limit),
        "stripe_payment_events": _backfill_restaurant_guid_by_employee(
            "STRIPE_PAYMENT_EVENTS",
            limit,
        ),
        "stripe_dispute_events": _backfill_restaurant_guid_by_employee(
            "STRIPE_DISPUTE_EVENTS",
            limit,
        ),
        "stripe_transfer_events": _backfill_restaurant_guid_by_employee(
            "STRIPE_TRANSFER_EVENTS",
            limit,
        ),
        "stripe_payout_events": _backfill_restaurant_guid_by_employee(
            "STRIPE_PAYOUT_EVENTS",
            limit,
        ),
        "stripe_employee_carry_forward": _backfill_restaurant_guid_by_restaurant_id(
            "STRIPE_EMPLOYEE_CARRY_FORWARD",
            limit,
        ),
        "stripe_settlement_transfers": _backfill_restaurant_guid_settlement_transfers(limit),
        "stripe_restaurant_settings": _backfill_restaurant_guid_by_restaurant_id(
            "STRIPE_RESTAURANT_SETTINGS",
            limit,
        ),
    }
    return {"limit": limit, "updated": results}


@router.post("/admin/stripe/settlement-transfers")
def retry_settlement_transfers(payload: SettlementTransferPayload, request: Request):
    _require_admin_token(request)
    if not payload.settlementId:
        raise HTTPException(status_code=400, detail="settlementId is required")
    restaurant_id = payload.restaurantId
    if not restaurant_id and payload.restaurantGuid:
        restaurant_id = _fetch_restaurant_id_by_guid(payload.restaurantGuid)
    if not restaurant_id:
        raise HTTPException(status_code=400, detail="restaurantId or restaurantGuid is required")
    payment_intent_stub = {
        "metadata": {
            "settlement_id": payload.settlementId,
            "restaurant_id": str(restaurant_id),
            "restaurant_guid": payload.restaurantGuid,
            "business_date": payload.businessDate,
        }
    }
    return _create_transfers_for_settlement(payment_intent_stub)


@router.post("/webhooks/stripe")
async def handle_stripe_webhook(request: Request):
    payload = await request.body()
    signature_header = request.headers.get("stripe-signature")
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")

    if not webhook_secret:
        raise HTTPException(status_code=500, detail="Stripe webhook secret not configured")
    if not signature_header:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")
    if not _verify_signature(payload, signature_header, webhook_secret):
        raise HTTPException(status_code=400, detail="Invalid Stripe signature")

    try:
        event = json.loads(payload.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    try:
        _dispatch_event(event)
    except Exception:
        logger.exception("Stripe webhook handler failed for event %s", event.get("type"))
        raise

    return {"received": True, "type": event.get("type")}


@router.post("/webhooks/stripe/connect")
async def handle_stripe_connect_webhook(request: Request):
    payload = await request.body()
    signature_header = request.headers.get("stripe-signature")
    webhook_secret = os.getenv("STRIPE_CONNECT_WEBHOOK_SECRET") or os.getenv("STRIPE_WEBHOOK_SECRET")

    if not webhook_secret:
        raise HTTPException(status_code=500, detail="Stripe connect webhook secret not configured")
    if not signature_header:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")
    if not _verify_signature(payload, signature_header, webhook_secret):
        raise HTTPException(status_code=400, detail="Invalid Stripe signature")

    try:
        event = json.loads(payload.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    try:
        _dispatch_connect_event(event)
    except Exception:
        logger.exception("Stripe connect webhook handler failed for event %s", event.get("type"))
        raise

    return {"received": True, "type": event.get("type")}
