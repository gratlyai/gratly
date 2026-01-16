from __future__ import annotations

from datetime import datetime, timedelta, date
from typing import Any, Dict, List, Optional, Tuple
import logging

from fastapi import HTTPException
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

try:
    from Backend.db import _get_cursor, _fetch_restaurant_timezone
    from Backend.email_utils import send_sendgrid_email
    from Backend.idempotency import run_idempotent
    from Backend.moov_service import (
        collect_invoice,
        create_invoice,
        create_transfer,
        select_billing_payment_method,
        select_employee_payout_method,
        select_restaurant_debit_method,
        verify_account_capabilities,
        _fetch_moov_account,
        _get_platform_account_id,
    )
except ImportError:
    from db import _get_cursor, _fetch_restaurant_timezone
    from email_utils import send_sendgrid_email
    from idempotency import run_idempotent
    from moov_service import (
        collect_invoice,
        create_invoice,
        create_transfer,
        select_billing_payment_method,
        select_employee_payout_method,
        select_restaurant_debit_method,
        verify_account_capabilities,
        _fetch_moov_account,
        _get_platform_account_id,
    )


def _fetch_restaurants() -> List[Dict[str, Any]]:
    import logging
    logger = logging.getLogger(__name__)

    cursor = _get_cursor(dictionary=True)
    try:
        # Try to fetch with all columns first (dev schema)
        try:
            cursor.execute(
                """
                SELECT RESTAURANTID AS restaurant_id,
                       RESTAURANTGUID AS restaurant_guid,
                       BILLING_DATE AS billing_date,
                       BILLING_AMOUNT AS billing_amount,
                       PAYOUT_FEE AS payout_fee,
                       PAYOUT_FEE_PAYER AS payout_fee_payer,
                       PAYOUT_THRESHOLD_CENTS AS payout_threshold_cents,
                       TIMEZONE AS timezone
                FROM GRATLYDB.SRC_ONBOARDING
                """
            )
            return cursor.fetchall() or []
        except Exception as e:
            # Fallback: Only fetch basic columns (production schema)
            logger.warning(f"Failed to fetch restaurants with full schema, using minimal columns: {e}")
            cursor.execute(
                """
                SELECT RESTAURANTID AS restaurant_id,
                       RESTAURANTGUID AS restaurant_guid
                FROM GRATLYDB.SRC_ONBOARDING
                """
            )
            rows = cursor.fetchall() or []
            # Add default values for missing columns
            return [
                {
                    **row,
                    "billing_date": None,
                    "billing_amount": None,
                    "payout_fee": None,
                    "payout_fee_payer": None,
                    "payout_threshold_cents": None,
                    "timezone": None
                }
                for row in rows
            ]
    finally:
        cursor.close()


def _fetch_admin_emails(restaurant_id: int) -> List[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT DISTINCT um.EMAIL AS email
            FROM GRATLYDB.USERRESTAURANT ur
            JOIN GRATLYDB.USER_MASTER um ON ur.USERID = um.USERID
            JOIN GRATLYDB.USER_PERMISSIONS up ON up.USERID = um.USERID
            JOIN GRATLYDB.MSTR_PERMISSIONS mp ON up.PERMISSIONSID = mp.PERMISSIONSID
            WHERE ur.RESTAURANTID = %s
              AND (mp.DELETED IS NULL OR mp.DELETED = 0)
              AND LOWER(mp.PERMISSIONSNAME) = 'admin access'
            """,
            (restaurant_id,),
        )
        return [row["email"] for row in cursor.fetchall() if row.get("email")]
    finally:
        cursor.close()


def _fetch_user_id_for_employee_guid(employee_guid: str) -> Optional[int]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT um.USERID AS user_id
            FROM GRATLYDB.SRC_EMPLOYEES se
            JOIN GRATLYDB.USER_MASTER um ON LOWER(um.EMAIL) = LOWER(se.EMAIL)
            WHERE se.EMPLOYEEGUID = %s
            LIMIT 1
            """,
            (employee_guid,),
        )
        row = cursor.fetchone()
        return row.get("user_id") if row else None
    finally:
        cursor.close()


def _parse_amount_to_cents(value: Optional[str]) -> int:
    if not value:
        return 0
    try:
        return int(round(float(value) * 100))
    except (TypeError, ValueError):
        return 0


