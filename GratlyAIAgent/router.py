"""FastAPI router for the Gratly AI Agent."""

import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import List

from .models import ChatRequest, ConversationSummary, ConversationDetail, ChatMessage, MessageRole
from .agent import GratlyAgent
from .config import AgentConfig

try:
    from Backend.db import _get_cursor, _fetch_restaurant_key
except ImportError:
    from db import _get_cursor, _fetch_restaurant_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agent", tags=["AI Agent"])


# --- Database helper functions ---

def _create_conversation(user_id: int, restaurant_id: int) -> int:
    """Create a new conversation and return its ID."""
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO GRATLYDB.AGENT_CONVERSATIONS (USER_ID, RESTAURANT_ID)
            VALUES (%s, %s)
            """,
            (user_id, restaurant_id),
        )
        cursor.execute("SELECT LAST_INSERT_ID() AS id")
        row = cursor.fetchone()
        return row["id"]
    finally:
        cursor.close()


def _save_message(conversation_id: int, role: str, content: str) -> None:
    """Save a message to the conversation."""
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            INSERT INTO GRATLYDB.AGENT_MESSAGES (CONVERSATION_ID, ROLE, CONTENT)
            VALUES (%s, %s, %s)
            """,
            (conversation_id, role, content),
        )
        # Update conversation timestamp
        cursor.execute(
            """
            UPDATE GRATLYDB.AGENT_CONVERSATIONS
            SET UPDATED_AT = CURRENT_TIMESTAMP
            WHERE CONVERSATION_ID = %s
            """,
            (conversation_id,),
        )
    finally:
        cursor.close()


def _get_conversation_messages(conversation_id: int) -> List[ChatMessage]:
    """Get all messages for a conversation."""
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT ROLE AS role, CONTENT AS content, CREATED_AT AS created_at
            FROM GRATLYDB.AGENT_MESSAGES
            WHERE CONVERSATION_ID = %s
            ORDER BY CREATED_AT ASC
            """,
            (conversation_id,),
        )
        rows = cursor.fetchall()
        return [
            ChatMessage(
                role=MessageRole(row["role"]),
                content=row["content"],
                created_at=row.get("created_at"),
            )
            for row in rows
        ]
    finally:
        cursor.close()


def _update_conversation_title(conversation_id: int, title: str) -> None:
    """Update the conversation title."""
    cursor = _get_cursor(dictionary=True)
    try:
        # Truncate title to 255 chars
        title = title[:255] if title else "New conversation"
        cursor.execute(
            """
            UPDATE GRATLYDB.AGENT_CONVERSATIONS
            SET TITLE = %s
            WHERE CONVERSATION_ID = %s
            """,
            (title, conversation_id),
        )
    finally:
        cursor.close()


def _verify_conversation_ownership(conversation_id: int, user_id: int) -> bool:
    """Verify that the user owns the conversation."""
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT 1 FROM GRATLYDB.AGENT_CONVERSATIONS
            WHERE CONVERSATION_ID = %s AND USER_ID = %s
            """,
            (conversation_id, user_id),
        )
        return cursor.fetchone() is not None
    finally:
        cursor.close()


# --- API Endpoints ---

