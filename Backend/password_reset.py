from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    from Backend.db import _get_cursor
    from Backend.email_utils import send_sendgrid_email
    from Backend.security import hash_password
except ImportError:
    from db import _get_cursor
    from email_utils import send_sendgrid_email
    from security import hash_password

router = APIRouter()

RESET_LINK_BASE = "http://localhost:5173/reset-password"

class PasswordResetRequest(BaseModel):
    email: str

class PasswordResetConfirm(BaseModel):
    token: str
    password: str

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def _ensure_reset_table(cursor) -> None:
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS GRATLYDB.PASSWORD_RESET_TOKENS (
            RESETID INT AUTO_INCREMENT PRIMARY KEY,
            USERID INT NOT NULL,
            TOKEN_HASH VARCHAR(64) NOT NULL,
            EXPIRES_AT TIMESTAMP NOT NULL,
            USED_AT TIMESTAMP NULL,
            CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX (TOKEN_HASH),
            INDEX (USERID)
        )
        """
    )

def _validate_password(password: str) -> None:
    min_length = 8
    max_length = 12
    has_uppercase = any(c.isupper() for c in password)
    has_number = any(c.isdigit() for c in password)
    has_special_char = any(c in "!@#$%^&*()_+-=[]{};':\"\\|,.<>/?" for c in password)
    if not (min_length <= len(password) <= max_length and has_uppercase and has_number and has_special_char):
        raise HTTPException(
            status_code=400,
            detail="Password does not meet requirements: must be 8-12 characters, include an uppercase letter, a number, and a special character.",
        )

@router.post("/password-reset/request")
def request_password_reset(payload: PasswordResetRequest):
    email = payload.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT USERID AS userId, FIRSTNAME AS firstName
            FROM USER_MASTER
            WHERE EMAIL = %s
            LIMIT 1
            """,
            (email,),
        )
        user = cursor.fetchone()
        if not user:
            return {"success": True}

        _ensure_reset_table(cursor)
        token = secrets.token_urlsafe(32)
        token_hash = _hash_token(token)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

        cursor.execute(
            """
            INSERT INTO GRATLYDB.PASSWORD_RESET_TOKENS (USERID, TOKEN_HASH, EXPIRES_AT)
            VALUES (%s, %s, %s)
            """,
            (user["userId"], token_hash, expires_at),
        )

        reset_link = f"{RESET_LINK_BASE}?token={token}"
        name = user.get("firstName") or "there"
        message = (
            f"Hi {name},\n\n"
            "We received a request to reset your Gratly password.\n"
            f"Reset your password using this link:\n{reset_link}\n\n"
            "If you did not request this, you can ignore this email."
        )
        send_sendgrid_email(
            to_email=email,
            subject="Reset your Gratly password",
            content=message,
            sender_name="Gratly",
        )
        return {"success": True}
    finally:
        cursor.close()

@router.post("/password-reset/confirm")
def confirm_password_reset(payload: PasswordResetConfirm):
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Reset token is required")

    _validate_password(payload.password)
    token_hash = _hash_token(token)
    cursor = _get_cursor(dictionary=True)
    try:
        _ensure_reset_table(cursor)
        cursor.execute(
            """
            SELECT RESETID AS resetId, USERID AS userId, EXPIRES_AT AS expiresAt, USED_AT AS usedAt
            FROM GRATLYDB.PASSWORD_RESET_TOKENS
            WHERE TOKEN_HASH = %s
            LIMIT 1
            """,
            (token_hash,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=400, detail="Invalid reset token")
        if row.get("usedAt") is not None:
            raise HTTPException(status_code=400, detail="Reset token already used")
        expires_at = row.get("expiresAt")
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if not expires_at or expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Reset token expired")

        password_hash = hash_password(payload.password)
        cursor.execute(
            "UPDATE USER_MASTER SET PASSWORD_HASH = %s WHERE USERID = %s",
            (password_hash, row["userId"]),
        )
        cursor.execute(
            "UPDATE GRATLYDB.PASSWORD_RESET_TOKENS SET USED_AT = CURRENT_TIMESTAMP WHERE RESETID = %s",
            (row["resetId"],),
        )
        return {"success": True}
    finally:
        cursor.close()
