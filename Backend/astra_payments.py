from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.parse
import urllib.request
import uuid

from dotenv import load_dotenv
from cryptography.fernet import Fernet

try:
    from Backend.db import (
        _get_cursor,
        _fetch_restaurant_key,
        _fetch_user_permission_names,
        _serialize_permissions,
    )
except ImportError:
    from db import (
        _get_cursor,
        _fetch_restaurant_key,
        _fetch_user_permission_names,
        _serialize_permissions,
    )

router = APIRouter()

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

DEFAULT_TOLERANCE_SECONDS = 300


class AstraConnectStartPayload(BaseModel):
    userId: int


class AstraPreferredPayoutPayload(BaseModel):
    payout_method_id: str


def _get_required_env(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise HTTPException(status_code=500, detail=f"{key} not configured")
    return value


def _normalize_encryption_key(raw_key: str) -> bytes:
    try:
        Fernet(raw_key.encode("utf-8"))
        return raw_key.encode("utf-8")
    except Exception:
        pass

    if len(raw_key) == 32:
        return base64.urlsafe_b64encode(raw_key.encode("utf-8"))
    if len(raw_key) == 64 and all(ch in "0123456789abcdefABCDEF" for ch in raw_key):
        return base64.urlsafe_b64encode(bytes.fromhex(raw_key))
    raise HTTPException(status_code=500, detail="TOKEN_ENCRYPTION_KEY is invalid")


def _get_fernet() -> Fernet:
    raw_key = _get_required_env("TOKEN_ENCRYPTION_KEY")
    normalized = _normalize_encryption_key(raw_key)
    return Fernet(normalized)


def _encrypt_token(token_value: str) -> str:
    cipher = _get_fernet()
    return cipher.encrypt(token_value.encode("utf-8")).decode("utf-8")


def _decrypt_token(token_value: str) -> str:
    cipher = _get_fernet()
    return cipher.decrypt(token_value.encode("utf-8")).decode("utf-8")


def _astra_base_url() -> str:
    return os.getenv("ASTRA_BASE_URL", "https://api-sandbox.astra.finance").rstrip("/")


def _astra_authorize_url() -> str:
    override = os.getenv("ASTRA_OAUTH_AUTHORIZE_URL")
    if override:
        return override.rstrip("/")
    base = os.getenv("ASTRA_OAUTH_BASE_URL") or os.getenv("ASTRA_AUTH_BASE_URL")
    if base:
        return f"{base.rstrip('/')}/oauth/authorize"
    return f"{_astra_base_url()}/oauth/authorize"


def _astra_token_url() -> str:
    override = os.getenv("ASTRA_OAUTH_TOKEN_URL")
    if override:
        return override.rstrip("/")
    base = os.getenv("ASTRA_OAUTH_BASE_URL") or os.getenv("ASTRA_AUTH_BASE_URL")
    if base:
        return f"{base.rstrip('/')}/oauth/token"
    return f"{_astra_base_url()}/v1/oauth/token"


def _astra_token_fallback_url() -> str:
    return f"{_astra_base_url()}/v1/oauth/token"


def _astra_token_alt_url() -> str:
    return f"{_astra_base_url()}/oauth/token"


def _oauth_client_auth_mode() -> str:
    return (os.getenv("ASTRA_OAUTH_CLIENT_AUTH") or "body").strip().lower()


def _build_basic_auth_header(client_id: str, client_secret: str) -> str:
    raw = f"{client_id}:{client_secret}".encode("utf-8")
    return f"Basic {base64.b64encode(raw).decode('utf-8')}"


def _append_oauth_scope(params: Dict[str, Any]) -> None:
    scope = os.getenv("ASTRA_OAUTH_SCOPE")
    if scope:
        params["scope"] = scope


def _astra_request(
    method: str,
    path: str,
    access_token: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
    form_body: Optional[Dict[str, Any]] = None,
    extra_headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    url = f"{_astra_base_url()}{path}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"

    headers = {"Accept": "application/json"}
    data = None
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    if extra_headers:
        headers.update(extra_headers)
    if json_body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(json_body).encode("utf-8")
    elif form_body is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        data = urllib.parse.urlencode(form_body).encode("utf-8")

    request = urllib.request.Request(url=url, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(request) as response:
            payload = response.read()
            if not payload:
                return {}
            return json.loads(payload.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_payload = exc.read()
        detail = error_payload.decode("utf-8") if error_payload else str(exc)
        raise HTTPException(
            status_code=502,
            detail=f"Astra request failed ({url}, status {exc.code}): {detail}",
        ) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Astra request failed: {exc}") from exc


def _astra_request_url(
    method: str,
    url: str,
    access_token: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
    extra_headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    headers = {"Accept": "application/json"}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    if extra_headers:
        headers.update(extra_headers)
    data = None
    if json_body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(json_body).encode("utf-8")
    request = urllib.request.Request(url=url, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(request) as response:
            payload = response.read()
            if not payload:
                return {}
            content_type = response.headers.get("Content-Type", "")
            decoded = payload.decode("utf-8", errors="replace")
            if "application/json" in content_type:
                return json.loads(decoded)
            try:
                return json.loads(decoded)
            except json.JSONDecodeError:
                return {"redirect_url": response.geturl()}
    except urllib.error.HTTPError as exc:
        error_payload = exc.read()
        detail = error_payload.decode("utf-8") if error_payload else str(exc)
        raise HTTPException(
            status_code=502,
            detail=f"Astra request failed ({token_url}, status {exc.code}): {detail}",
        ) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Astra request failed: {exc}") from exc


def _astra_cards_connect_url() -> str:
    return (
        os.getenv("ASTRA_CARDS_CONNECT_URL")
        or "https://app-sandbox.astra.finance/cards/connect"
    ).rstrip("/")


def _astra_cards_connect_query(
    astra_user_id: str,
    redirect_uri: str,
) -> str:
    params = {
        "client_id": _get_required_env("ASTRA_CLIENT_ID"),
        "redirect_uri": redirect_uri,
        "user_id": astra_user_id,
    }
    debit_direct = os.getenv("ASTRA_CARDS_DEBIT_DIRECT")
    if debit_direct:
        params["debit_direct"] = debit_direct
    return urllib.parse.urlencode(params)


def _oauth_error_needs_basic(detail: str) -> bool:
    normalized = detail.lower()
    return "token authorization required" in normalized or "invalid_client" in normalized


def _oauth_error_needs_token_fallback(detail: str) -> bool:
    normalized = detail.lower()
    return "token authentication required" in normalized or "token authorization required" in normalized


def _oauth_error_needs_not_found_fallback(detail: str) -> bool:
    normalized = detail.lower()
    return "not found" in normalized or "requested url was not found" in normalized


def _oauth_error_needs_html_fallback(detail: str) -> bool:
    normalized = detail.lower()
    return "non-json response" in normalized and ("<html" in normalized or "<!doctype html" in normalized)

def _build_signed_state(payload: Dict[str, Any]) -> str:
    secret = os.getenv("ASTRA_STATE_SECRET") or _get_required_env("ASTRA_CLIENT_SECRET")
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    encoded = base64.urlsafe_b64encode(raw).decode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), encoded.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def _parse_signed_state(state: str) -> Dict[str, Any]:
    secret = os.getenv("ASTRA_STATE_SECRET") or _get_required_env("ASTRA_CLIENT_SECRET")
    encoded, _, signature = state.partition(".")
    if not encoded or not signature:
        raise HTTPException(status_code=400, detail="Invalid state")
    expected = hmac.new(secret.encode("utf-8"), encoded.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="Invalid state signature")
    raw = base64.urlsafe_b64decode(encoded.encode("utf-8"))
    return json.loads(raw.decode("utf-8"))


def _build_connect_redirect_uri(template: str, restaurant_id: Optional[int]) -> str:
    if not restaurant_id:
        return template
    return (
        template.replace("{restaurantId}", str(restaurant_id))
        .replace("{restaurant_id}", str(restaurant_id))
        .replace("{restaurantKey}", str(restaurant_id))
    )


def _get_return_template(owner_type: str) -> str:
    if owner_type == "restaurant":
        return (
            os.getenv("ASTRA_APP_RETURN_URI_BUSINESS")
            or os.getenv("ASTRA_REDIRECT_URI_BUSINESS")
            or ""
        )
    return (
        os.getenv("ASTRA_APP_RETURN_URI_EMPLOYEE")
        or os.getenv("ASTRA_REDIRECT_URI_EMPLOYEE")
        or ""
    )


def _build_return_url(owner_type: str, restaurant_id: Optional[int]) -> str:
    template = _get_return_template(owner_type)
    if not template:
        raise HTTPException(status_code=500, detail="Astra return URL not configured")
    base = _build_connect_redirect_uri(template, restaurant_id)
    parsed = urllib.parse.urlparse(base)
    query = dict(urllib.parse.parse_qsl(parsed.query))
    query["connected"] = "1"
    return parsed._replace(query=urllib.parse.urlencode(query)).geturl()


def _fetch_restaurant_by_id(restaurant_id: int) -> Dict[str, Optional[str]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT ob.RESTAURANTGUID AS restaurant_guid,
                   rd.RESTAURANTNAME AS restaurant_name,
                   rd.PHONE AS phone
            FROM GRATLYDB.SRC_ONBOARDING ob
            LEFT JOIN GRATLYDB.SRC_RESTAURANTDETAILS rd ON rd.RESTAURANTGUID = ob.RESTAURANTGUID
            WHERE ob.RESTAURANTID = %s
            LIMIT 1
            """,
            (restaurant_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Restaurant not found")
        return {
            "restaurant_guid": row.get("restaurant_guid"),
            "restaurant_name": row.get("restaurant_name"),
            "phone": row.get("phone"),
        }
    finally:
        cursor.close()


def _fetch_user_by_id(user_id: int) -> Dict[str, Optional[str]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                FIRSTNAME AS first_name,
                LASTNAME AS last_name,
                EMAIL AS email,
                PHONENUMBER AS phone
            FROM GRATLYDB.USER_MASTER
            WHERE USERID = %s
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        return row
    finally:
        cursor.close()


def _fetch_employee_meta_for_user(user_id: int) -> Dict[str, Optional[str]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                se.EMPLOYEEGUID AS employee_guid,
                se.DELETED AS deleted,
                se.RESTAURANTGUID AS restaurant_guid
            FROM GRATLYDB.USER_MASTER um
            LEFT JOIN GRATLYDB.SRC_EMPLOYEES se ON se.EMAIL = um.EMAIL
            WHERE um.USERID = %s
            LIMIT 1
            """,
            (user_id,),
        )
        return cursor.fetchone() or {}
    finally:
        cursor.close()


def _require_admin_access(user_id: int, restaurant_id: int) -> None:
    permissions = _serialize_permissions(_fetch_user_permission_names(user_id)) or {}
    if not (permissions.get("adminAccess") or permissions.get("superadminAccess")):
        raise HTTPException(status_code=403, detail="Admin access required")
    user_restaurant = _fetch_restaurant_key(user_id)
    if user_restaurant != restaurant_id:
        raise HTTPException(status_code=403, detail="User not authorized for restaurant")


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


def _upsert_astra_restaurant(restaurant_id: int, restaurant_guid: str, name: Optional[str], status: str) -> int:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO ASTRA_RESTAURANTS (RESTAURANTID, RESTAURANTGUID, NAME, STATUS)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                RESTAURANTID = VALUES(RESTAURANTID),
                RESTAURANTGUID = VALUES(RESTAURANTGUID),
                NAME = VALUES(NAME),
                STATUS = VALUES(STATUS),
                UPDATED_AT = CURRENT_TIMESTAMP
            """,
            (restaurant_id, restaurant_guid, name, status),
        )
    finally:
        cursor.close()
    return restaurant_id


def _upsert_astra_employee(user_id: int) -> int:
    user = _fetch_user_by_id(user_id)
    employee_meta = _fetch_employee_meta_for_user(user_id)
    restaurant_id = _fetch_restaurant_key(user_id)
    if not restaurant_id:
        restaurant_guid = employee_meta.get("restaurant_guid")
        if restaurant_guid:
            restaurant_id = _fetch_restaurant_id_by_guid(restaurant_guid)
    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found for user")

    restaurant = _fetch_restaurant_by_id(restaurant_id)
    restaurant_guid = restaurant.get("restaurant_guid")
    if not restaurant_guid:
        raise HTTPException(status_code=404, detail="Restaurant guid not found")

    _upsert_astra_restaurant(
        restaurant_id=restaurant_id,
        restaurant_guid=restaurant_guid,
        name=restaurant.get("restaurant_name"),
        status="active",
    )

    employee_guid = employee_meta.get("employee_guid")
    deleted_value = str(employee_meta.get("deleted") or "").lower()
    if employee_guid:
        status = "inactive" if deleted_value in ("1", "true") else "active"
    else:
        status = "invited"

    def _normalize_phone(value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        digits = "".join(ch for ch in value if ch.isdigit())
        if not digits:
            return None
        if len(digits) > 12:
            digits = digits[-12:]
        return digits

    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO ASTRA_EMPLOYEES (
                RESTAURANTID,
                USERID,
                EMPLOYEEGUID,
                FNAME,
                LNAME,
                EMAIL,
                PHONE,
                STATUS
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                RESTAURANTID = VALUES(RESTAURANTID),
                EMPLOYEEGUID = VALUES(EMPLOYEEGUID),
                FNAME = VALUES(FNAME),
                LNAME = VALUES(LNAME),
                EMAIL = VALUES(EMAIL),
                PHONE = VALUES(PHONE),
                STATUS = VALUES(STATUS),
                UPDATED_AT = CURRENT_TIMESTAMP
            """,
            (
                restaurant_id,
                user_id,
                employee_guid,
                user.get("first_name"),
                user.get("last_name"),
                user.get("email"),
                _normalize_phone(user.get("phone")),
                status,
            ),
        )
    finally:
        cursor.close()
    return user_id


def _upsert_connection(
    owner_type: str,
    owner_id: int,
    onboarding_status: Optional[str] = None,
    access_token: Optional[str] = None,
    refresh_token: Optional[str] = None,
    expires_at: Optional[datetime] = None,
    astra_user_id: Optional[str] = None,
    astra_business_profile_id: Optional[str] = None,
    kyx_type: Optional[str] = None,
    last_status_reason: Optional[str] = None,
) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO ASTRA_CONNECTIONS (
                ID,
                OWNER_TYPE,
                OWNER_ID,
                ASTRA_USER_ID,
                ASTRA_BUSINESS_PROFILE_ID,
                KYX_TYPE,
                ONBOARDING_STATUS,
                LAST_STATUS_REASON,
                ACCESS_TOKEN_ENCRYPTED,
                REFRESH_TOKEN_ENCRYPTED,
                ACCESS_TOKEN_EXPIRES_AT,
                REVOKED_AT
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL)
            ON DUPLICATE KEY UPDATE
                ASTRA_USER_ID = COALESCE(VALUES(ASTRA_USER_ID), ASTRA_USER_ID),
                ASTRA_BUSINESS_PROFILE_ID = COALESCE(VALUES(ASTRA_BUSINESS_PROFILE_ID), ASTRA_BUSINESS_PROFILE_ID),
                KYX_TYPE = COALESCE(VALUES(KYX_TYPE), KYX_TYPE),
                ONBOARDING_STATUS = COALESCE(VALUES(ONBOARDING_STATUS), ONBOARDING_STATUS),
                LAST_STATUS_REASON = COALESCE(VALUES(LAST_STATUS_REASON), LAST_STATUS_REASON),
                ACCESS_TOKEN_ENCRYPTED = COALESCE(VALUES(ACCESS_TOKEN_ENCRYPTED), ACCESS_TOKEN_ENCRYPTED),
                REFRESH_TOKEN_ENCRYPTED = COALESCE(VALUES(REFRESH_TOKEN_ENCRYPTED), REFRESH_TOKEN_ENCRYPTED),
                ACCESS_TOKEN_EXPIRES_AT = COALESCE(VALUES(ACCESS_TOKEN_EXPIRES_AT), ACCESS_TOKEN_EXPIRES_AT),
                REVOKED_AT = NULL,
                UPDATED_AT = CURRENT_TIMESTAMP
            """,
            (
                str(uuid.uuid4()),
                owner_type,
                owner_id,
                astra_user_id,
                astra_business_profile_id,
                kyx_type,
                onboarding_status,
                last_status_reason,
                _encrypt_token(access_token) if access_token else None,
                _encrypt_token(refresh_token) if refresh_token else None,
                expires_at,
            ),
        )
    finally:
        cursor.close()


def _fetch_connection(owner_type: str, owner_id: int) -> Optional[Dict[str, Any]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT *
            FROM ASTRA_CONNECTIONS
            WHERE OWNER_TYPE = %s AND OWNER_ID = %s
            LIMIT 1
            """,
            (owner_type, owner_id),
        )
        return cursor.fetchone()
    finally:
        cursor.close()


def _send_oauth_token_request(
    token_url: str,
    payload: Dict[str, Any],
    auth_mode: str,
) -> Dict[str, Any]:
    client_id = _get_required_env("ASTRA_CLIENT_ID")
    client_secret = _get_required_env("ASTRA_CLIENT_SECRET")
    request_payload = dict(payload)
    extra_headers: Dict[str, str] = {}
    if auth_mode in ("basic", "both"):
        extra_headers["Authorization"] = _build_basic_auth_header(client_id, client_secret)
    if auth_mode in ("body", "both"):
        request_payload["client_secret"] = client_secret
    request = urllib.request.Request(
        url=token_url,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            **extra_headers,
        },
        data=urllib.parse.urlencode(request_payload).encode("utf-8"),
    )
    try:
        with urllib.request.urlopen(request) as response:
            payload_bytes = response.read()
            if not payload_bytes:
                return {}
            payload_text = payload_bytes.decode("utf-8").strip()
            if not payload_text:
                return {}
            try:
                return json.loads(payload_text)
            except json.JSONDecodeError as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"Astra request returned non-JSON response: {payload_text}",
                ) from exc
    except urllib.error.HTTPError as exc:
        error_payload = exc.read()
        detail = error_payload.decode("utf-8") if error_payload else str(exc)
        raise HTTPException(
            status_code=502,
            detail=f"Astra request failed ({token_url}, status {exc.code}): {detail}",
        ) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"Astra request failed: {exc}") from exc


