import { API_BASE_URL } from "./client";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
}

export interface ConversationSummary {
  conversationId: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationDetail {
  conversationId: number;
  title: string | null;
  messages: ChatMessage[];
  createdAt: string;
}

export interface ChatStreamChunk {
  content?: string;
  conversationId: number;
  done?: boolean;
}

export interface AgentHealthResponse {
  configured: boolean;
  model: string;
  baseUrl: string;
}

/**
 * Stream chat messages from the AI agent using Server-Sent Events.
 * Yields chunks as they arrive from the server.
 */
export async function* streamChat(
  userId: number,
  message: string,
  conversationId?: number
): AsyncGenerator<ChatStreamChunk> {
  const response = await fetch(`${API_BASE_URL}/agent/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": String(userId),
    },
    body: JSON.stringify({
      user_id: userId,
      message,
      conversation_id: conversationId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Chat request failed: ${response.status} - ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body available");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6)) as ChatStreamChunk;
            yield data;
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Fetch all conversations for a user.
 */
export async function fetchConversations(userId: number): Promise<ConversationSummary[]> {
  const response = await fetch(
    `${API_BASE_URL}/agent/conversations?user_id=${userId}`,
    {
      headers: {
        "X-User-Id": String(userId),
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch conversations: ${response.status}`);
  }

  const data = await response.json();
  // Convert snake_case to camelCase
  return data.map((conv: Record<string, unknown>) => ({
    conversationId: conv.conversation_id,
    title: conv.title,
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
    messageCount: conv.message_count,
  }));
}

/**
 * Fetch a specific conversation with all messages.
 */
export async function fetchConversation(
  conversationId: number,
  userId: number
): Promise<ConversationDetail> {
  const response = await fetch(
    `${API_BASE_URL}/agent/conversations/${conversationId}?user_id=${userId}`,
    {
      headers: {
        "X-User-Id": String(userId),
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch conversation: ${response.status}`);
  }

  const data = await response.json();
  return {
    conversationId: data.conversation_id,
    title: data.title,
    messages: data.messages.map((msg: Record<string, unknown>) => ({
      role: msg.role,
      content: msg.content,
      createdAt: msg.created_at,
    })),
    createdAt: data.created_at,
  };
}

/**
 * Delete a conversation.
 */
export async function deleteConversation(
  conversationId: number,
  userId: number
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/agent/conversations/${conversationId}?user_id=${userId}`,
    {
      method: "DELETE",
      headers: {
        "X-User-Id": String(userId),
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to delete conversation: ${response.status}`);
  }
}

/**
 * Check if the AI agent is configured and ready.
 */
export async function checkAgentHealth(): Promise<AgentHealthResponse> {
  const response = await fetch(`${API_BASE_URL}/agent/health`);

  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }

  return response.json();
}