@router.post("/chat")
async def chat(payload: ChatRequest):
    """
    Stream a chat response from the AI agent.
    Uses Server-Sent Events (SSE) for streaming.
    """
    # Check if agent is configured
    if not AgentConfig.is_configured():
        raise HTTPException(
            status_code=503,
            detail="AI Agent is not configured. Please set DEEPSEEK_API_KEY environment variable."
        )

    user_id = payload.user_id
    restaurant_id = _fetch_restaurant_key(user_id)

    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found for user")

    # Get or create conversation
    conversation_id = payload.conversation_id
    if not conversation_id:
        conversation_id = _create_conversation(user_id, restaurant_id)
    else:
        # Verify ownership
        if not _verify_conversation_ownership(conversation_id, user_id):
            raise HTTPException(status_code=403, detail="Access denied to this conversation")

    # Save user message
    _save_message(conversation_id, "user", payload.message)

    # Get conversation history
    history = _get_conversation_messages(conversation_id)
    # Remove the last message (the one we just added) from history for the API call
    history = history[:-1] if history else []

    # Initialize agent
    agent = GratlyAgent(user_id)

    async def generate():
        full_response = ""
        try:
            async for chunk in agent.chat_stream(payload.message, history):
                full_response += chunk
                yield f"data: {json.dumps({'content': chunk, 'conversation_id': conversation_id})}\n\n"

            # Save assistant response
            if full_response:
                _save_message(conversation_id, "assistant", full_response)

            # Update conversation title if it's the first exchange
            if len(history) == 0:
                # Use first 50 chars of user message as title
                title = payload.message[:50]
                if len(payload.message) > 50:
                    title += "..."
                _update_conversation_title(conversation_id, title)

            yield f"data: {json.dumps({'done': True, 'conversation_id': conversation_id})}\n\n"

        except Exception as e:
            logger.error(f"Chat streaming error: {e}")
            error_msg = "I'm sorry, I encountered an error. Please try again."
            _save_message(conversation_id, "assistant", error_msg)
            yield f"data: {json.dumps({'content': error_msg, 'conversation_id': conversation_id})}\n\n"
            yield f"data: {json.dumps({'done': True, 'conversation_id': conversation_id})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/conversations", response_model=List[ConversationSummary])
def get_conversations(user_id: int):
    """Get all conversations for a user."""
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                c.CONVERSATION_ID AS conversation_id,
                c.TITLE AS title,
                c.CREATED_AT AS created_at,
                c.UPDATED_AT AS updated_at,
                COUNT(m.MESSAGE_ID) AS message_count
            FROM GRATLYDB.AGENT_CONVERSATIONS c
            LEFT JOIN GRATLYDB.AGENT_MESSAGES m ON c.CONVERSATION_ID = m.CONVERSATION_ID
            WHERE c.USER_ID = %s
            GROUP BY c.CONVERSATION_ID, c.TITLE, c.CREATED_AT, c.UPDATED_AT
            ORDER BY c.UPDATED_AT DESC
            LIMIT 50
            """,
            (user_id,),
        )
        rows = cursor.fetchall()
        return [
            ConversationSummary(
                conversation_id=row["conversation_id"],
                title=row["title"],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                message_count=row["message_count"],
            )
            for row in rows
        ]
    finally:
        cursor.close()


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: int, user_id: int):
    """Get a specific conversation with all messages."""
    cursor = _get_cursor(dictionary=True)
    try:
        # Verify ownership and get conversation details
        cursor.execute(
            """
            SELECT CONVERSATION_ID, TITLE, CREATED_AT
            FROM GRATLYDB.AGENT_CONVERSATIONS
            WHERE CONVERSATION_ID = %s AND USER_ID = %s
            """,
            (conversation_id, user_id),
        )
        conv = cursor.fetchone()

        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Get messages
        messages = _get_conversation_messages(conversation_id)

        return ConversationDetail(
            conversation_id=conv["CONVERSATION_ID"],
            title=conv["TITLE"],
            messages=messages,
            created_at=conv["CREATED_AT"],
        )
    finally:
        cursor.close()


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, user_id: int):
    """Delete a conversation and all its messages."""
    cursor = _get_cursor(dictionary=True)
    try:
        # Verify ownership
        cursor.execute(
            """
            SELECT 1 FROM GRATLYDB.AGENT_CONVERSATIONS
            WHERE CONVERSATION_ID = %s AND USER_ID = %s
            """,
            (conversation_id, user_id),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Delete messages first (foreign key constraint)
        cursor.execute(
            """
            DELETE FROM GRATLYDB.AGENT_MESSAGES
            WHERE CONVERSATION_ID = %s
            """,
            (conversation_id,),
        )

        # Delete conversation
        cursor.execute(
            """
            DELETE FROM GRATLYDB.AGENT_CONVERSATIONS
            WHERE CONVERSATION_ID = %s
            """,
            (conversation_id,),
        )

        return {"status": "deleted", "conversation_id": conversation_id}
    finally:
        cursor.close()


@router.get("/health")
def agent_health():
    """Check if the AI agent is configured and ready."""
    return {
        "configured": AgentConfig.is_configured(),
        "model": AgentConfig.get_deepseek_model(),
        "base_url": AgentConfig.get_deepseek_base_url(),
    }