def _exchange_code_for_tokens(code: str, redirect_uri: str) -> Dict[str, Any]:
    client_id = _get_required_env("ASTRA_CLIENT_ID")
    auth_mode = _oauth_client_auth_mode()
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
    }
    token_url = _astra_token_url()
    try:
        return _send_oauth_token_request(token_url, payload, auth_mode)
    except HTTPException as exc:
        if auth_mode == "body" and _oauth_error_needs_basic(str(exc.detail)):
            return _send_oauth_token_request(token_url, payload, "basic")
        if _oauth_error_needs_token_fallback(str(exc.detail)):
            fallback_url = _astra_token_fallback_url()
            if fallback_url != token_url:
                return _send_oauth_token_request(fallback_url, payload, "basic")
        if _oauth_error_needs_html_fallback(str(exc.detail)):
            fallback_url = _astra_token_fallback_url()
            if fallback_url != token_url:
                return _send_oauth_token_request(fallback_url, payload, "basic")
        if _oauth_error_needs_not_found_fallback(str(exc.detail)):
            alt_url = _astra_token_alt_url()
            if alt_url != token_url:
                return _send_oauth_token_request(alt_url, payload, "basic")
        raise


def _refresh_access_token(refresh_token: str, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
    client_id = _get_required_env("ASTRA_CLIENT_ID")
    auth_mode = _oauth_client_auth_mode()
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }
    if redirect_uri:
        payload["redirect_uri"] = redirect_uri
    token_url = _astra_token_url()
    try:
        return _send_oauth_token_request(token_url, payload, auth_mode)
    except HTTPException as exc:
        if auth_mode == "body" and _oauth_error_needs_basic(str(exc.detail)):
            return _send_oauth_token_request(token_url, payload, "basic")
        if _oauth_error_needs_token_fallback(str(exc.detail)):
            fallback_url = _astra_token_fallback_url()
            if fallback_url != token_url:
                return _send_oauth_token_request(fallback_url, payload, "basic")
        if _oauth_error_needs_html_fallback(str(exc.detail)):
            fallback_url = _astra_token_fallback_url()
            if fallback_url != token_url:
                return _send_oauth_token_request(fallback_url, payload, "basic")
        if _oauth_error_needs_not_found_fallback(str(exc.detail)):
            alt_url = _astra_token_alt_url()
            if alt_url != token_url:
                return _send_oauth_token_request(alt_url, payload, "basic")
        raise


