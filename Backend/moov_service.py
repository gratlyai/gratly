from datetime import datetime
import json
import os
import urllib.parse
import urllib.request
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
    return (os.getenv("MOOV_BASE_URL") or "https://api.sandbox.moov.io").rstrip("/")


def _moov_auth_header() -> str:
    token = _get_required_env("MOOV_API_KEY")
    return f"Bearer {token}"


def _moov_request(
    method: str,
    path: str,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    url = f"{_moov_base_url()}{path}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"

    headers = {"Accept": "application/json", "Authorization": _moov_auth_header()}
    data = None
    if json_body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(json_body).encode("utf-8")
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
        detail = exc.read().decode("utf-8") if exc.fp else str(exc)
        raise HTTPException(status_code=502, detail=f"Moov request failed ({url}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Moov request failed: {exc}") from exc


def _get_platform_account_id() -> str:
    return _get_required_env("MOOV_PLATFORM_ACCOUNT_ID")


def fetch_account(moov_account_id: str) -> Dict[str, Any]:
    return _moov_request("GET", f"/accounts/{moov_account_id}")


def _store_moov_account(owner_type: str, owner_id: int, moov_account_id: str) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
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
    finally:
        cursor.close()


def _fetch_moov_account(owner_type: str, owner_id: int) -> Optional[str]:
    cursor = _get_cursor(dictionary=True)
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
    finally:
        cursor.close()


def ensure_moov_account(owner_type: str, owner_id: int, payload: Dict[str, Any]) -> str:
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
        return {"account_id": account_id}

    result, _ = run_idempotent("moov_account", f"{owner_type}:{owner_id}", _create)
    return result["account_id"]


def create_onboarding_link(
    moov_account_id: str,
    return_url: str,
    refresh_url: Optional[str] = None,
) -> str:
    payload = {
        "accountID": moov_account_id,
        "redirectURL": return_url,
    }
    if refresh_url:
        payload["refreshURL"] = refresh_url
    response = _moov_request(
        "POST",
        "/onboarding-links",
        json_body=payload,
        idempotency_key=f"moov-onboarding-{moov_account_id}-{hash(return_url)}",
    )
    link = response.get("link") or response.get("url")
    if not link:
        raise HTTPException(status_code=502, detail="Moov onboarding link missing")
    return link


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
                    method.get("type") or method.get("methodType") or "unknown",
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
    payload = {
        "amount": {"currency": currency, "value": amount_cents},
        "source": source,
        "destination": destination,
        "description": description,
        "metadata": metadata,
    }
    response = _moov_request(
        "POST",
        "/transfers",
        json_body=payload,
        idempotency_key=idempotency_key,
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
