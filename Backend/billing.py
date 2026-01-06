from datetime import datetime, timezone
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

try:
    from Backend.auth import CurrentBusiness, CurrentUser, get_current_business, require_admin
    from Backend.db import _get_cursor
    from Backend.stripe_billing import (
        construct_event,
        create_billing_portal_session,
        create_checkout_session,
        create_customer,
    list_invoices,
    list_subscriptions,
    list_payment_methods,
    list_customer_sources,
    retrieve_customer,
    retrieve_payment_method,
    retrieve_subscription,
)
except ImportError:
    from auth import CurrentBusiness, CurrentUser, get_current_business, require_admin
    from db import _get_cursor
    from stripe_billing import (
        construct_event,
        create_billing_portal_session,
        create_checkout_session,
        create_customer,
        list_invoices,
        list_subscriptions,
        retrieve_subscription,
    )

router = APIRouter()


class CheckoutRequest(BaseModel):
    planKey: Optional[str] = Field(default=None, min_length=1)


def _get_app_url() -> str:
    return (os.getenv("APP_URL") or "http://localhost:5173").rstrip("/")


def _get_price_id() -> str:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT CONFIG_VALUE AS config_value
            FROM GRATLYDB.BILLING_CONFIG
            WHERE CONFIG_KEY = 'stripe_price_id'
            LIMIT 1
            """
        )
        row = cursor.fetchone()
        price_id = row["config_value"] if row else None
    finally:
        cursor.close()
    price_id = price_id or os.getenv("STRIPE_PRICE_ID")
    if not price_id:
        raise HTTPException(status_code=500, detail="STRIPE_PRICE_ID not configured")
    return price_id

def _utc_from_unix(value: Optional[int]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc).replace(tzinfo=None)


def _serialize_dt(value: Optional[datetime]) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _fetch_stripe_customer_id(business_id: int) -> Optional[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT STRIPE_CUSTOMER_ID AS stripe_customer_id
            FROM GRATLYDB.STRIPE_CUSTOMERS
            WHERE BUSINESS_ID = %s
            LIMIT 1
            """,
            (business_id,),
        )
        row = cursor.fetchone()
        return row["stripe_customer_id"] if row else None
    finally:
        cursor.close()


def _store_stripe_customer_id(business_id: int, stripe_customer_id: str) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO GRATLYDB.STRIPE_CUSTOMERS (
                BUSINESS_ID,
                STRIPE_CUSTOMER_ID,
                CREATED_AT
            )
            VALUES (%s, %s, NOW())
            ON DUPLICATE KEY UPDATE STRIPE_CUSTOMER_ID = VALUES(STRIPE_CUSTOMER_ID)
            """,
            (business_id, stripe_customer_id),
        )
    finally:
        cursor.close()


def _get_or_create_customer(business_id: int) -> str:
    existing = _fetch_stripe_customer_id(business_id)
    if existing:
        return existing
    customer = create_customer(
        None,
        metadata={"business_id": str(business_id)},
    )
    _store_stripe_customer_id(business_id, customer.id)
    return customer.id


def _fetch_price_id_for_plan(business_id: int, plan_key: str) -> Optional[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT PRICE_ID AS price_id
            FROM GRATLYDB.PLAN_PRICES
            WHERE BUSINESS_ID = %s AND PLAN_KEY = %s
            LIMIT 1
            """,
            (business_id, plan_key),
        )
        row = cursor.fetchone()
        return row["price_id"] if row else None
    finally:
        cursor.close()


