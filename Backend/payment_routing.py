from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List

try:
    from Backend.db import _get_cursor, _fetch_user_permission_names, _serialize_permissions
except ImportError:
    from db import _get_cursor, _fetch_user_permission_names, _serialize_permissions

router = APIRouter()


class RestaurantRoutingSummary(BaseModel):
    restaurantId: Optional[int] = None
    restaurantGuid: Optional[str] = None
    restaurantName: Optional[str] = None
    adminUsers: Optional[str] = None


class RestaurantDetail(BaseModel):
    restaurantGuid: str
    restaurantName: Optional[str] = None
    restaurantId: Optional[int] = None


def _require_superadmin_access(user_id: int) -> None:
    permission_names = _fetch_user_permission_names(user_id)
    permissions = _serialize_permissions(permission_names) or {}
    if not permissions.get("superadminAccess"):
        raise HTTPException(status_code=403, detail="Superadmin access required")


@router.get("/superadmin/restaurants", response_model=List[RestaurantRoutingSummary])
def list_restaurant_routing(user_id: int):
    _require_superadmin_access(user_id)
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                ob.RESTAURANTID AS restaurant_id,
                rd.RESTAURANTGUID AS restaurant_guid,
                rd.RESTAURANTNAME AS restaurant_name,
                admin_users.admin_users AS admin_users
            FROM GRATLYDB.SRC_RESTAURANTDETAILS rd
            LEFT JOIN GRATLYDB.SRC_ONBOARDING ob
                ON ob.RESTAURANTGUID = rd.RESTAURANTGUID
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
            ORDER BY rd.RESTAURANTNAME, rd.RESTAURANTGUID
            """
        )
        rows = cursor.fetchall()
        results: List[Dict[str, Any]] = []
        for row in rows:
            results.append(
                {
                    "restaurantId": row.get("restaurant_id"),
                    "restaurantGuid": row.get("restaurant_guid"),
                    "restaurantName": row.get("restaurant_name"),
                    "adminUsers": row.get("admin_users"),
                }
            )
        return results
    finally:
        cursor.close()


@router.get("/superadmin/restaurant-details", response_model=List[RestaurantDetail])
def list_restaurant_details(user_id: int):
    _require_superadmin_access(user_id)
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                rd.RESTAURANTGUID AS restaurant_guid,
                rd.RESTAURANTNAME AS restaurant_name,
                ob.RESTAURANTID AS restaurant_id
            FROM GRATLYDB.SRC_RESTAURANTDETAILS rd
            LEFT JOIN GRATLYDB.SRC_ONBOARDING ob
                ON ob.RESTAURANTGUID = rd.RESTAURANTGUID
            ORDER BY rd.RESTAURANTNAME, rd.RESTAURANTGUID
            """
        )
        rows = cursor.fetchall()
        return [
            {
                "restaurantGuid": row.get("restaurant_guid"),
                "restaurantName": row.get("restaurant_name"),
                "restaurantId": row.get("restaurant_id"),
            }
            for row in rows
            if row.get("restaurant_guid")
        ]
    finally:
        cursor.close()
