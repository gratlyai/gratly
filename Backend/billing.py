from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

try:
    from Backend.auth import CurrentBusiness, CurrentUser, get_current_business, require_admin
    from Backend.db import _get_cursor, _fetch_restaurant_name
    from Backend.moov_service import create_onboarding_link, ensure_moov_account, list_payment_methods
except ImportError:
    from auth import CurrentBusiness, CurrentUser, get_current_business, require_admin
    from db import _get_cursor, _fetch_restaurant_name
    from moov_service import create_onboarding_link, ensure_moov_account, list_payment_methods

router = APIRouter()


class BillingSummary(BaseModel):
    billingDate: Optional[str] = None
    billingDayOfMonth: Optional[int] = None
    billingAmountCents: Optional[int] = None
    billingCurrency: Optional[str] = None
    paymentMethod: Optional[Dict[str, Any]] = None
    latestInvoice: Optional[Dict[str, Any]] = None


class InvoiceRecord(BaseModel):
    id: int
    billingPeriod: str
    amountCents: int
    currency: str
    status: str
    dueDate: Optional[str] = None
    paidAt: Optional[str] = None
    invoiceId: Optional[str] = None
    createdAt: Optional[str] = None


class InvoiceListResponse(BaseModel):
    invoices: List[InvoiceRecord]


class PaymentMethodLinkPayload(BaseModel):
    returnUrl: str
    refreshUrl: Optional[str] = None


def _parse_amount_to_cents(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    try:
        normalized = float(value)
    except (TypeError, ValueError):
        return None
    return int(round(normalized * 100))


def _fetch_billing_config(business_id: int) -> Dict[str, Any]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT BILLING_DATE AS billing_date,
                   BILLING_AMOUNT AS billing_amount
            FROM GRATLYDB.SRC_ONBOARDING
            WHERE RESTAURANTID = %s
            LIMIT 1
            """,
            (business_id,),
        )
        row = cursor.fetchone() or {}
        billing_date = row.get("billing_date")
        billing_amount = row.get("billing_amount")
        return {
            "billing_date": billing_date,
            "billing_amount": billing_amount,
        }
    finally:
        cursor.close()


def _fetch_latest_invoice(business_id: int) -> Optional[Dict[str, Any]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                ID AS id,
                BILLING_PERIOD AS billing_period,
                AMOUNT_CENTS AS amount_cents,
                CURRENCY AS currency,
                COALESCE(PAYMENT_STATUS, MOOV_INVOICE_STATUS, 'unknown') AS status,
                DUE_DATE AS due_date,
                PAID_AT AS paid_at,
                MOOV_INVOICE_ID AS invoice_id,
                CREATED_AT AS created_at
            FROM GRATLYDB.MONTHLY_FEE_CHARGES
            WHERE RESTAURANTID = %s
            ORDER BY CREATED_AT DESC
            LIMIT 1
            """,
            (business_id,),
        )
        return cursor.fetchone()
    finally:
        cursor.close()


def _serialize_invoice(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "billingPeriod": row.get("billing_period"),
        "amountCents": row.get("amount_cents"),
        "currency": row.get("currency") or "USD",
        "status": row.get("status"),
        "dueDate": row.get("due_date").isoformat() if row.get("due_date") else None,
        "paidAt": row.get("paid_at").isoformat() if row.get("paid_at") else None,
        "invoiceId": row.get("invoice_id"),
        "createdAt": row.get("created_at").isoformat() if row.get("created_at") else None,
    }


@router.get("/api/billing/summary", response_model=BillingSummary)
def get_billing_summary(
    current_business: CurrentBusiness = Depends(get_current_business),
    _: CurrentUser = Depends(require_admin),
):
    config = _fetch_billing_config(current_business.business_id)
    billing_date = config.get("billing_date")
    billing_day = None
    if billing_date:
        try:
            billing_day = int(billing_date.day)
        except Exception:
            billing_day = None
    billing_amount_cents = _parse_amount_to_cents(config.get("billing_amount"))

    payment_method = None
    methods = list_payment_methods("restaurant", current_business.business_id)
    if methods:
        method = methods[0]
        payment_method = {
            "methodType": method.get("method_type"),
            "brand": method.get("brand"),
            "last4": method.get("last4"),
            "isPreferred": bool(method.get("is_preferred")),
        }

    latest_invoice = _fetch_latest_invoice(current_business.business_id)
    return {
        "billingDate": billing_date.isoformat() if billing_date else None,
        "billingDayOfMonth": billing_day,
        "billingAmountCents": billing_amount_cents,
        "billingCurrency": "USD",
        "paymentMethod": payment_method,
        "latestInvoice": _serialize_invoice(latest_invoice) if latest_invoice else None,
    }


@router.get("/api/billing/invoices", response_model=InvoiceListResponse)
def list_invoices(
    current_business: CurrentBusiness = Depends(get_current_business),
    _: CurrentUser = Depends(require_admin),
):
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                ID AS id,
                BILLING_PERIOD AS billing_period,
                AMOUNT_CENTS AS amount_cents,
                CURRENCY AS currency,
                COALESCE(PAYMENT_STATUS, MOOV_INVOICE_STATUS, 'unknown') AS status,
                DUE_DATE AS due_date,
                PAID_AT AS paid_at,
                MOOV_INVOICE_ID AS invoice_id,
                CREATED_AT AS created_at
            FROM GRATLYDB.MONTHLY_FEE_CHARGES
            WHERE RESTAURANTID = %s
            ORDER BY CREATED_AT DESC
            """,
            (current_business.business_id,),
        )
        rows = cursor.fetchall() or []
        return {"invoices": [_serialize_invoice(row) for row in rows]}
    finally:
        cursor.close()


@router.post("/api/billing/payment-method-link")
def create_payment_method_link(
    payload: PaymentMethodLinkPayload,
    current_business: CurrentBusiness = Depends(get_current_business),
    _: CurrentUser = Depends(require_admin),
):
    moov_account_id = ensure_moov_account(
        "restaurant",
        current_business.business_id,
        {
            "type": "business",
            "profile": {"name": _fetch_restaurant_name(current_business.business_id) or "Restaurant"},
        },
    )
    url = create_onboarding_link(moov_account_id, payload.returnUrl, payload.refreshUrl)
    return {"url": url}
