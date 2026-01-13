from datetime import datetime, timedelta
import json
from typing import Any, Callable, Optional, Tuple

from fastapi import HTTPException

try:
    from Backend.db import _get_cursor
except ImportError:
    from db import _get_cursor


def _load_existing(cursor, scope: str, key: str) -> Optional[dict]:
    cursor.execute(
        """
        SELECT ID AS id, STATUS AS status, LOCKED_AT AS locked_at, RESULT_JSON AS result_json
        FROM GRATLYDB.IDEMPOTENCY_KEYS
        WHERE SCOPE = %s AND IDEMPOTENCY_KEY = %s
        LIMIT 1
        """,
        (scope, key),
    )
    return cursor.fetchone()


def run_idempotent(
    scope: str,
    key: str,
    action: Callable[[], Any],
    lock_ttl_seconds: int = 300,
) -> Tuple[Any, bool]:
    """
    Returns (result, reused). reused=True means the prior result was returned.
    """
    cursor = _get_cursor(dictionary=True)
    conn = cursor.connection
    now = datetime.utcnow()
    try:
        try:
            cursor.execute(
                """
                INSERT INTO GRATLYDB.IDEMPOTENCY_KEYS (SCOPE, IDEMPOTENCY_KEY, STATUS, LOCKED_AT)
                VALUES (%s, %s, %s, %s)
                """,
                (scope, key, "processing", now),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            existing = _load_existing(cursor, scope, key)
            if existing:
                status = existing.get("status")
                locked_at = existing.get("locked_at")
                if status == "completed":
                    result_json = existing.get("result_json")
                    if result_json:
                        try:
                            return json.loads(result_json), True
                        except json.JSONDecodeError:
                            return result_json, True
                    return None, True
                if locked_at and isinstance(locked_at, datetime):
                    if locked_at > now - timedelta(seconds=lock_ttl_seconds):
                        raise HTTPException(status_code=409, detail="Idempotent operation in progress")
                cursor.execute(
                    """
                    UPDATE GRATLYDB.IDEMPOTENCY_KEYS
                    SET STATUS = %s, LOCKED_AT = %s, ERROR_TEXT = NULL
                    WHERE SCOPE = %s AND IDEMPOTENCY_KEY = %s
                    """,
                    ("processing", now, scope, key),
                )
                conn.commit()
            else:
                cursor.execute(
                    """
                    INSERT INTO GRATLYDB.IDEMPOTENCY_KEYS (SCOPE, IDEMPOTENCY_KEY, STATUS, LOCKED_AT)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (scope, key, "processing", now),
                )
                conn.commit()

        result = action()
        cursor.execute(
            """
            UPDATE GRATLYDB.IDEMPOTENCY_KEYS
            SET STATUS = %s, COMPLETED_AT = %s, RESULT_JSON = %s, ERROR_TEXT = NULL
            WHERE SCOPE = %s AND IDEMPOTENCY_KEY = %s
            """,
            ("completed", datetime.utcnow(), json.dumps(result, default=str), scope, key),
        )
        conn.commit()
        return result, False
    except Exception as exc:
        conn.rollback()
        cursor.execute(
            """
            UPDATE GRATLYDB.IDEMPOTENCY_KEYS
            SET STATUS = %s, ERROR_TEXT = %s
            WHERE SCOPE = %s AND IDEMPOTENCY_KEY = %s
            """,
            ("failed", str(exc), scope, key),
        )
        conn.commit()
        raise
    finally:
        cursor.close()