def _get_valid_access_token(owner_type: str, owner_id: int) -> str:
    connection = _fetch_connection(owner_type, owner_id)
    if not connection:
        raise HTTPException(status_code=404, detail="Astra connection not found")
    encrypted_access = connection.get("ACCESS_TOKEN_ENCRYPTED")
    encrypted_refresh = connection.get("REFRESH_TOKEN_ENCRYPTED")
    if not encrypted_access or not encrypted_refresh:
        raise HTTPException(status_code=400, detail="Astra tokens not available")

    access_token = _decrypt_token(encrypted_access)
    expires_at = connection.get("ACCESS_TOKEN_EXPIRES_AT")
    if expires_at and not isinstance(expires_at, datetime):
        try:
            expires_at = datetime.strptime(str(expires_at), "%Y-%m-%d %H:%M:%S")
        except ValueError:
            expires_at = None
    if expires_at and expires_at <= datetime.utcnow() + timedelta(seconds=60):
        refresh_token = _decrypt_token(encrypted_refresh)
        redirect_uri = None
        if owner_type == "restaurant":
            redirect_template = _get_required_env("ASTRA_REDIRECT_URI_BUSINESS")
            redirect_uri = _build_connect_redirect_uri(redirect_template, owner_id)
        elif owner_type == "employee":
            restaurant_id = _fetch_restaurant_key(owner_id)
            redirect_template = _get_required_env("ASTRA_REDIRECT_URI_EMPLOYEE")
            redirect_uri = _build_connect_redirect_uri(redirect_template, restaurant_id)
        refreshed = _refresh_access_token(refresh_token, redirect_uri)
        access_token = refreshed.get("access_token", access_token)
        refresh_token = refreshed.get("refresh_token", refresh_token)
        expires_in = refreshed.get("expires_in") or 3600
        _upsert_connection(
            owner_type=owner_type,
            owner_id=owner_id,
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=datetime.utcnow() + timedelta(seconds=int(expires_in)),
        )
    return access_token


