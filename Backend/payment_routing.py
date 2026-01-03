from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import pymysql

try:
    from Backend.db import (
        _get_cursor,
        _fetch_user_permission_names,
        _serialize_permissions,
    )
except ImportError:
    from db import (
        _get_cursor,
        _fetch_user_permission_names,
        _serialize_permissions,
    )

router = APIRouter()

ALLOWED_PROVIDERS = {"stripe", "astra"}


class PaymentRoutingPayload(BaseModel):
    userId: int
    restaurantId: int
    provider: str


class PaymentRoutingResponse(BaseModel):
    restaurantId: int
    provider: str
    locked: bool
    updatedByUserId: Optional[int] = None
    updatedAt: Optional[str] = None


def _require_superadmin_access(user_id: int) -> None:
    permission_names = _fetch_user_permission_names(user_id)
    permissions = _serialize_permissions(permission_names) or {}
    if not permissions.get("superadminAccess"):
        raise HTTPException(status_code=403, detail="Superadmin access required")


def _normalize_provider(provider: str) -> str:
    if not provider:
        raise HTTPException(status_code=400, detail="Provider is required")
    value = provider.strip().lower()
    if value not in ALLOWED_PROVIDERS:
        raise HTTPException(status_code=400, detail="Invalid provider")
    return value


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


