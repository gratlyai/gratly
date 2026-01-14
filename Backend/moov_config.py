"""
Moov configuration for API Key authentication.

Handles:
- Environment variable loading and validation
- Moov Platform Account ID
- API Key for authentication
- Callback URL generation
"""

import os
import logging

logger = logging.getLogger(__name__)


class MoovConfig:
    """Moov configuration for API Key authentication."""

    # Environment variables
    API_KEY = os.getenv("MOOV_API_KEY", "")
    PLATFORM_ACCOUNT_ID = os.getenv("MOOV_PLATFORM_ACCOUNT_ID", "")
    BASE_URL = os.getenv("MOOV_BASE_URL", "https://api.moov.io")
    ENV = os.getenv("MOOV_ENV", "dev")  # local, dev, prod
    WEBHOOK_PATH = os.getenv("MOOV_WEBHOOK_PATH", "/api/webhooks/moov")
    RETURN_PATH = os.getenv("MOOV_RETURN_PATH", "/moov/return")
    DISABLE_WEBHOOK_VERIFY = os.getenv("MOOV_DISABLE_WEBHOOK_VERIFY", "false").lower() == "true"

    @classmethod
    def get_base_url(cls) -> str:
        """Get the Moov API base URL."""
        return cls.BASE_URL

    @classmethod
    def get_api_key(cls) -> str:
        """Get the Moov API key for authentication."""
        return cls.API_KEY

    @classmethod
    def get_platform_account_id(cls) -> str:
        """Get the Moov Platform Account ID."""
        return cls.PLATFORM_ACCOUNT_ID

    @classmethod
    def get_webhook_url(cls) -> str:
        """Get the webhook URL (returns full URL for webhook configuration)."""
        return f"https://dev.gratly.ai{cls.WEBHOOK_PATH}"

    @classmethod
    def get_callback_url(cls, path: str = None) -> str:
        """
        Get the callback URL for Moov return/redirect.

        Args:
            path: Path to append (default: /moov/return)

        Returns:
            Full callback URL
        """
        if path is None:
            path = cls.RETURN_PATH

        base = "https://dev.gratly.ai"

        # Ensure no double slashes
        if base.endswith("/") and path.startswith("/"):
            return base + path[1:]
        elif not base.endswith("/") and not path.startswith("/"):
            return base + "/" + path
        else:
            return base + path

    @classmethod
    def should_disable_webhook_verify(cls) -> bool:
        """Check if webhook signature verification should be disabled (local mode only)."""
        if cls.DISABLE_WEBHOOK_VERIFY:
            logger.warning("⚠️  Webhook signature verification is DISABLED - local mode only!")
            return True
        return False

    @classmethod
    def log_config(cls):
        """Log current configuration (redacting secrets)."""
        logger.info("=== Moov Configuration ===")
        logger.info(f"Environment: {cls.ENV}")
        logger.info(f"Base URL: {cls.BASE_URL}")
        logger.info(f"Webhook URL: {cls.get_webhook_url()}")
        logger.info(f"API Key Set: {bool(cls.API_KEY)}")
        logger.info(f"Platform Account ID Set: {bool(cls.PLATFORM_ACCOUNT_ID)}")
        if cls.DISABLE_WEBHOOK_VERIFY:
            logger.warning("⚠️  Webhook verification DISABLED")
        logger.info("========================")
