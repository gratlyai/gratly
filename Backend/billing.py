from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
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


class BillingConfig(BaseModel):
    billingDate: Optional[int] = None
    billingAmount: Optional[int] = None
    paidStatus: Optional[str] = None
    moovAccountId: Optional[str] = None
    onboardingStatus: Optional[str] = None


class PaymentMethod(BaseModel):
    id: str
    moovPaymentMethodId: str
    methodType: str
    brand: Optional[str] = None
    last4: Optional[str] = None
    status: str
    isPreferred: bool
    isVerified: bool


class MonthlyInvoice(BaseModel):
    id: int
    billingPeriod: str
    amountCents: int
    currency: str
    moovInvoiceId: Optional[str] = None
    moovInvoiceStatus: Optional[str] = None
    paymentStatus: Optional[str] = None
    dueDate: Optional[str] = None
    paidAt: Optional[str] = None
    failureReason: Optional[str] = None
    createdAt: str


class BillingSummary(BaseModel):
    config: BillingConfig
    paymentMethods: List[PaymentMethod]
    upcomingInvoice: Optional[Dict[str, Any]] = None
    recentInvoices: List[MonthlyInvoice]


class InvoiceListResponse(BaseModel):
    invoices: List[MonthlyInvoice]


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


def _fetch_billing_config(restaurant_id: int) -> BillingConfig:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT BILLING_DATE AS billing_date,
                   BILLING_AMOUNT AS billing_amount,
                   PAID_STATUS AS paid_status
            FROM GRATLYDB.SRC_ONBOARDING
            WHERE RESTAURANTID = %s
            LIMIT 1
            """,
            (restaurant_id,),
        )
        row = cursor.fetchone() or {}
        billing_date_str = row.get("billing_date")
        billing_day = None
        if billing_date_str:
            try:
                billing_day = int(billing_date_str)
            except (TypeError, ValueError):
                pass

        billing_amount = row.get("billing_amount")
        billing_amount_cents = _parse_amount_to_cents(billing_amount)

        # Fetch Moov account info
        moov_account_id = None
        onboarding_status = None
        cursor.execute(
            """
            SELECT MOOV_ACCOUNT_ID AS moov_account_id,
                   ONBOARDING_STATUS AS onboarding_status
            FROM GRATLYDB.MOOV_ACCOUNTS
            WHERE ENTITY_ID = %s AND ENTITY_TYPE = 'restaurant'
            LIMIT 1
            """,
            (restaurant_id,),
        )
        moov_row = cursor.fetchone()
        if moov_row:
            moov_account_id = moov_row.get("moov_account_id")
            onboarding_status = moov_row.get("onboarding_status")

        return BillingConfig(
            billingDate=billing_day,
            billingAmount=billing_amount_cents,
            paidStatus=row.get("paid_status"),
            moovAccountId=moov_account_id,
            onboardingStatus=onboarding_status,
        )
    finally:
        cursor.close()


def _fetch_invoices(restaurant_id: int, limit: int = 10) -> List[Dict[str, Any]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                ID AS id,
                BILLING_PERIOD AS billing_period,
                AMOUNT_CENTS AS amount_cents,
                CURRENCY AS currency,
                COALESCE(PAYMENT_STATUS, MOOV_INVOICE_STATUS, 'unknown') AS payment_status,
                MOOV_INVOICE_STATUS AS moov_invoice_status,
                DUE_DATE AS due_date,
                PAID_AT AS paid_at,
                MOOV_INVOICE_ID AS moov_invoice_id,
                FAILURE_REASON AS failure_reason,
                CREATED_AT AS created_at
            FROM GRATLYDB.MONTHLY_FEE_CHARGES
            WHERE RESTAURANTID = %s
            ORDER BY CREATED_AT DESC
            LIMIT %s
            """,
            (restaurant_id, limit),
        )
        return cursor.fetchall() or []
    finally:
        cursor.close()


def _serialize_invoice(row: Dict[str, Any]) -> MonthlyInvoice:
    created_at = row.get("created_at")
    created_at_str = created_at.isoformat() if created_at else ""

    return MonthlyInvoice(
        id=row.get("id"),
        billingPeriod=row.get("billing_period"),
        amountCents=row.get("amount_cents"),
        currency=row.get("currency") or "USD",
        moovInvoiceId=row.get("moov_invoice_id"),
        moovInvoiceStatus=row.get("moov_invoice_status"),
        paymentStatus=row.get("payment_status"),
        dueDate=row.get("due_date").isoformat() if row.get("due_date") else None,
        paidAt=row.get("paid_at").isoformat() if row.get("paid_at") else None,
        failureReason=row.get("failure_reason"),
        createdAt=created_at_str,
    )


@router.get("/api/billing/summary", response_model=BillingSummary)
def get_billing_summary(restaurant_id: int = Query(...)):
    # Fetch billing configuration
    config = _fetch_billing_config(restaurant_id)

    # Fetch payment methods from Moov
    payment_methods = []
    try:
        moov_methods = list_payment_methods("restaurant", restaurant_id)
        for method in moov_methods:
            payment_methods.append(
                PaymentMethod(
                    id=method.get("id", ""),
                    moovPaymentMethodId=method.get("moov_payment_method_id", method.get("id", "")),
                    methodType=method.get("method_type", ""),
                    brand=method.get("brand"),
                    last4=method.get("last4"),
                    status=method.get("status", ""),
                    isPreferred=bool(method.get("is_preferred", False)),
                    isVerified=bool(method.get("is_verified", False)),
                )
            )
    except Exception:
        # If Moov integration fails, return empty methods
        pass

    # Fetch recent invoices
    invoice_rows = _fetch_invoices(restaurant_id, limit=10)
    recent_invoices = [_serialize_invoice(row) for row in invoice_rows]

    # Upcoming invoice is the next due invoice (if any unpaid)
    upcoming_invoice = None
    for invoice in recent_invoices:
        if invoice.paymentStatus not in ("paid", "completed"):
            upcoming_invoice = {
                "dueDate": invoice.dueDate,
                "amountCents": invoice.amountCents,
            }
            break

    return BillingSummary(
        config=config,
        paymentMethods=payment_methods,
        upcomingInvoice=upcoming_invoice,
        recentInvoices=recent_invoices,
    )


@router.get("/api/billing/config")
def get_billing_config(restaurant_id: int = Query(...)):
    config = _fetch_billing_config(restaurant_id)
    return config


@router.get("/api/billing/invoices", response_model=InvoiceListResponse)
def list_invoices(restaurant_id: int = Query(...), limit: int = Query(10)):
    invoice_rows = _fetch_invoices(restaurant_id, limit=limit)
    invoices = [_serialize_invoice(row) for row in invoice_rows]
    return InvoiceListResponse(invoices=invoices)


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
