"""
Moov configuration and local development mode support.

Handles:
- Environment variable loading and validation
- OAuth token caching and refresh
- Callback URL generation (tunnel vs dev_domain modes)
- Local testing mode configuration
"""

import os
import time
import logging
from typing import Optional, Dict, Tuple
import requests

logger = logging.getLogger(__name__)


class MoovConfig:
    """Moov configuration for local and production environments."""

    # Environment variables with defaults
    CLIENT_ID = os.getenv("MOOV_CLIENT_ID", "")
    CLIENT_SECRET = os.getenv("MOOV_CLIENT_SECRET", "")
    BASE_URL = os.getenv("MOOV_BASE_URL", "https://api.moov.io")
    ENV = os.getenv("MOOV_ENV", "dev")  # local, dev, prod
    LOCAL_MODE = os.getenv("MOOV_LOCAL_MODE", "false").lower() == "true"
    CALLBACK_MODE = os.getenv("MOOV_CALLBACK_MODE", "tunnel")  # tunnel, dev_domain
    PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000")
    DEV_DOMAIN_BASE_URL = os.getenv("DEV_DOMAIN_BASE_URL", "https://dev.gratly.ai")
    WEBHOOK_PATH = os.getenv("MOOV_WEBHOOK_PATH", "/api/webhooks/moov")
    RETURN_PATH = os.getenv("MOOV_RETURN_PATH", "/moov/return")
    DISABLE_WEBHOOK_VERIFY = os.getenv("MOOV_DISABLE_WEBHOOK_VERIFY", "false").lower() == "true"

    # Token caching
    _token_cache: Optional[Dict[str, any]] = None
    _token_expiry: float = 0
    _token_refresh_buffer: int = 60  # Refresh 60 seconds before expiry

    @classmethod
    def get_base_url(cls) -> str:
        """Get the Moov API base URL."""
        return cls.BASE_URL

    @classmethod
    def get_callback_url(cls, path: str = None) -> str:
        """
        Get the callback URL based on the configured mode.

        Args:
            path: Path to append (e.g., "/moov/return" or "/api/webhooks/moov")

        Returns:
            Full callback URL
        """
        if path is None:
            path = cls.RETURN_PATH

        if cls.CALLBACK_MODE == "tunnel":
            base = cls.PUBLIC_BASE_URL
        elif cls.CALLBACK_MODE == "dev_domain":
            base = cls.DEV_DOMAIN_BASE_URL
        else:
            base = cls.PUBLIC_BASE_URL

        # Ensure no double slashes
        if base.endswith("/") and path.startswith("/"):
            return base + path[1:]
        elif not base.endswith("/") and not path.startswith("/"):
            return base + "/" + path
        else:
            return base + path

    @classmethod
    def get_webhook_url(cls) -> str:
        """Get the webhook URL based on the configured mode."""
        return cls.get_callback_url(cls.WEBHOOK_PATH)

    @classmethod
    def is_local_mode(cls) -> bool:
        """Check if running in local mode."""
        return cls.LOCAL_MODE

    @classmethod
    def should_disable_webhook_verify(cls) -> bool:
        """Check if webhook signature verification should be disabled (local mode only)."""
        if cls.DISABLE_WEBHOOK_VERIFY and cls.LOCAL_MODE:
            logger.warning("⚠️  Webhook signature verification is DISABLED - local mode only!")
            return True
        return False

    @classmethod
    def get_oauth_token(cls) -> str:
        """
        Get a valid Moov OAuth2 token using client_credentials grant.

        Implements:
        - Token caching with expiry check
        - Automatic refresh before expiry
        - Retry logic with exponential backoff

        Returns:
            OAuth access token

        Raises:
            Exception: If token fetch fails after retries
        """
        # Return cached token if still valid
        if cls._token_cache and time.time() < (cls._token_expiry - cls._token_refresh_buffer):
            return cls._token_cache.get("access_token")

        logger.info("Fetching new Moov OAuth token...")

        # Retry logic with exponential backoff
        max_retries = 3
        for attempt in range(max_retries):
            try:
                token_response = requests.post(
                    f"{cls.BASE_URL}/oauth2/token",
                    data={
                        "client_id": cls.CLIENT_ID,
                        "client_secret": cls.CLIENT_SECRET,
                        "grant_type": "client_credentials",
                    },
                    timeout=10,
                )
                token_response.raise_for_status()

                token_data = token_response.json()
                cls._token_cache = token_data
                cls._token_expiry = time.time() + token_data.get("expires_in", 3600)

                logger.info(f"OAuth token fetched successfully (expires in {token_data.get('expires_in', 'unknown')}s)")
                return token_data.get("access_token")

            except requests.exceptions.RequestException as e:
                wait_time = 2 ** attempt  # Exponential backoff: 1s, 2s, 4s
                logger.warning(f"OAuth token fetch failed (attempt {attempt + 1}/{max_retries}): {str(e)}")

                if attempt < max_retries - 1:
                    logger.info(f"Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                else:
                    logger.error("All OAuth token fetch attempts failed")
                    raise

    @classmethod
    def log_config(cls):
        """Log current configuration (redacting secrets)."""
        logger.info("=== Moov Configuration ===")
        logger.info(f"Environment: {cls.ENV}")
        logger.info(f"Local Mode: {cls.LOCAL_MODE}")
        logger.info(f"Callback Mode: {cls.CALLBACK_MODE}")
        logger.info(f"Base URL: {cls.BASE_URL}")
        logger.info(f"Public Base URL: {cls.PUBLIC_BASE_URL}")
        logger.info(f"Webhook URL: {cls.get_webhook_url()}")
        logger.info(f"Return URL: {cls.get_callback_url()}")
        logger.info(f"Client ID Set: {bool(cls.CLIENT_ID)}")
        logger.info(f"Client Secret Set: {bool(cls.CLIENT_SECRET)}")
        if cls.DISABLE_WEBHOOK_VERIFY:
            logger.warning("⚠️  Webhook verification DISABLED")
        logger.info("========================")
