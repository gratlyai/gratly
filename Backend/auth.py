from typing import Optional

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

try:
    from Backend.db import _get_cursor, _fetch_restaurant_key, _fetch_user_permission_flags
except ImportError:
    from db import _get_cursor, _fetch_restaurant_key, _fetch_user_permission_flags


class CurrentUser(BaseModel):
    user_id: int
    is_admin: bool
    role: str


class CurrentBusiness(BaseModel):
    business_id: int
    stripe_account_id: Optional[str] = None


def _parse_user_id(request: Request) -> Optional[int]:
    raw = request.headers.get("X-User-Id") or request.headers.get("x-user-id")
    if not raw:
        raw = request.query_params.get("user_id") or request.query_params.get("userId")
    if not raw:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def get_current_user(request: Request) -> CurrentUser:
    user_id = _parse_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user context")
    permission_flags = _fetch_user_permission_flags(user_id)
    if permission_flags is None:
        raise HTTPException(status_code=403, detail="User permissions unavailable")
    is_admin = bool(permission_flags.get("isAdmin"))
    role = "admin" if is_admin else "employee"
    return CurrentUser(user_id=user_id, is_admin=is_admin, role=role)


def get_current_business(current_user: CurrentUser = Depends(get_current_user)) -> CurrentBusiness:
    business_id = _fetch_restaurant_key(current_user.user_id)
    if business_id is None:
        raise HTTPException(status_code=404, detail="Business not found for user")
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT STRIPE_ACCOUNT_ID AS stripe_account_id
            FROM GRATLYDB.SRC_ONBOARDING
            WHERE RESTAURANTID = %s
            LIMIT 1
            """,
            (business_id,),
        )
        row = cursor.fetchone()
        stripe_account_id = row["stripe_account_id"] if row else None
    finally:
        cursor.close()
    return CurrentBusiness(business_id=business_id, stripe_account_id=stripe_account_id)


def require_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user