def _get_local_date(restaurant_id: int, fallback_tz: Optional[str] = None) -> date:
    tz_name = fallback_tz or _fetch_restaurant_timezone(restaurant_id=restaurant_id)
    try:
        tz = ZoneInfo(tz_name) if tz_name else ZoneInfo("UTC")
    except Exception:
        tz = ZoneInfo("UTC")
    return datetime.now(tz).date()


def _should_bill_today(local_date: date, billing_date_value: Optional[date]) -> bool:
    if not billing_date_value:
        return False
    billing_day = billing_date_value.day
    return local_date.day == billing_day


def _snapshot_billing_charge(
    restaurant_id: int,
    billing_period: str,
    billing_date_value: Optional[date],
    amount_cents: int,
    currency: str,
) -> int:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO GRATLYDB.MONTHLY_FEE_CHARGES (
                RESTAURANTID,
                BILLING_PERIOD,
                BILLING_DATE,
                AMOUNT_CENTS,
                CURRENCY,
                CREATED_AT,
                UPDATED_AT
            )
            VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
            ON DUPLICATE KEY UPDATE ID = LAST_INSERT_ID(ID)
            """,
            (restaurant_id, billing_period, billing_date_value, amount_cents, currency),
        )
        return cursor.lastrowid
    finally:
        cursor.close()


def _update_charge_invoice(charge_id: int, invoice_id: str, status: str, due_date: Optional[str]) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            UPDATE GRATLYDB.MONTHLY_FEE_CHARGES
            SET MOOV_INVOICE_ID = %s,
                MOOV_INVOICE_STATUS = %s,
                DUE_DATE = %s,
                UPDATED_AT = NOW()
            WHERE ID = %s
            """,
            (invoice_id, status, due_date, charge_id),
        )
    finally:
        cursor.close()