def _fetch_plan_key_for_price(business_id: int, price_id: str) -> Optional[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT PLAN_KEY AS plan_key
            FROM GRATLYDB.PLAN_PRICES
            WHERE BUSINESS_ID = %s AND PRICE_ID = %s
            LIMIT 1
            """,
            (business_id, price_id),
        )
        row = cursor.fetchone()
        return row["plan_key"] if row else None
    finally:
        cursor.close()


def _upsert_subscription_record(
    business_id: int,
    stripe_subscription_id: str,
    status: str,
    price_id: str,
    current_period_start: Optional[datetime],
    current_period_end: Optional[datetime],
    cancel_at_period_end: bool,
    trial_end: Optional[datetime],
    default_payment_method_brand: Optional[str],
    default_payment_method_last4: Optional[str],
) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO GRATLYDB.BILLING_SUBSCRIPTIONS (
                BUSINESS_ID,
                STRIPE_SUBSCRIPTION_ID,
                STATUS,
                PRICE_ID,
                CURRENT_PERIOD_START,
                CURRENT_PERIOD_END,
                CANCEL_AT_PERIOD_END,
                TRIAL_END,
                DEFAULT_PAYMENT_METHOD_BRAND,
                DEFAULT_PAYMENT_METHOD_LAST4,
                CREATED_AT,
                UPDATED_AT
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                STATUS = VALUES(STATUS),
                PRICE_ID = VALUES(PRICE_ID),
                CURRENT_PERIOD_START = VALUES(CURRENT_PERIOD_START),
                CURRENT_PERIOD_END = VALUES(CURRENT_PERIOD_END),
                CANCEL_AT_PERIOD_END = VALUES(CANCEL_AT_PERIOD_END),
                TRIAL_END = VALUES(TRIAL_END),
                DEFAULT_PAYMENT_METHOD_BRAND = VALUES(DEFAULT_PAYMENT_METHOD_BRAND),
                DEFAULT_PAYMENT_METHOD_LAST4 = VALUES(DEFAULT_PAYMENT_METHOD_LAST4),
                UPDATED_AT = NOW()
            """,
            (
                business_id,
                stripe_subscription_id,
                status,
                price_id,
                current_period_start,
                current_period_end,
                1 if cancel_at_period_end else 0,
                trial_end,
                default_payment_method_brand,
                default_payment_method_last4,
            ),
        )
    finally:
        cursor.close()


def _upsert_invoice_record(business_id: int, invoice: Dict[str, Any]) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO GRATLYDB.INVOICE_RECORDS (
                BUSINESS_ID,
                STRIPE_INVOICE_ID,
                NUMBER,
                STATUS,
                AMOUNT_DUE,
                AMOUNT_PAID,
                CURRENCY,
                HOSTED_INVOICE_URL,
                INVOICE_PDF,
                CREATED_AT
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                NUMBER = VALUES(NUMBER),
                STATUS = VALUES(STATUS),
                AMOUNT_DUE = VALUES(AMOUNT_DUE),
                AMOUNT_PAID = VALUES(AMOUNT_PAID),
                CURRENCY = VALUES(CURRENCY),
                HOSTED_INVOICE_URL = VALUES(HOSTED_INVOICE_URL),
                INVOICE_PDF = VALUES(INVOICE_PDF)
            """,
            (
                business_id,
                invoice.get("id"),
                invoice.get("number"),
                invoice.get("status") or "unknown",
                int(invoice.get("amount_due") or 0),
                int(invoice.get("amount_paid") or 0),
                (invoice.get("currency") or "").lower(),
                invoice.get("hosted_invoice_url"),
                invoice.get("invoice_pdf"),
                _utc_from_unix(invoice.get("created")),
            ),
        )
    finally:
        cursor.close()


def _select_subscription_summary(business_id: int) -> Optional[Dict[str, Any]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                STRIPE_SUBSCRIPTION_ID AS stripe_subscription_id,
                STATUS AS status,
                PRICE_ID AS price_id,
                CURRENT_PERIOD_START AS current_period_start,
                CURRENT_PERIOD_END AS current_period_end,
                CANCEL_AT_PERIOD_END AS cancel_at_period_end,
                TRIAL_END AS trial_end,
                DEFAULT_PAYMENT_METHOD_BRAND AS default_payment_method_brand,
                DEFAULT_PAYMENT_METHOD_LAST4 AS default_payment_method_last4
            FROM GRATLYDB.BILLING_SUBSCRIPTIONS
            WHERE BUSINESS_ID = %s
            LIMIT 1
            """,
            (business_id,),
        )
        return cursor.fetchone()
    finally:
        cursor.close()


def _extract_price_id(subscription: Dict[str, Any]) -> Optional[str]:
    items = subscription.get("items", {}).get("data", [])
    if not items:
        return None
    price = items[0].get("price")
    if isinstance(price, dict):
        return price.get("id")
    return price


def _extract_payment_method(subscription: Dict[str, Any]) -> Dict[str, Optional[str]]:
    payment_method = subscription.get("default_payment_method")
    return _extract_payment_method_from_obj(payment_method)