def _extract_list(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    for key in ("data", "accounts", "cards", "results"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    if isinstance(payload, list):
        return payload
    return []


def _upsert_payout_method(
    owner_type: str,
    owner_id: int,
    method_type: str,
    astra_account_id: Optional[str],
    astra_card_id: Optional[str],
    label: str,
    brand: Optional[str],
    last4: Optional[str],
    status: str,
) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO ASTRA_PAYOUT_METHODS (
                ID,
                OWNER_TYPE,
                OWNER_ID,
                METHOD_TYPE,
                ASTRA_ACCOUNT_ID,
                ASTRA_CARD_ID,
                LABEL,
                BRAND,
                LAST4,
                STATUS,
                IS_PREFERRED
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0)
            ON DUPLICATE KEY UPDATE
                LABEL = VALUES(LABEL),
                BRAND = VALUES(BRAND),
                LAST4 = VALUES(LAST4),
                STATUS = VALUES(STATUS),
                UPDATED_AT = CURRENT_TIMESTAMP
            """,
            (
                str(uuid.uuid4()),
                owner_type,
                owner_id,
                method_type,
                astra_account_id,
                astra_card_id,
                label,
                brand,
                last4,
                status,
            ),
        )
    finally:
        cursor.close()


def _fetch_payout_methods(owner_type: str, owner_id: int) -> List[Dict[str, Any]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                ID AS id,
                METHOD_TYPE AS methodType,
                ASTRA_ACCOUNT_ID AS astraAccountId,
                ASTRA_CARD_ID AS astraCardId,
                LABEL AS label,
                BRAND AS brand,
                LAST4 AS last4,
                STATUS AS status,
                IS_PREFERRED AS isPreferred,
                CREATED_AT AS createdAt,
                UPDATED_AT AS updatedAt
            FROM ASTRA_PAYOUT_METHODS
            WHERE OWNER_TYPE = %s AND OWNER_ID = %s
            ORDER BY IS_PREFERRED DESC, UPDATED_AT DESC
            """,
            (owner_type, owner_id),
        )
        return list(cursor.fetchall())
    finally:
        cursor.close()


def _set_preferred_method(owner_type: str, owner_id: int, method_id: str) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            UPDATE ASTRA_PAYOUT_METHODS
            SET IS_PREFERRED = 0
            WHERE OWNER_TYPE = %s AND OWNER_ID = %s
            """,
            (owner_type, owner_id),
        )
        cursor.execute(
            """
            UPDATE ASTRA_PAYOUT_METHODS
            SET IS_PREFERRED = 1
            WHERE ID = %s AND OWNER_TYPE = %s AND OWNER_ID = %s
            """,
            (method_id, owner_type, owner_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Payout method not found")
    finally:
        cursor.close()


def _clear_payout_methods(owner_type: str, owner_id: int) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            DELETE FROM ASTRA_PAYOUT_METHODS
            WHERE OWNER_TYPE = %s AND OWNER_ID = %s
            """,
            (owner_type, owner_id),
        )
    finally:
        cursor.close()


