import os
from typing import Any, Dict, Iterable, Optional

import stripe
from fastapi import HTTPException
from dotenv import load_dotenv

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")


def _get_required_env(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise HTTPException(status_code=500, detail=f"{key} not configured")
    return value


def _stripe_opts(stripe_account_id: Optional[str]) -> Dict[str, str]:
    if not stripe_account_id:
        return {}
    return {"stripe_account": stripe_account_id}


def ensure_api_key() -> None:
    _get_required_env("STRIPE_SECRET_KEY")


def create_customer(
    stripe_account_id: Optional[str],
    metadata: Optional[Dict[str, Any]] = None,
) -> stripe.Customer:
    ensure_api_key()
    payload: Dict[str, Any] = {}
    if metadata:
        payload["metadata"] = metadata
    return stripe.Customer.create(**payload, **_stripe_opts(stripe_account_id))


def create_checkout_session(
    stripe_account_id: Optional[str],
    *,
    customer_id: str,
    price_id: str,
    success_url: str,
    cancel_url: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> stripe.checkout.Session:
    ensure_api_key()
    payload: Dict[str, Any] = {
        "mode": "subscription",
        "customer": customer_id,
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "subscription_data": {
            "payment_settings": {"save_default_payment_method": "on_subscription"},
        },
    }
    if metadata:
        payload["metadata"] = metadata
    return stripe.checkout.Session.create(**payload, **_stripe_opts(stripe_account_id))


def create_billing_portal_session(
    stripe_account_id: Optional[str],
    *,
    customer_id: str,
    return_url: str,
) -> stripe.billing_portal.Session:
    ensure_api_key()
    payload = {"customer": customer_id, "return_url": return_url}
    return stripe.billing_portal.Session.create(**payload, **_stripe_opts(stripe_account_id))


def list_subscriptions(
    stripe_account_id: Optional[str],
    *,
    customer_id: str,
    status: str = "all",
    limit: int = 10,
) -> stripe.ListObject:
    ensure_api_key()
    return stripe.Subscription.list(
        customer=customer_id,
        status=status,
        limit=limit,
        **_stripe_opts(stripe_account_id),
    )


def retrieve_subscription(
    stripe_account_id: Optional[str],
    subscription_id: str,
    expand: Optional[Iterable[str]] = None,
) -> stripe.Subscription:
    ensure_api_key()
    payload: Dict[str, Any] = {}
    if expand:
        payload["expand"] = list(expand)
    return stripe.Subscription.retrieve(subscription_id, **payload, **_stripe_opts(stripe_account_id))


def retrieve_customer(
    stripe_account_id: Optional[str],
    customer_id: str,
    expand: Optional[Iterable[str]] = None,
) -> stripe.Customer:
    ensure_api_key()
    payload: Dict[str, Any] = {}
    if expand:
        payload["expand"] = list(expand)
    return stripe.Customer.retrieve(customer_id, **payload, **_stripe_opts(stripe_account_id))


def retrieve_payment_method(
    stripe_account_id: Optional[str],
    payment_method_id: str,
) -> stripe.PaymentMethod:
    ensure_api_key()
    return stripe.PaymentMethod.retrieve(payment_method_id, **_stripe_opts(stripe_account_id))


def list_payment_methods(
    stripe_account_id: Optional[str],
    *,
    customer_id: str,
    payment_type: str = "card",
    limit: int = 10,
) -> stripe.ListObject:
    ensure_api_key()
    return stripe.PaymentMethod.list(
        customer=customer_id,
        type=payment_type,
        limit=limit,
        **_stripe_opts(stripe_account_id),
    )


def list_customer_sources(
    stripe_account_id: Optional[str],
    *,
    customer_id: str,
    source_type: str = "card",
    limit: int = 10,
) -> stripe.ListObject:
    ensure_api_key()
    return stripe.Customer.list_sources(
        customer_id,
        object=source_type,
        limit=limit,
        **_stripe_opts(stripe_account_id),
    )


def list_invoices(
    stripe_account_id: Optional[str],
    *,
    customer_id: str,
    limit: int = 10,
    starting_after: Optional[str] = None,
) -> stripe.ListObject:
    ensure_api_key()
    payload: Dict[str, Any] = {"customer": customer_id, "limit": limit}
    if starting_after:
        payload["starting_after"] = starting_after
    return stripe.Invoice.list(**payload, **_stripe_opts(stripe_account_id))


def construct_event(payload: bytes, sig_header: str, secret: str) -> stripe.Event:
    ensure_api_key()
    return stripe.Webhook.construct_event(payload, sig_header, secret)