def _extract_payment_method_from_obj(payment_method: Any) -> Dict[str, Optional[str]]:
    if isinstance(payment_method, dict):
        card = payment_method.get("card") or {}
        if card:
            return {
                "brand": card.get("brand"),
                "last4": card.get("last4"),
            }
        bank_account = payment_method.get("us_bank_account") or {}
        if bank_account:
            return {
                "brand": bank_account.get("bank_name") or "bank",
                "last4": bank_account.get("last4"),
            }
        if payment_method.get("type") == "link":
            return {"brand": "link", "last4": None}
    return {"brand": None, "last4": None}


def _extract_payment_method_from_customer(customer: Dict[str, Any]) -> Dict[str, Optional[str]]:
    invoice_settings = customer.get("invoice_settings") or {}
    payment_method = invoice_settings.get("default_payment_method")
    extracted = _extract_payment_method_from_obj(payment_method)
    if extracted.get("brand") and extracted.get("last4"):
        return extracted
    default_source = customer.get("default_source")
    return _extract_payment_method_from_obj(default_source)


def _find_payment_method_for_customer(customer_id: str) -> Dict[str, Optional[str]]:
    methods = list_payment_methods(None, customer_id=customer_id, payment_type="card", limit=5)
    if not methods or not methods.data:
        methods = list_payment_methods(None, customer_id=customer_id, payment_type="us_bank_account", limit=5)
        if not methods or not methods.data:
            sources = list_customer_sources(None, customer_id=customer_id, source_type="card", limit=5)
            if sources and sources.data:
                return _extract_payment_method_from_obj(sources.data[0])
            return {"brand": None, "last4": None}
    return _extract_payment_method_from_obj(methods.data[0])


def _sync_subscription_from_stripe(
    business_id: int,
    subscription_id: str,
) -> None:
    subscription = retrieve_subscription(
        None,
        subscription_id,
        expand=["default_payment_method", "items.data.price", "latest_invoice.payment_intent.payment_method"],
    )
    price_id = _extract_price_id(subscription)
    if not price_id:
        raise HTTPException(status_code=400, detail="Subscription missing price")
    payment_method = _extract_payment_method(subscription)
    if not payment_method.get("brand") or not payment_method.get("last4"):
        latest_invoice = subscription.get("latest_invoice") or {}
        payment_intent = latest_invoice.get("payment_intent") or {}
        pm_from_intent = payment_intent.get("payment_method")
        payment_method = _extract_payment_method_from_obj(pm_from_intent)
        if not payment_method.get("brand") or not payment_method.get("last4"):
            if isinstance(pm_from_intent, str) and pm_from_intent:
                try:
                    retrieved_pm = retrieve_payment_method(None, pm_from_intent)
                    payment_method = _extract_payment_method_from_obj(retrieved_pm)
                except Exception:
                    pass
    if not payment_method.get("brand") or not payment_method.get("last4"):
        customer_id = subscription.get("customer")
        if customer_id:
            customer = retrieve_customer(
                None,
                customer_id,
                expand=["invoice_settings.default_payment_method", "default_source"],
            )
            fallback = _extract_payment_method_from_customer(customer)
            if fallback.get("brand") and fallback.get("last4"):
                payment_method = fallback
            else:
                payment_method = _find_payment_method_for_customer(customer_id)
    _upsert_subscription_record(
        business_id=business_id,
        stripe_subscription_id=subscription.id,
        status=subscription.status or "unknown",
        price_id=price_id,
        current_period_start=_utc_from_unix(subscription.get("current_period_start")),
        current_period_end=_utc_from_unix(subscription.get("current_period_end")),
        cancel_at_period_end=bool(subscription.get("cancel_at_period_end")),
        trial_end=_utc_from_unix(subscription.get("trial_end")),
        default_payment_method_brand=payment_method.get("brand"),
        default_payment_method_last4=payment_method.get("last4"),
    )


def _find_latest_subscription(customer_id: str) -> Optional[Dict[str, Any]]:
    subscriptions = list_subscriptions(None, customer_id=customer_id, status="all", limit=10)
    if not subscriptions or not subscriptions.data:
        return None
    for candidate in subscriptions.data:
        if candidate.status in ("active", "trialing"):
            return candidate
    return subscriptions.data[0]


