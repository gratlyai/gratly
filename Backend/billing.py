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
    import logging
    logger = logging.getLogger(__name__)

    cursor = _get_cursor(dictionary=True)
    try:
        # Try to fetch billing info from SRC_ONBOARDING with graceful fallback
        billing_day = None
        billing_amount_cents = None

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
                logger.info(f"No SRC_ONBOARDING record found for restaurant {restaurant_id}")
                # Record doesn't exist, return empty config
                return BillingConfig(
                    billingDate=None,
                    billingAmount=None,
                    paidStatus=None,
                    moovAccountId=None,
                    onboardingStatus=None,
                )
        except Exception as e:
            logger.warning(f"Failed to query SRC_ONBOARDING for restaurant {restaurant_id}: {e}")
            # Table might not exist or have different schema, continue gracefully

        # Fetch Moov account info (graceful fallback if query fails)
        moov_account_id = None
        onboarding_status = None
        try:
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
                logger.info(f"Found Moov account {moov_account_id} for restaurant {restaurant_id}")
        except Exception as e:
            # Log error but don't fail the entire endpoint
            logger.warning(f"Failed to fetch Moov account info for restaurant {restaurant_id}: {e}")

        return BillingConfig(
            billingDate=billing_day,
            billingAmount=billing_amount_cents,
            paidStatus=None,
            moovAccountId=moov_account_id,
            onboardingStatus=onboarding_status,
        )
    except Exception as e:
        logger.error(f"Unexpected error in _fetch_billing_config: {e}", exc_info=True)
        # Return empty config on any unexpected error
        return BillingConfig(
            billingDate=None,
            billingAmount=None,
            paidStatus=None,
            moovAccountId=None,
            onboardingStatus=None,
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
    import logging
    logger = logging.getLogger(__name__)

    try:
        logger.info(f"Fetching billing summary for restaurant {restaurant_id}")

        # Fetch billing configuration
        try:
            config = _fetch_billing_config(restaurant_id)
            logger.info(f"Fetched billing config: {config}")
        except Exception as e:
            logger.error(f"Error fetching billing config: {e}", exc_info=True)
            raise

        # Fetch payment methods from Moov
        payment_methods = []
        try:
            moov_methods = list_payment_methods("restaurant", restaurant_id)
            logger.info(f"Fetched {len(moov_methods)} payment methods from Moov")
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
        except Exception as e:
            logger.warning(f"Failed to fetch payment methods: {e}", exc_info=True)
            # If Moov integration fails, return empty methods
            pass

        # Fetch recent invoices
        try:
            invoice_rows = _fetch_invoices(restaurant_id, limit=10)
            recent_invoices = [_serialize_invoice(row) for row in invoice_rows]
            logger.info(f"Fetched {len(recent_invoices)} invoices")
        except Exception as e:
            logger.error(f"Error fetching invoices: {e}", exc_info=True)
            recent_invoices = []

        # Upcoming invoice is the next due invoice (if any unpaid)
        upcoming_invoice = None
        for invoice in recent_invoices:
            if invoice.paymentStatus not in ("paid", "completed"):
                upcoming_invoice = {
                    "dueDate": invoice.dueDate,
                    "amountCents": invoice.amountCents,
                }
                break

        result = BillingSummary(
            config=config,
            paymentMethods=payment_methods,
            upcomingInvoice=upcoming_invoice,
            recentInvoices=recent_invoices,
        )
        logger.info(f"Successfully built billing summary response")
        return result

    except Exception as e:
        logger.error(f"Unhandled error in get_billing_summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch billing summary: {str(e)}")


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
