"""
Moov webhook handling with deduplication, signature verification, and idempotent processing.

Ensures:
- Each webhook is processed exactly once (deduplication)
- Signature verification (optional in local mode)
- Idempotent status updates
- Audit trail for debugging
"""

import json
import hashlib
import logging
from typing import Dict, Any, Optional

try:
    from Backend.db import _get_cursor
    from Backend.moov_config import MoovConfig
except ImportError:
    from db import _get_cursor
    from moov_config import MoovConfig

logger = logging.getLogger(__name__)


def get_webhook_event_hash(payload: Dict[str, Any]) -> str:
    """
    Generate a hash of the webhook payload for deduplication.

    Uses the event ID if available, otherwise hashes the entire payload.
    """
    event_id = payload.get("id") or payload.get("eventID") or payload.get("event_id")
    if event_id:
        return hashlib.sha256(str(event_id).encode()).hexdigest()
    else:
        # Fallback: hash the payload
        payload_str = json.dumps(payload, sort_keys=True)
        return hashlib.sha256(payload_str.encode()).hexdigest()


def is_webhook_duplicate(event_id: str, event_hash: str) -> bool:
    """
    Check if a webhook has already been processed.

    Args:
        event_id: Unique event identifier from Moov
        event_hash: Hash of the payload for fallback dedup

    Returns:
        True if this webhook has been processed before
    """
    cursor = _get_cursor(dictionary=True)
    try:
        # Check by event ID first (most reliable)
        if event_id:
            cursor.execute(
                """
                SELECT id FROM GRATLYDB.WEBHOOK_EVENTS
                WHERE provider = 'moov' AND event_id = %s
                LIMIT 1
                """,
                (event_id,),
            )
            if cursor.fetchone():
                logger.info(f"Duplicate webhook detected: event_id={event_id}")
                return True

        # Check by payload hash as fallback
        cursor.execute(
            """
            SELECT id FROM GRATLYDB.WEBHOOK_EVENTS
            WHERE provider = 'moov' AND payload_hash = %s
            LIMIT 1
            """,
            (event_hash,),
        )
        if cursor.fetchone():
            logger.info(f"Duplicate webhook detected: payload_hash={event_hash}")
            return True

        return False
    finally:
        cursor.close()


def record_webhook_event(event_id: str, event_type: str, payload: Dict[str, Any], processed: bool = True) -> bool:
    """
    Record a webhook event in the database for deduplication and audit trail.

    Args:
        event_id: Unique event identifier from Moov
        event_type: Type of event (e.g., "transfer.completed")
        payload: Full webhook payload (will be redacted for secrets)
        processed: Whether the event was successfully processed

    Returns:
        True if recorded successfully
    """
    cursor = _get_cursor(dictionary=True)
    try:
        payload_hash = hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest()

        # Redact secrets from payload before storing
        redacted_payload = redact_sensitive_fields(payload)

        cursor.execute(
            """
            INSERT INTO GRATLYDB.WEBHOOK_EVENTS (
                provider,
                event_id,
                event_type,
                payload_json,
                payload_hash,
                processed,
                received_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
            """,
            (
                "moov",
                event_id,
                event_type,
                json.dumps(redacted_payload),
                payload_hash,
                1 if processed else 0,
            ),
        )
        logger.info(f"Recorded webhook event: {event_type} (id={event_id})")
        return True
    except Exception as e:
        logger.error(f"Failed to record webhook event: {str(e)}")
        return False
    finally:
        cursor.close()


def redact_sensitive_fields(data: Any) -> Any:
    """
    Recursively redact sensitive fields from a payload for safe logging/storage.

    Redacts: passwords, tokens, secrets, keys, PII
    """
    if isinstance(data, dict):
        redacted = {}
        for key, value in data.items():
            lower_key = key.lower()
            if any(
                sensitive in lower_key
                for sensitive in [
                    "password",
                    "secret",
                    "token",
                    "key",
                    "credential",
                    "auth",
                    "ssn",
                    "account",
                ]
            ):
                redacted[key] = "***REDACTED***"
            else:
                redacted[key] = redact_sensitive_fields(value)
        return redacted
    elif isinstance(data, list):
        return [redact_sensitive_fields(item) for item in data]
    else:
        return data


def verify_webhook_signature(payload_raw: bytes, signature: str, secret: str) -> bool:
    """
    Verify a Moov webhook signature.

    Moov uses HMAC-SHA256 signatures. This function:
    - Only verifies if not in local mode
    - Logs warnings if verification is disabled
    - Returns True if verification passes or is disabled

    Args:
        payload_raw: Raw webhook payload bytes
        signature: Signature from X-Moov-Signature header
        secret: Moov webhook secret

    Returns:
        True if signature is valid or verification is disabled
    """
    if MoovConfig.should_disable_webhook_verify():
        logger.warning("⚠️  Skipping webhook signature verification (local mode)")
        return True

    try:
        import hmac
        expected_signature = hmac.new(
            secret.encode(), payload_raw, hashlib.sha256
        ).hexdigest()
        is_valid = hmac.compare_digest(signature, expected_signature)
        if not is_valid:
            logger.error("Webhook signature verification failed")
        return is_valid
    except Exception as e:
        logger.error(f"Webhook signature verification error: {str(e)}")
        return False