def _normalize_onboarding_status(status_value: Optional[str]) -> Optional[str]:
    if not status_value:
        return None
    normalized = status_value.lower()
    if normalized in ("approved", "verified", "active"):
        return "approved"
    if normalized in ("pending", "review", "pending_review", "in_review"):
        return "pending_review"
    if normalized in ("rejected", "failed", "denied"):
        return "rejected"
    if normalized in ("in_progress", "started"):
        return "in_progress"
    return None


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
    return any(hmac.compare_digest(expected_signature, candidate) for candidate in signatures)


def _resolve_owner_from_payload(payload: Dict[str, Any]) -> Tuple[Optional[str], Optional[int]]:
    data = payload.get("data") if isinstance(payload, dict) else None
    obj = data.get("object") if isinstance(data, dict) else None
    candidates = [payload, obj]
    for source in candidates:
        if not isinstance(source, dict):
            continue
        owner_type = source.get("owner_type") or source.get("ownerType")
        owner_id = source.get("owner_id") or source.get("ownerId")
        if owner_type and owner_id is not None:
            try:
                return owner_type, int(owner_id)
            except (TypeError, ValueError):
                pass

        def _coerce_int(value: Any) -> Optional[int]:
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        restaurant_id = _coerce_int(source.get("restaurant_id") or source.get("restaurantId"))
        restaurant_guid = source.get("restaurant_guid") or source.get("restaurantGuid")
        user_id = _coerce_int(source.get("user_id") or source.get("userId"))

        if owner_type == "restaurant" or restaurant_id or restaurant_guid:
            if restaurant_id is not None:
                return "restaurant", restaurant_id
            if restaurant_guid:
                resolved_id = _fetch_restaurant_id_by_guid(str(restaurant_guid))
                if resolved_id is not None:
                    return "restaurant", resolved_id
        if owner_type == "employee" or user_id:
            if user_id is not None:
                return "employee", user_id
    return None, None