def _fetch_payment_routing_row(restaurant_id: int) -> Optional[Dict[str, Any]]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                RESTAURANTGUID AS restaurant_guid,
                RESTAURANTID AS restaurant_id,
                PROVIDER AS provider,
                UPDATED_BY_USERID AS updated_by_user_id,
                UPDATED_AT AS updated_at
            FROM GRATLYDB.RESTAURANT_PAYMENT_ROUTING
            WHERE RESTAURANTID = %s
            LIMIT 1
            """,
            (restaurant_id,),
        )
        return cursor.fetchone()
    finally:
        cursor.close()


def _fetch_payment_provider(restaurant_id: int) -> str:
    row = _fetch_payment_routing_row(restaurant_id)
    provider = (row or {}).get("provider") or "stripe"
    return provider.strip().lower()


def _is_payment_routing_set(restaurant_id: int) -> bool:
    row = _fetch_payment_routing_row(restaurant_id)
    return bool(row and row.get("provider"))


def _upsert_payment_routing(restaurant_id: int, provider: str, updated_by_user_id: int) -> None:
    restaurant_guid = _fetch_restaurant_guid_by_id(restaurant_id)
    cursor = _get_cursor(dictionary=False)
    try:
        cursor.execute(
            """
            INSERT INTO GRATLYDB.RESTAURANT_PAYMENT_ROUTING (
                RESTAURANTGUID,
                RESTAURANTID,
                PROVIDER,
                UPDATED_BY_USERID
            )
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                RESTAURANTGUID = COALESCE(VALUES(RESTAURANTGUID), RESTAURANTGUID),
                PROVIDER = VALUES(PROVIDER),
                UPDATED_BY_USERID = VALUES(UPDATED_BY_USERID)
            """,
            (restaurant_guid, restaurant_id, provider, updated_by_user_id),
        )
        cursor.connection.commit()
    finally:
        cursor.close()


@router.get("/admin/payment-routing", response_model=PaymentRoutingResponse)
def get_payment_routing(restaurant_id: int, user_id: int):
    _require_superadmin_access(user_id)
    row = _fetch_payment_routing_row(restaurant_id)
    if not row:
        return {
            "restaurantId": restaurant_id,
            "provider": "stripe",
            "locked": False,
            "updatedByUserId": None,
            "updatedAt": None,
        }
    provider = (row.get("provider") or "stripe").strip().lower()
    updated_at = row.get("updated_at")
    return {
        "restaurantId": restaurant_id,
        "provider": provider,
        "locked": True,
        "updatedByUserId": row.get("updated_by_user_id"),
        "updatedAt": str(updated_at) if updated_at else None,
    }


@router.post("/admin/payment-routing", response_model=PaymentRoutingResponse)
def set_payment_routing(payload: PaymentRoutingPayload):
    _require_superadmin_access(payload.userId)
    provider = _normalize_provider(payload.provider)
    row = _fetch_payment_routing_row(payload.restaurantId)
    if row and row.get("provider"):
        existing = (row.get("provider") or "").strip().lower()
        if existing != provider:
            raise HTTPException(status_code=400, detail="Payment provider already set")
        updated_at = row.get("updated_at")
        return {
            "restaurantId": payload.restaurantId,
            "provider": existing or provider,
            "locked": True,
            "updatedByUserId": row.get("updated_by_user_id"),
            "updatedAt": str(updated_at) if updated_at else None,
        }

    try:
        _upsert_payment_routing(payload.restaurantId, provider, payload.userId)
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error saving payment routing: {err}")

    updated = _fetch_payment_routing_row(payload.restaurantId)
    updated_at = (updated or {}).get("updated_at")
    return {
        "restaurantId": payload.restaurantId,
        "provider": provider,
        "locked": True,
        "updatedByUserId": payload.userId,
        "updatedAt": str(updated_at) if updated_at else None,
    }


class RestaurantRoutingSummary(BaseModel):
    restaurantId: int
    restaurantGuid: Optional[str] = None
    restaurantName: Optional[str] = None
    provider: str
    locked: bool
    updatedByUserId: Optional[int] = None
    updatedAt: Optional[str] = None
    bankLast4: Optional[str] = None
    bankName: Optional[str] = None
    usBankPaymentMethodId: Optional[str] = None
    adminUsers: Optional[str] = None


@router.get("/superadmin/restaurants", response_model=List[RestaurantRoutingSummary])
def list_restaurant_routing(user_id: int):
    _require_superadmin_access(user_id)
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                ob.RESTAURANTID AS restaurant_id,
                ob.RESTAURANTGUID AS restaurant_guid,
                rd.RESTAURANTNAME AS restaurant_name,
                pr.PROVIDER AS provider,
                pr.UPDATED_BY_USERID AS updated_by_user_id,
                pr.UPDATED_AT AS updated_at,
                s.BANK_LAST4 AS bank_last4,
                s.BANK_NAME AS bank_name,
                s.US_BANK_PAYMENT_METHOD_ID AS us_bank_payment_method_id,
                admin_users.admin_users AS admin_users
            FROM GRATLYDB.SRC_ONBOARDING ob
            LEFT JOIN GRATLYDB.SRC_RESTAURANTDETAILS rd
                ON ob.RESTAURANTGUID = rd.RESTAURANTGUID
            LEFT JOIN GRATLYDB.RESTAURANT_PAYMENT_ROUTING pr
                ON ob.RESTAURANTID = pr.RESTAURANTID
            LEFT JOIN GRATLYDB.STRIPE_RESTAURANT_SETTINGS s
                ON ob.RESTAURANTID = s.RESTAURANTID
            LEFT JOIN (
                SELECT
                    ur.RESTAURANTID AS restaurant_id,
                    GROUP_CONCAT(
                        DISTINCT CONCAT(
                            COALESCE(um.FIRSTNAME, ''),
                            CASE WHEN um.LASTNAME IS NULL OR um.LASTNAME = '' THEN '' ELSE CONCAT(' ', um.LASTNAME) END,
                            CASE WHEN um.EMAIL IS NULL OR um.EMAIL = '' THEN '' ELSE CONCAT(' <', um.EMAIL, '>') END
                        )
                        SEPARATOR '; '
                    ) AS admin_users
                FROM GRATLYDB.USERRESTAURANT ur
                JOIN GRATLYDB.USER_MASTER um
                    ON ur.USERID = um.USERID
                JOIN GRATLYDB.USER_PERMISSIONS up
                    ON up.USERID = um.USERID
                JOIN GRATLYDB.MSTR_PERMISSIONS mp
                    ON up.PERMISSIONSID = mp.PERMISSIONSID
                   AND (mp.DELETED IS NULL OR mp.DELETED = 0)
                   AND LOWER(mp.PERMISSIONSNAME) = 'admin access'
                GROUP BY ur.RESTAURANTID
            ) admin_users
                ON admin_users.restaurant_id = ob.RESTAURANTID
            ORDER BY rd.RESTAURANTNAME, ob.RESTAURANTID
            """
        )
        rows = cursor.fetchall()
        results = []
        for row in rows:
            provider = (row.get("provider") or "stripe").strip().lower()
            updated_at = row.get("updated_at")
            results.append(
                {
                    "restaurantId": row.get("restaurant_id"),
                    "restaurantGuid": row.get("restaurant_guid"),
                    "restaurantName": row.get("restaurant_name"),
                    "provider": provider,
                    "locked": bool(row.get("provider")),
                    "updatedByUserId": row.get("updated_by_user_id"),
                    "updatedAt": str(updated_at) if updated_at else None,
                    "bankLast4": row.get("bank_last4"),
                    "bankName": row.get("bank_name"),
                    "usBankPaymentMethodId": row.get("us_bank_payment_method_id"),
                    "adminUsers": row.get("admin_users"),
                }
            )
        return results
    finally:
        cursor.close()