def _lookup_business_by_customer_id(stripe_customer_id: str) -> Optional[int]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT RESTAURANTID AS business_id
            FROM GRATLYDB.STRIPE_CUSTOMERS
            WHERE STRIPE_CUSTOMER_ID = %s
            LIMIT 1
            """,
            (stripe_customer_id,),
        )
        row = cursor.fetchone()
        return row["business_id"] if row else None
    finally:
        cursor.close()


@router.post("/api/billing/checkout")
def create_checkout(
    payload: CheckoutRequest,
    current_user: CurrentUser = Depends(require_admin),
    current_business: CurrentBusiness = Depends(get_current_business),
):
    price_id = _get_price_id()
    stripe_customer_id = _get_or_create_customer(current_business.business_id)
    app_url = _get_app_url()
    return_base = f"{app_url}/business/{current_business.business_id}/billing"
    session = create_checkout_session(
        None,
        customer_id=stripe_customer_id,
        price_id=price_id,
        success_url=f"{return_base}?checkout=success",
        cancel_url=f"{return_base}?checkout=cancel",
        metadata={
            "business_id": str(current_business.business_id),
            "initiated_by": str(current_user.user_id),
        },
    )
    return {"url": session.url}


@router.post("/api/billing/portal")
def create_portal(
    current_user: CurrentUser = Depends(require_admin),
    current_business: CurrentBusiness = Depends(get_current_business),
):
    stripe_customer_id = _get_or_create_customer(current_business.business_id)
    app_url = _get_app_url()
    return_url = f"{app_url}/business/{current_business.business_id}/billing"
    portal = create_billing_portal_session(
        None,
        customer_id=stripe_customer_id,
        return_url=return_url,
    )
    return {"url": portal.url}


@router.get("/api/billing/summary")
def get_billing_summary(
    current_user: CurrentUser = Depends(require_admin),
    current_business: CurrentBusiness = Depends(get_current_business),
):
    summary = _select_subscription_summary(current_business.business_id)
    if not summary:
        stripe_customer_id = _fetch_stripe_customer_id(current_business.business_id)
        if stripe_customer_id:
            subscription = _find_latest_subscription(stripe_customer_id)
            if subscription:
                _sync_subscription_from_stripe(
                    current_business.business_id,
                    subscription.id,
                )
                summary = _select_subscription_summary(current_business.business_id)
    if not summary:
        return {"subscription": None, "paymentMethod": None}
    if not summary.get("default_payment_method_brand") or not summary.get("default_payment_method_last4"):
        stripe_customer_id = _fetch_stripe_customer_id(current_business.business_id)
        if stripe_customer_id:
            subscription = _find_latest_subscription(stripe_customer_id)
            if subscription:
                _sync_subscription_from_stripe(current_business.business_id, subscription.id)
                summary = _select_subscription_summary(current_business.business_id) or summary
            else:
                method = _find_payment_method_for_customer(stripe_customer_id)
                if method.get("brand") and method.get("last4"):
                    _upsert_subscription_record(
                        business_id=current_business.business_id,
                        stripe_subscription_id=summary["stripe_subscription_id"],
                        status=summary["status"],
                        price_id=summary["price_id"],
                        current_period_start=summary["current_period_start"],
                        current_period_end=summary["current_period_end"],
                        cancel_at_period_end=bool(summary["cancel_at_period_end"]),
                        trial_end=summary["trial_end"],
                        default_payment_method_brand=method["brand"],
                        default_payment_method_last4=method["last4"],
                    )
                    summary = _select_subscription_summary(current_business.business_id) or summary

    plan_key = _fetch_plan_key_for_price(current_business.business_id, summary["price_id"])
    return {
        "subscription": {
            "status": summary["status"],
            "planKey": plan_key,
            "priceId": summary["price_id"],
            "currentPeriodStart": _serialize_dt(summary["current_period_start"]),
            "currentPeriodEnd": _serialize_dt(summary["current_period_end"]),
            "cancelAtPeriodEnd": bool(summary["cancel_at_period_end"]),
            "trialEnd": _serialize_dt(summary["trial_end"]),
        },
        "paymentMethod": {
            "brand": summary["default_payment_method_brand"],
            "last4": summary["default_payment_method_last4"],
        },
    }


@router.get("/api/billing/invoices")
def list_billing_invoices(
    limit: int = 10,
    starting_after: Optional[str] = None,
    current_user: CurrentUser = Depends(require_admin),
    current_business: CurrentBusiness = Depends(get_current_business),
):
    stripe_customer_id = _fetch_stripe_customer_id(current_business.business_id)
    if not stripe_customer_id:
        return {"invoices": [], "hasMore": False, "nextStartingAfter": None}
    invoices = list_invoices(
        None,
        customer_id=stripe_customer_id,
        limit=limit,
        starting_after=starting_after,
    )
    invoice_items: List[Dict[str, Any]] = []
    for invoice in invoices.data:
        invoice_items.append(
            {
                "id": invoice.id,
                "number": invoice.number,
                "status": invoice.status,
                "amountDue": invoice.amount_due,
                "amountPaid": invoice.amount_paid,
                "currency": invoice.currency,
                "hostedInvoiceUrl": invoice.hosted_invoice_url,
                "invoicePdf": invoice.invoice_pdf,
                "created": _serialize_dt(_utc_from_unix(invoice.created)),
            }
        )
    next_starting_after = invoice_items[-1]["id"] if invoice_items else None
    return {"invoices": invoice_items, "hasMore": invoices.has_more, "nextStartingAfter": next_starting_after}


@router.post("/api/billing/sync")
def sync_billing_payment_method(
    current_user: CurrentUser = Depends(require_admin),
    current_business: CurrentBusiness = Depends(get_current_business),
):
    summary = _select_subscription_summary(current_business.business_id)
    stripe_customer_id = _fetch_stripe_customer_id(current_business.business_id)
    if not stripe_customer_id:
        raise HTTPException(status_code=404, detail="Stripe customer not found")
    customer = retrieve_customer(
        None,
        stripe_customer_id,
        expand=["invoice_settings.default_payment_method", "default_source"],
    )
    method = _extract_payment_method_from_customer(customer)
    if not method.get("brand") or not method.get("last4"):
        method = _find_payment_method_for_customer(stripe_customer_id)
    if summary and method.get("brand") and method.get("last4"):
        _upsert_subscription_record(
            business_id=current_business.business_id,
            stripe_subscription_id=summary["stripe_subscription_id"],
            status=summary["status"],
            price_id=summary["price_id"],
            current_period_start=summary["current_period_start"],
            current_period_end=summary["current_period_end"],
            cancel_at_period_end=bool(summary["cancel_at_period_end"]),
            trial_end=summary["trial_end"],
            default_payment_method_brand=method["brand"],
            default_payment_method_last4=method["last4"],
        )
    return {
        "customerId": stripe_customer_id,
        "customerDefaults": {
            "invoiceSettingsDefaultPaymentMethod": customer.get("invoice_settings", {}).get("default_payment_method"),
            "defaultSource": customer.get("default_source"),
        },
        "paymentMethod": method,
    }

@router.post("/api/webhooks/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("Stripe-Signature")
    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")
    secret = os.getenv("STRIPE_WEBHOOK_SECRET") or ""
    if not secret:
        raise HTTPException(status_code=500, detail="STRIPE_WEBHOOK_SECRET not configured")
    try:
        event = construct_event(payload, sig_header, secret)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Webhook signature verification failed: {exc}")

    event_type = event.get("type")
    data_object = (event.get("data") or {}).get("object") or {}
    stripe_customer_id = data_object.get("customer")
    business_id = None
    if stripe_customer_id:
        business_id = _lookup_business_by_customer_id(stripe_customer_id)
        if business_id:
            _store_stripe_customer_id(business_id, stripe_customer_id)
    if not business_id:
        metadata = data_object.get("metadata") or {}
        raw_business_id = metadata.get("business_id")
        if raw_business_id:
            try:
                business_id = int(raw_business_id)
            except (TypeError, ValueError):
                business_id = None
    if not business_id:
        return {"status": "ignored"}

    if event_type == "checkout.session.completed":
        subscription_id = data_object.get("subscription")
        if subscription_id:
            _sync_subscription_from_stripe(business_id, subscription_id)
    elif event_type in (
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        subscription_id = data_object.get("id")
        if subscription_id:
            _sync_subscription_from_stripe(business_id, subscription_id)
    elif event_type in ("invoice.finalized", "invoice.payment_succeeded", "invoice.payment_failed"):
        _upsert_invoice_record(business_id, data_object)

    return {"status": "ok"}