def _record_webhook_event(
    event_id: Optional[str],
    event_type: str,
    owner_type: Optional[str],
    owner_id: Optional[int],
    payload: Dict[str, Any],
    processing_error: Optional[str] = None,
) -> None:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO ASTRA_WEBHOOK_EVENTS (
                ID,
                ASTRA_EVENT_ID,
                EVENT_TYPE,
                OWNER_TYPE,
                OWNER_ID,
                PAYLOAD_JSON,
                RECEIVED_AT,
                PROCESSED_AT,
                PROCESSING_ERROR
            )
            VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, %s, %s)
            ON DUPLICATE KEY UPDATE
                EVENT_TYPE = VALUES(EVENT_TYPE),
                OWNER_TYPE = VALUES(OWNER_TYPE),
                OWNER_ID = VALUES(OWNER_ID),
                PAYLOAD_JSON = VALUES(PAYLOAD_JSON),
                PROCESSED_AT = VALUES(PROCESSED_AT),
                PROCESSING_ERROR = VALUES(PROCESSING_ERROR)
            """,
            (
                str(uuid.uuid4()),
                event_id,
                event_type,
                owner_type,
                owner_id,
                json.dumps(payload),
                datetime.utcnow() if not processing_error else None,
                processing_error,
            ),
        )
    finally:
        cursor.close()


@router.post("/api/restaurants/{restaurant_id}/astra/connect/start")
def start_restaurant_connect(restaurant_id: int, payload: AstraConnectStartPayload):
    if not payload.userId:
        raise HTTPException(status_code=400, detail="userId is required")
    _require_admin_access(payload.userId, restaurant_id)
    restaurant = _fetch_restaurant_by_id(restaurant_id)
    restaurant_guid = restaurant.get("restaurant_guid")
    if not restaurant_guid:
        raise HTTPException(status_code=404, detail="Restaurant guid not found")

    _upsert_astra_restaurant(
        restaurant_id=restaurant_id,
        restaurant_guid=restaurant_guid,
        name=restaurant.get("restaurant_name"),
        status="onboarding",
    )
    _upsert_connection(
        owner_type="restaurant",
        owner_id=restaurant_id,
        onboarding_status="in_progress",
    )

    redirect_template = _get_required_env("ASTRA_REDIRECT_URI_BUSINESS")
    redirect_uri = _build_connect_redirect_uri(redirect_template, restaurant_id)
    state = _build_signed_state(
        {
            "owner_type": "restaurant",
            "owner_id": restaurant_id,
            "restaurant_id": restaurant_id,
        }
    )
    params = {
        "client_id": _get_required_env("ASTRA_CLIENT_ID"),
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "business": "true",
        "state": state,
    }
    _append_oauth_scope(params)
    if restaurant.get("phone"):
        params["phone"] = restaurant.get("phone")
        params["phone_read_only"] = "true"
    connect_url = f"{_astra_authorize_url()}?{urllib.parse.urlencode(params)}"
    return {"redirectUrl": connect_url}


@router.post("/api/employees/{user_id}/astra/connect/start")
def start_employee_connect(user_id: int, payload: AstraConnectStartPayload):
    if not payload.userId:
        raise HTTPException(status_code=400, detail="userId is required")
    if payload.userId != user_id:
        raise HTTPException(status_code=403, detail="User not authorized for employee")
    _clear_payout_methods("employee", user_id)
    _upsert_astra_employee(user_id)
    _upsert_connection(
        owner_type="employee",
        owner_id=user_id,
        onboarding_status="in_progress",
    )

    restaurant_id = _fetch_restaurant_key(user_id)
    redirect_template = _get_required_env("ASTRA_REDIRECT_URI_EMPLOYEE")
    redirect_uri = _build_connect_redirect_uri(redirect_template, restaurant_id)
    state = _build_signed_state(
        {
            "owner_type": "employee",
            "owner_id": user_id,
            "restaurant_id": restaurant_id,
            "user_id": user_id,
        }
    )
    params = {
        "client_id": _get_required_env("ASTRA_CLIENT_ID"),
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "business": "false",
        "state": state,
    }
    _append_oauth_scope(params)
    user = _fetch_user_by_id(user_id)
    email = user.get("email")
    if email:
        params["email"] = email
        params["email_read_only"] = "true"
    phone = user.get("phone")
    if phone:
        digits = "".join(ch for ch in phone if ch.isdigit())
        if digits:
            params["phone"] = digits[-12:] if len(digits) > 12 else digits
            params["phone_read_only"] = "true"
    connect_url = f"{_astra_authorize_url()}?{urllib.parse.urlencode(params)}"
    return {"redirectUrl": connect_url}


@router.get("/astra/oauth/callback/business")
def astra_business_callback(code: str, state: str):
    if not code or not state:
        raise HTTPException(status_code=400, detail="code and state are required")
    parsed_state = _parse_signed_state(state)
    if parsed_state.get("owner_type") != "restaurant":
        raise HTTPException(status_code=400, detail="Invalid state owner type")
    owner_id = parsed_state.get("owner_id")
    restaurant_id = parsed_state.get("restaurant_id")
    if owner_id is None:
        raise HTTPException(status_code=400, detail="Invalid state owner")
    try:
        owner_id = int(owner_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid state owner")

    redirect_template = _get_required_env("ASTRA_REDIRECT_URI_BUSINESS")
    redirect_uri = _build_connect_redirect_uri(redirect_template, restaurant_id)
    token_payload = _exchange_code_for_tokens(code, redirect_uri)
    access_token = token_payload.get("access_token")
    refresh_token = token_payload.get("refresh_token")
    expires_in = token_payload.get("expires_in") or 3600
    if not access_token or not refresh_token:
        raise HTTPException(status_code=502, detail="Astra token exchange failed")

    user_payload = _astra_request("GET", "/v1/user", access_token=access_token)
    astra_user_id = user_payload.get("id") if isinstance(user_payload, dict) else None
    status_value = (
        user_payload.get("kyb_status")
        or user_payload.get("kyc_status")
        or user_payload.get("status")
    )
    onboarding_status = _normalize_onboarding_status(status_value) or "pending_review"

    _upsert_connection(
        owner_type="restaurant",
        owner_id=owner_id,
        onboarding_status=onboarding_status,
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=datetime.utcnow() + timedelta(seconds=int(expires_in)),
        astra_user_id=astra_user_id,
        kyx_type=status_value,
    )

    return_url = _build_return_url("restaurant", restaurant_id)
    return RedirectResponse(return_url)


@router.get("/astra/oauth/callback/employee")
def astra_employee_callback(code: str, state: str):
    if not code or not state:
        raise HTTPException(status_code=400, detail="code and state are required")
    parsed_state = _parse_signed_state(state)
    if parsed_state.get("owner_type") != "employee":
        raise HTTPException(status_code=400, detail="Invalid state owner type")
    owner_id = parsed_state.get("owner_id")
    restaurant_id = parsed_state.get("restaurant_id")
    if owner_id is None:
        raise HTTPException(status_code=400, detail="Invalid state owner")
    try:
        owner_id = int(owner_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid state owner")

    redirect_template = _get_required_env("ASTRA_REDIRECT_URI_EMPLOYEE")
    redirect_uri = _build_connect_redirect_uri(redirect_template, restaurant_id)
    token_payload = _exchange_code_for_tokens(code, redirect_uri)
    access_token = token_payload.get("access_token")
    refresh_token = token_payload.get("refresh_token")
    expires_in = token_payload.get("expires_in") or 3600
    if not access_token or not refresh_token:
        raise HTTPException(status_code=502, detail="Astra token exchange failed")

    user_payload = _astra_request("GET", "/v1/user", access_token=access_token)
    astra_user_id = user_payload.get("id") if isinstance(user_payload, dict) else None
    status_value = (
        user_payload.get("kyc_status")
        or user_payload.get("status")
    )
    onboarding_status = _normalize_onboarding_status(status_value) or "pending_review"

    _upsert_connection(
        owner_type="employee",
        owner_id=owner_id,
        onboarding_status=onboarding_status,
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=datetime.utcnow() + timedelta(seconds=int(expires_in)),
        astra_user_id=astra_user_id,
        kyx_type=status_value,
    )

    return_url = _build_return_url("employee", restaurant_id)
    return RedirectResponse(return_url)


@router.get("/api/restaurants/{restaurant_id}/astra/connection")
def get_restaurant_connection(restaurant_id: int):
    restaurant = _fetch_restaurant_by_id(restaurant_id)
    restaurant_guid = restaurant.get("restaurant_guid")
    if not restaurant_guid:
        raise HTTPException(status_code=404, detail="Restaurant guid not found")
    connection = _fetch_connection("restaurant", restaurant_id)
    if not connection:
        return {"connected": False}
    return {
        "connected": True,
        "ownerType": "restaurant",
        "ownerId": restaurant_id,
        "astraUserId": connection.get("ASTRA_USER_ID"),
        "onboardingStatus": connection.get("ONBOARDING_STATUS"),
        "lastStatusReason": connection.get("LAST_STATUS_REASON"),
        "kyxType": connection.get("KYX_TYPE"),
        "revokedAt": connection.get("REVOKED_AT"),
    }


@router.get("/api/employees/{user_id}/astra/connection")
def get_employee_connection(user_id: int):
    connection = _fetch_connection("employee", user_id)
    if not connection:
        return {"connected": False}
    return {
        "connected": True,
        "ownerType": "employee",
        "ownerId": user_id,
        "astraUserId": connection.get("ASTRA_USER_ID"),
        "onboardingStatus": connection.get("ONBOARDING_STATUS"),
        "lastStatusReason": connection.get("LAST_STATUS_REASON"),
        "kyxType": connection.get("KYX_TYPE"),
        "revokedAt": connection.get("REVOKED_AT"),
    }


@router.get("/api/restaurants/{restaurant_id}/astra/payout-methods")
def list_restaurant_payout_methods(restaurant_id: int):
    restaurant = _fetch_restaurant_by_id(restaurant_id)
    restaurant_guid = restaurant.get("restaurant_guid")
    if not restaurant_guid:
        raise HTTPException(status_code=404, detail="Restaurant guid not found")
    return {"methods": _fetch_payout_methods("restaurant", restaurant_id)}


@router.get("/api/employees/{user_id}/astra/payout-methods")
def list_employee_payout_methods(user_id: int):
    return {"methods": _fetch_payout_methods("employee", user_id)}


@router.get("/api/restaurants/{restaurant_id}/astra/payout-methods/sync")
def sync_restaurant_payout_methods(restaurant_id: int):
    restaurant = _fetch_restaurant_by_id(restaurant_id)
    restaurant_guid = restaurant.get("restaurant_guid")
    if not restaurant_guid:
        raise HTTPException(status_code=404, detail="Restaurant guid not found")

    access_token = _get_valid_access_token("restaurant", restaurant_id)
    accounts_payload = _astra_request("GET", "/v1/accounts", access_token=access_token)
    card_error = None
    try:
        cards_payload = _astra_request("GET", "/v1/cards", access_token=access_token)
    except HTTPException as exc:
        card_error = exc.detail
        cards_payload = {}

    for account in _extract_list(accounts_payload):
        account_id = account.get("id")
        if not account_id:
            continue
        label = account.get("label") or account.get("bank_name") or "Bank account"
        _upsert_payout_method(
            owner_type="restaurant",
            owner_id=restaurant_id,
            method_type="bank_account",
            astra_account_id=account_id,
            astra_card_id=None,
            label=label,
            brand=account.get("bank_name"),
            last4=account.get("last4"),
            status=account.get("status") or "active",
        )

    for card in _extract_list(cards_payload):
        card_id = card.get("id")
        if not card_id:
            continue
        label = card.get("label") or card.get("brand") or "Debit card"
        _upsert_payout_method(
            owner_type="restaurant",
            owner_id=restaurant_id,
            method_type="debit_card",
            astra_account_id=None,
            astra_card_id=card_id,
            label=label,
            brand=card.get("brand"),
            last4=card.get("last4"),
            status=card.get("status") or "active",
        )

    response = {"methods": _fetch_payout_methods("restaurant", restaurant_id)}
    if card_error:
        response["cardError"] = card_error
    return response


@router.get("/api/employees/{user_id}/astra/payout-methods/sync")
def sync_employee_payout_methods(user_id: int):
    access_token = _get_valid_access_token("employee", user_id)
    accounts_payload = _astra_request("GET", "/v1/accounts", access_token=access_token)
    card_error = None
    try:
        cards_payload = _astra_request("GET", "/v1/cards", access_token=access_token)
    except HTTPException as exc:
        card_error = exc.detail
        cards_payload = {}

    for account in _extract_list(accounts_payload):
        account_id = account.get("id")
        if not account_id:
            continue
        label = account.get("label") or account.get("bank_name") or "Bank account"
        _upsert_payout_method(
            owner_type="employee",
            owner_id=user_id,
            method_type="bank_account",
            astra_account_id=account_id,
            astra_card_id=None,
            label=label,
            brand=account.get("bank_name"),
            last4=account.get("last4"),
            status=account.get("status") or "active",
        )

    for card in _extract_list(cards_payload):
        card_id = card.get("id")
        if not card_id:
            continue
        label = card.get("label") or card.get("brand") or "Debit card"
        _upsert_payout_method(
            owner_type="employee",
            owner_id=user_id,
            method_type="debit_card",
            astra_account_id=None,
            astra_card_id=card_id,
            label=label,
            brand=card.get("brand"),
            last4=card.get("last4"),
            status=card.get("status") or "active",
        )

    response = {"methods": _fetch_payout_methods("employee", user_id)}
    if card_error:
        response["cardError"] = card_error
    return response


@router.post("/api/restaurants/{restaurant_id}/payout-methods/preferred")
def set_restaurant_preferred_method(restaurant_id: int, payload: AstraPreferredPayoutPayload):
    restaurant = _fetch_restaurant_by_id(restaurant_id)
    restaurant_guid = restaurant.get("restaurant_guid")
    if not restaurant_guid:
        raise HTTPException(status_code=404, detail="Restaurant guid not found")
    if not payload.payout_method_id:
        raise HTTPException(status_code=400, detail="payout_method_id is required")
    _set_preferred_method("restaurant", restaurant_id, payload.payout_method_id)
    return {"updated": True}


@router.post("/api/employees/{user_id}/payout-methods/preferred")
def set_employee_preferred_method(user_id: int, payload: AstraPreferredPayoutPayload):
    if not payload.payout_method_id:
        raise HTTPException(status_code=400, detail="payout_method_id is required")
    _set_preferred_method("employee", user_id, payload.payout_method_id)
    return {"updated": True}


@router.post("/api/restaurants/{restaurant_id}/astra/cards/connect/start")
def start_restaurant_cards_connect(restaurant_id: int, payload: AstraConnectStartPayload):
    if not payload.userId:
        raise HTTPException(status_code=400, detail="userId is required")
    _require_admin_access(payload.userId, restaurant_id)
    restaurant = _fetch_restaurant_by_id(restaurant_id)
    restaurant_guid = restaurant.get("restaurant_guid")
    if not restaurant_guid:
        raise HTTPException(status_code=404, detail="Restaurant guid not found")
    connection = _fetch_connection("restaurant", restaurant_id)
    if not connection:
        raise HTTPException(status_code=404, detail="Astra connection not found")
    astra_user_id = connection.get("ASTRA_USER_ID")
    if not astra_user_id:
        raise HTTPException(status_code=400, detail="Astra user ID missing; reconnect first")
    redirect_uri = _build_return_url("restaurant", restaurant_id)
    connect_url = f"{_astra_cards_connect_url()}?{_astra_cards_connect_query(astra_user_id, redirect_uri)}"
    return {"redirectUrl": connect_url}


@router.post("/api/employees/{user_id}/astra/cards/connect/start")
def start_employee_cards_connect(user_id: int, payload: AstraConnectStartPayload):
    if not payload.userId:
        raise HTTPException(status_code=400, detail="userId is required")
    if payload.userId != user_id:
        raise HTTPException(status_code=403, detail="User not authorized for employee")
    connection = _fetch_connection("employee", user_id)
    if not connection:
        raise HTTPException(status_code=404, detail="Astra connection not found")
    astra_user_id = connection.get("ASTRA_USER_ID")
    if not astra_user_id:
        raise HTTPException(status_code=400, detail="Astra user ID missing; reconnect first")
    restaurant_id = _fetch_restaurant_key(user_id)
    redirect_uri = _build_return_url("employee", restaurant_id)
    connect_url = f"{_astra_cards_connect_url()}?{_astra_cards_connect_query(astra_user_id, redirect_uri)}"
    return {"redirectUrl": connect_url}


@router.post("/astra/webhooks")
async def astra_webhooks(request: Request):
    payload_bytes = await request.body()
    payload = json.loads(payload_bytes.decode("utf-8")) if payload_bytes else {}
    event_id = payload.get("id") if isinstance(payload, dict) else None
    event_type = payload.get("type") if isinstance(payload, dict) else "unknown"
    owner_type, owner_id = _resolve_owner_from_payload(payload)

    secret = os.getenv("ASTRA_WEBHOOK_SECRET")
    signature_header = (
        request.headers.get("astra-signature")
        or request.headers.get("x-astra-signature")
        or ""
    )
    if secret:
        if not signature_header:
            raise HTTPException(status_code=400, detail="Missing webhook signature")
        if not _verify_signature(payload_bytes, signature_header, secret):
            raise HTTPException(status_code=400, detail="Invalid webhook signature")

    processing_error = None
    try:
        if event_type and ("kyc" in event_type or "kyb" in event_type):
            status_value = (
                payload.get("status")
                or payload.get("data", {}).get("object", {}).get("status")
            )
            normalized = _normalize_onboarding_status(status_value)
            if normalized and owner_type and owner_id:
                _upsert_connection(
                    owner_type=owner_type,
                    owner_id=owner_id,
                    onboarding_status=normalized,
                    last_status_reason=status_value,
                )
        if "payout_method" in event_type or "card" in event_type or "bank" in event_type:
            data_obj = payload.get("data", {}).get("object", {})
            if isinstance(data_obj, dict) and owner_type and owner_id:
                method_type = data_obj.get("method_type") or data_obj.get("methodType")
                if method_type:
                    _upsert_payout_method(
                        owner_type=owner_type,
                        owner_id=owner_id,
                        method_type=method_type,
                        astra_account_id=data_obj.get("account_id") or data_obj.get("astra_account_id"),
                        astra_card_id=data_obj.get("card_id") or data_obj.get("astra_card_id"),
                        label=data_obj.get("label") or "Payout method",
                        brand=data_obj.get("brand"),
                        last4=data_obj.get("last4"),
                        status=data_obj.get("status") or "active",
                    )
        if event_type and "payout" in event_type and ("fail" in event_type or "error" in event_type):
            reason = payload.get("reason") or payload.get("message") or event_type
            if owner_type and owner_id:
                _upsert_connection(
                    owner_type=owner_type,
                    owner_id=owner_id,
                    onboarding_status="errored",
                    last_status_reason=reason,
                )
    except Exception as exc:
        processing_error = str(exc)

    _record_webhook_event(
        event_id=event_id,
        event_type=event_type,
        owner_type=owner_type,
        owner_id=owner_id,
        payload=payload,
        processing_error=processing_error,
    )
    return {"received": True}
