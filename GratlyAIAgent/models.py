from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class ChatMessage(BaseModel):
    role: MessageRole
    content: str
    context_data: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None


class ChatRequest(BaseModel):
    user_id: int
    conversation_id: Optional[int] = None
    message: str


class ChatStreamChunk(BaseModel):
    content: Optional[str] = None
    conversation_id: int
    done: bool = False


class ConversationSummary(BaseModel):
    conversation_id: int
    title: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    message_count: int


class ConversationDetail(BaseModel):
    conversation_id: int
    title: Optional[str] = None
    messages: List[ChatMessage]
    created_at: datetime