def _send_billing_email(charge_id: int, restaurant_id: int, email_type: str, subject: str, body: str) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT 1
            FROM GRATLYDB.BILLING_EMAILS
            WHERE CHARGE_ID = %s AND EMAIL_TYPE = %s
            LIMIT 1
            """,
            (charge_id, email_type),
        )
        if cursor.fetchone():
            return
        for email in _fetch_admin_emails(restaurant_id):
            send_sendgrid_email(to_email=email, subject=subject, content=body)
        cursor.execute(
            """
            INSERT INTO GRATLYDB.BILLING_EMAILS (RESTAURANTID, CHARGE_ID, EMAIL_TYPE, SENT_AT)
            VALUES (%s, %s, %s, NOW())
            """,
            (restaurant_id, charge_id, email_type),
        )
    finally:
        cursor.close()


def monthly_invoice_job() -> Dict[str, Any]:
    logger.info(f"[JOB] monthly_invoice_job started at {datetime.now()}")
    results = {"processed": 0, "skipped": 0}
    for row in _fetch_restaurants():
        restaurant_id = row.get("restaurant_id")
        billing_date_value = row.get("billing_date")
        if not restaurant_id or not billing_date_value:
            results["skipped"] += 1
            continue
        local_date = _get_local_date(restaurant_id, row.get("timezone"))
        if not _should_bill_today(local_date, billing_date_value):
            results["skipped"] += 1
            continue

        billing_period = f"{local_date.year}{local_date.month:02d}"
        amount_cents = _parse_amount_to_cents(row.get("billing_amount"))
        if amount_cents <= 0:
            results["skipped"] += 1
            continue

        def _create_invoice():
            charge_id = _snapshot_billing_charge(
                restaurant_id,
                billing_period,
                billing_date_value,
                amount_cents,
                "USD",
            )
            invoice = create_invoice(
                restaurant_id,
                billing_period,
                amount_cents,
                "USD",
                billing_date_value.isoformat() if billing_date_value else None,
            )
            invoice_id = invoice.get("invoiceID") or invoice.get("id")
            status = invoice.get("status") or "issued"
            due_date = invoice.get("dueDate") or billing_date_value.isoformat()
            _update_charge_invoice(charge_id, invoice_id, status, due_date)
            _send_billing_email(
                charge_id,
                restaurant_id,
                "invoice_issued",
                "Your Gratly invoice is ready",
                f"Invoice {invoice_id} for ${amount_cents / 100:.2f} is issued and due {due_date}.",
            )
            method = select_billing_payment_method(restaurant_id)
            if method:
                try:
                    collect_invoice(invoice_id, method["MOOV_PAYMENT_METHOD_ID"])
                except Exception:
                    pass
            results["processed"] += 1
            return {"charge_id": charge_id, "invoice_id": invoice_id}

        run_idempotent("monthly_invoice", f"{restaurant_id}:{billing_period}", _create_invoice)
    logger.info(f"[JOB] monthly_invoice_job completed at {datetime.now()}: {results}")
    return results


def monthly_invoice_collect_retry_job() -> Dict[str, Any]:
    logger.info(f"[JOB] monthly_invoice_collect_retry_job started at {datetime.now()}")
    cursor = _get_cursor(dictionary=True)
    now = datetime.utcnow()
    processed = 0
    try:
        cursor.execute(
            """
            SELECT ID AS id,
                   RESTAURANTID AS restaurant_id,
                   MOOV_INVOICE_ID AS invoice_id,
                   NEXT_RETRY_AT AS next_retry_at
            FROM GRATLYDB.MONTHLY_FEE_CHARGES
            WHERE MOOV_INVOICE_ID IS NOT NULL
              AND (PAYMENT_STATUS IS NULL OR PAYMENT_STATUS IN ('failed', 'unpaid'))
              AND (NEXT_RETRY_AT IS NULL OR NEXT_RETRY_AT <= %s)
            """,
            (now,),
        )
        for row in cursor.fetchall() or []:
            invoice_id = row.get("invoice_id")
            restaurant_id = row.get("restaurant_id")
            if not invoice_id or not restaurant_id:
                continue
            method = select_billing_payment_method(restaurant_id)
            if not method:
                continue
            try:
                collect_invoice(invoice_id, method["MOOV_PAYMENT_METHOD_ID"])
                processed += 1
            except Exception:
                cursor.execute(
                    """
                    UPDATE GRATLYDB.MONTHLY_FEE_CHARGES
                    SET NEXT_RETRY_AT = %s, UPDATED_AT = NOW()
                    WHERE ID = %s
                    """,
                    (now + timedelta(hours=6), row.get("id")),
                )
        result = {"processed": processed}
        logger.info(f"[JOB] monthly_invoice_collect_retry_job completed at {datetime.now()}: {result}")
        return result
    finally:
        cursor.close()


def nightly_restaurant_debit_job() -> Dict[str, Any]:
    logger.info(f"[JOB] nightly_restaurant_debit_job started at {datetime.now()}")
    results = {"batches_created": 0}
    for row in _fetch_restaurants():
        restaurant_id = row.get("restaurant_id")
        if not restaurant_id:
            continue
        local_date = _get_local_date(restaurant_id, row.get("timezone"))
        business_date = local_date.isoformat()
        cursor = _get_cursor(dictionary=True)
        conn = cursor.connection
        try:
            cursor.execute(
                """
                SELECT PAYOUT_FINALID AS payout_final_id,
                       NET_PAYOUT AS net_payout
                FROM GRATLYDB.PAYOUT_FINAL
                WHERE RESTAURANTID = %s
                  AND BUSINESSDATE = %s
                  AND DEBITED_BATCH_ID IS NULL
                """,
                (restaurant_id, business_date),
            )
            payout_rows = cursor.fetchall() or []
            if not payout_rows:
                continue
            principal_total = sum(int(round(float(row.get("net_payout") or 0) * 100)) for row in payout_rows)
            fee_amount_cents = _parse_amount_to_cents(row.get("payout_fee"))
            fee_payer = (row.get("payout_fee_payer") or "").upper()
            fee_total = 0
            if fee_payer == "RESTAURANT":
                fee_total = len(payout_rows) * fee_amount_cents
            total_debit = principal_total + fee_total
            method = select_restaurant_debit_method(restaurant_id)
            if not method:
                continue

            # Before creating transfer, verify account is ready
            moov_account_id = _fetch_moov_account("restaurant", restaurant_id)
            if not moov_account_id:
                logger.warning(f"Restaurant {restaurant_id} has no Moov account - skipping debit")
                continue

            # Check if account has required capabilities
            is_ready, error = verify_account_capabilities(moov_account_id, ["send-funds"])
            if not is_ready:
                logger.warning(
                    f"Restaurant {restaurant_id} not ready for debit: {error} - will retry next cycle"
                )
                # TODO: Update batch status to indicate pending verification if batch already created
                continue

            def _create_batch():
                cursor.execute(
                    """
                    INSERT INTO GRATLYDB.NIGHTLY_DEBIT_BATCHES (
                        RESTAURANTID,
                        BUSINESS_DATE,
                        STATUS,
                        PRINCIPAL_TOTAL_CENTS,
                        FEE_TOTAL_CENTS,
                        TOTAL_DEBIT_CENTS,
                        CREATED_AT,
                        UPDATED_AT
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
                    ON DUPLICATE KEY UPDATE ID = LAST_INSERT_ID(ID)
                    """,
                    (restaurant_id, business_date, "submitted", principal_total, fee_total, total_debit),
                )
                batch_id = cursor.lastrowid
                cursor.execute(
                    """
                    UPDATE GRATLYDB.PAYOUT_FINAL
                    SET DEBITED_BATCH_ID = %s,
                        DEBIT_STATUS = %s,
                        APPROVED_AT = COALESCE(APPROVED_AT, NOW())
                    WHERE RESTAURANTID = %s
                      AND BUSINESSDATE = %s
                      AND DEBITED_BATCH_ID IS NULL
                    """,
                    (batch_id, "batched", restaurant_id, business_date),
                )
                conn.commit()
                transfer = create_transfer(
                    "nightly_debit",
                    total_debit,
                    "USD",
                    {"paymentMethodID": method["MOOV_PAYMENT_METHOD_ID"]},
                    {"accountID": _get_platform_account_id()},
                    f"Nightly debit {business_date}",
                    {"restaurant_id": str(restaurant_id), "business_date": business_date},
                    f"nightly-debit-{restaurant_id}-{business_date}",
                )
                transfer_id = transfer.get("transferID") or transfer.get("id")
                cursor.execute(
                    """
                    INSERT INTO GRATLYDB.TRANSFERS (
                        TRANSFER_TYPE,
                        MOOV_TRANSFER_ID,
                        STATUS,
                        AMOUNT_CENTS,
                        CURRENCY,
                        SOURCE_ID,
                        DESTINATION_ID,
                        REFERENCE_TYPE,
                        REFERENCE_ID,
                        CREATED_AT,
                        UPDATED_AT
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    """,
                    (
                        "nightly_debit",
                        transfer_id,
                        transfer.get("status") or "submitted",
                        total_debit,
                        "USD",
                        method["MOOV_PAYMENT_METHOD_ID"],
                        _get_platform_account_id(),
                        "nightly_debit_batch",
                        batch_id,
                    ),
                )
                cursor.execute(
                    """
                    UPDATE GRATLYDB.NIGHTLY_DEBIT_BATCHES
                    SET MOOV_TRANSFER_ID = %s,
                        STATUS = %s,
                        UPDATED_AT = NOW()
                    WHERE ID = %s
                    """,
                    (transfer_id, transfer.get("status") or "submitted", batch_id),
                )
                conn.commit()
                results["batches_created"] += 1
                return {"batch_id": batch_id}

            run_idempotent("nightly_debit", f"{restaurant_id}:{business_date}", _create_batch)
        finally:
            cursor.close()
    logger.info(f"[JOB] nightly_restaurant_debit_job completed at {datetime.now()}: {results}")
    return results


def payout_disbursement_job() -> Dict[str, Any]:
    logger.info(f"[JOB] payout_disbursement_job started at {datetime.now()}")
    cursor = _get_cursor(dictionary=True)
    conn = cursor.connection
    processed = 0
    try:
        cursor.execute(
            """
            SELECT pf.PAYOUT_FINALID AS payout_final_id,
                   pf.RESTAURANTID AS restaurant_id,
                   pf.EMPLOYEEGUID AS employee_guid,
                   pf.NET_PAYOUT AS net_payout,
                   pf.BUSINESSDATE AS business_date,
                   nb.STATUS AS batch_status,
                   so.PAYOUT_FEE AS payout_fee,
                   so.PAYOUT_FEE_PAYER AS payout_fee_payer,
                   so.PAYOUT_THRESHOLD_CENTS AS payout_threshold_cents
            FROM GRATLYDB.PAYOUT_FINAL pf
            JOIN GRATLYDB.NIGHTLY_DEBIT_BATCHES nb ON nb.ID = pf.DEBITED_BATCH_ID
            JOIN GRATLYDB.SRC_ONBOARDING so ON so.RESTAURANTID = pf.RESTAURANTID
            WHERE pf.PAYOUT_ITEM_ID IS NULL
              AND pf.DEBITED_BATCH_ID IS NOT NULL
              AND nb.STATUS IN ('completed', 'paid', 'settled')
            """
        )
        rows = cursor.fetchall() or []
        for row in rows:
            payout_final_id = row.get("payout_final_id")
            restaurant_id = row.get("restaurant_id")
            employee_guid = row.get("employee_guid")
            gross_cents = int(round(float(row.get("net_payout") or 0) * 100))
            if gross_cents <= 0:
                continue
            fee_amount_cents = _parse_amount_to_cents(row.get("payout_fee"))
            fee_payer = (row.get("payout_fee_payer") or "RESTAURANT").upper()
            net_cents = gross_cents
            if fee_payer == "EMPLOYEE":
                net_cents = gross_cents - fee_amount_cents
                if net_cents <= 0:
                    cursor.execute(
                        """
                        UPDATE GRATLYDB.PAYOUT_FINAL
                        SET PAYOUT_STATUS = %s, UPDATED_AT = NOW()
                        WHERE PAYOUT_FINALID = %s
                        """,
                        ("insufficient_after_fee", payout_final_id),
                    )
                    continue
            threshold = row.get("payout_threshold_cents") or 5200
            effective_amount = net_cents if fee_payer == "EMPLOYEE" else gross_cents
            rail = "same_day_ach" if effective_amount <= threshold else "instant"
            employee_user_id = _fetch_user_id_for_employee_guid(employee_guid)
            if not employee_user_id:
                continue
            method = select_employee_payout_method(restaurant_id, employee_user_id)
            if not method:
                continue

            # Before creating payout transfer, verify employee account is ready
            employee_moov_account = _fetch_moov_account("employee", employee_user_id)
            if not employee_moov_account:
                logger.warning(f"Employee {employee_user_id} has no Moov account - skipping payout")
                # Mark as no_account so we don't retry indefinitely
                cursor.execute(
                    """
                    UPDATE GRATLYDB.PAYOUT_FINAL
                    SET PAYOUT_STATUS = %s,
                        UPDATED_AT = NOW()
                    WHERE PAYOUT_FINALID = %s
                    """,
                    ("no_account", payout_final_id),
                )
                conn.commit()
                continue

            # Verify employee can receive funds
            is_ready, error = verify_account_capabilities(employee_moov_account, ["receive-funds"])
            if not is_ready:
                logger.warning(
                    f"Employee {employee_user_id} not ready for payout: {error} - will retry next cycle"
                )
                # Mark as pending verification so we can retry when ready
                cursor.execute(
                    """
                    UPDATE GRATLYDB.PAYOUT_FINAL
                    SET PAYOUT_STATUS = %s,
                        FAILURE_REASON = %s,
                        UPDATED_AT = NOW()
                    WHERE PAYOUT_FINALID = %s
                    """,
                    ("pending_verification", error, payout_final_id),
                )
                conn.commit()
                continue

            if rail == "instant":
                if method.get("METHOD_TYPE") not in ("rtp", "rtp_bank", "debit_card"):
                    rail = "same_day_ach"

            def _create_payout():
                cursor.execute(
                    """
                    INSERT INTO GRATLYDB.PAYOUT_ITEMS (
                        RESTAURANTID,
                        EMPLOYEEGUID,
                        PAYOUT_FINAL_ID,
                        GROSS_AMOUNT_CENTS,
                        NET_AMOUNT_CENTS,
                        FEE_AMOUNT_CENTS_SNAPSHOT,
                        FEE_PAYER_SNAPSHOT,
                        RAIL,
                        STATUS,
                        CREATED_AT,
                        UPDATED_AT
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    ON DUPLICATE KEY UPDATE ID = LAST_INSERT_ID(ID)
                    """,
                    (
                        restaurant_id,
                        employee_guid,
                        payout_final_id,
                        gross_cents,
                        net_cents,
                        fee_amount_cents,
                        fee_payer,
                        rail,
                        "submitted",
                    ),
                )
                payout_item_id = cursor.lastrowid
                transfer = create_transfer(
                    "payout",
                    net_cents if fee_payer == "EMPLOYEE" else gross_cents,
                    "USD",
                    {"accountID": _get_platform_account_id()},
                    {"paymentMethodID": method["MOOV_PAYMENT_METHOD_ID"]},
                    f"Payout {row.get('business_date')}",
                    {"restaurant_id": str(restaurant_id), "employee_guid": employee_guid},
                    f"payout-{payout_final_id}",
                )
                transfer_id = transfer.get("transferID") or transfer.get("id")
                cursor.execute(
                    """
                    INSERT INTO GRATLYDB.TRANSFERS (
                        TRANSFER_TYPE,
                        MOOV_TRANSFER_ID,
                        STATUS,
                        AMOUNT_CENTS,
                        CURRENCY,
                        SOURCE_ID,
                        DESTINATION_ID,
                        REFERENCE_TYPE,
                        REFERENCE_ID,
                        CREATED_AT,
                        UPDATED_AT
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    """,
                    (
                        "payout",
                        transfer_id,
                        transfer.get("status") or "submitted",
                        net_cents if fee_payer == "EMPLOYEE" else gross_cents,
                        "USD",
                        _get_platform_account_id(),
                        method["MOOV_PAYMENT_METHOD_ID"],
                        "payout_item",
                        payout_item_id,
                    ),
                )
                cursor.execute(
                    """
                    UPDATE GRATLYDB.PAYOUT_ITEMS
                    SET MOOV_TRANSFER_ID = %s, STATUS = %s, UPDATED_AT = NOW()
                    WHERE ID = %s
                    """,
                    (transfer_id, transfer.get("status") or "submitted", payout_item_id),
                )
                cursor.execute(
                    """
                    UPDATE GRATLYDB.PAYOUT_FINAL
                    SET PAYOUT_ITEM_ID = %s,
                        PAYOUT_STATUS = %s,
                        UPDATED_AT = NOW()
                    WHERE PAYOUT_FINALID = %s
                    """,
                    (payout_item_id, "submitted", payout_final_id),
                )
                conn.commit()
                return {"payout_item_id": payout_item_id}

            run_idempotent("payout_item", f"{payout_final_id}", _create_payout)
            processed += 1
        result = {"processed": processed}
        logger.info(f"[JOB] payout_disbursement_job completed at {datetime.now()}: {result}")
        return result
    finally:
        cursor.close()


def retry_pending_verification_payouts() -> Dict[str, Any]:
    """
    Retry payouts that were blocked due to pending KYC/capability verification.
    Runs every 6 hours to check if accounts have been verified.
    """
    logger.info(f"[JOB] retry_pending_verification_payouts started at {datetime.now()}")
    cursor = _get_cursor(dictionary=True)
    processed = 0

    try:
        # Find payouts stuck in pending_verification
        cursor.execute(
            """
            SELECT PAYOUT_FINALID, EMPLOYEEGUID, RESTAURANTID
            FROM GRATLYDB.PAYOUT_FINAL
            WHERE PAYOUT_STATUS = 'pending_verification'
              AND UPDATED_AT < DATE_SUB(NOW(), INTERVAL 1 HOUR)
            LIMIT 100
            """
        )

        for row in cursor.fetchall() or []:
            payout_final_id = row["PAYOUT_FINALID"]
            employee_guid = row["EMPLOYEEGUID"]

            # Get employee user ID
            employee_user_id = _fetch_user_id_for_employee_guid(employee_guid)
            if not employee_user_id:
                continue

            # Check if verification is now complete
            moov_account_id = _fetch_moov_account("employee", employee_user_id)
            if not moov_account_id:
                continue

            is_ready, error = verify_account_capabilities(moov_account_id, ["receive-funds"])
            if is_ready:
                # Clear the block and let normal payout job pick it up
                cursor.execute(
                    """
                    UPDATE GRATLYDB.PAYOUT_FINAL
                    SET PAYOUT_STATUS = NULL,
                        FAILURE_REASON = NULL,
                        UPDATED_AT = NOW()
                    WHERE PAYOUT_FINALID = %s
                    """,
                    (payout_final_id,),
                )
                processed += 1
                logger.info(f"Cleared verification block for payout {payout_final_id}")

        result = {"processed": processed}
        logger.info(f"[JOB] retry_pending_verification_payouts completed: {result}")
        return result

    finally:
        cursor.close()
