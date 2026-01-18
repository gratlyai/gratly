import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from Backend directory
backend_env = Path(__file__).parent.parent / "Backend" / ".env"
if backend_env.exists():
    load_dotenv(backend_env)


class AgentConfig:
    """Configuration for the Gratly AI Agent."""

    # Model parameters (static)
    MAX_TOKENS: int = 4096
    TEMPERATURE: float = 0.7
    MAX_CONTEXT_ITEMS: int = 20
    MAX_CONVERSATION_HISTORY: int = 10

    @staticmethod
    def get_deepseek_api_key() -> str:
        return os.getenv("DEEPSEEK_API_KEY", "")

    @staticmethod
    def get_deepseek_base_url() -> str:
        return os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")

    @staticmethod
    def get_deepseek_model() -> str:
        return os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

    @classmethod
    def is_configured(cls) -> bool:
        """Check if the agent is properly configured."""
        return bool(os.getenv("DEEPSEEK_API_KEY", ""))

    @classmethod
    def get_api_key(cls) -> str:
        """Get the API key, raising an error if not configured."""
        key = os.getenv("DEEPSEEK_API_KEY", "")
        if not key:
            raise ValueError("DEEPSEEK_API_KEY environment variable is not set")
        return key
