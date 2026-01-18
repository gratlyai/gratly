import { useState, useCallback, useRef } from "react";
import {
  streamChat,
  fetchConversations,
  fetchConversation,
  deleteConversation,
  type ChatMessage,
  type ConversationSummary,
} from "../api/agent";

interface UseChatAgentOptions {
  userId: number;
}

interface UseChatAgentReturn {
  messages: ChatMessage[];
  conversations: ConversationSummary[];
  currentConversationId: number | null;
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  loadConversations: () => Promise<void>;
  loadConversation: (conversationId: number) => Promise<void>;
  deleteCurrentConversation: () => Promise<void>;
  startNewConversation: () => void;
  clearError: () => void;
}

export function useChatAgent({ userId }: UseChatAgentOptions): UseChatAgentReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      // Clear any previous error
      setError(null);

      // Add user message immediately
      const userMessage: ChatMessage = { role: "user", content };
      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);

      // Add empty assistant message that will be filled via streaming
      const assistantMessage: ChatMessage = { role: "assistant", content: "" };
      setMessages((prev) => [...prev, assistantMessage]);

      try {
        for await (const chunk of streamChat(
          userId,
          content,
          currentConversationId || undefined
        )) {
          if (chunk.content) {
            setMessages((prev) => {
              const updated = [...prev];
              const lastIndex = updated.length - 1;
              updated[lastIndex] = {
                ...updated[lastIndex],
                content: updated[lastIndex].content + chunk.content,
              };
              return updated;
            });
          }

          // Set conversation ID if this is a new conversation
          if (chunk.conversationId && !currentConversationId) {
            setCurrentConversationId(chunk.conversationId);
          }

          if (chunk.done) {
            break;
          }
        }
      } catch (err) {
        console.error("Chat error:", err);
        const errorMessage = err instanceof Error ? err.message : "An error occurred";
        setError(errorMessage);

        // Update the assistant message with error
        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (updated[lastIndex]?.role === "assistant" && !updated[lastIndex].content) {
            updated[lastIndex] = {
              role: "assistant",
              content: "Sorry, I encountered an error. Please try again.",
            };
          }
          return updated;
        });
      } finally {
        setIsStreaming(false);
      }
    },
    [userId, currentConversationId, isStreaming]
  );

  const loadConversations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchConversations(userId);
      setConversations(data);
    } catch (err) {
      console.error("Failed to load conversations:", err);
      setError("Failed to load conversations");
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  const loadConversation = useCallback(
    async (conversationId: number) => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await fetchConversation(conversationId, userId);
        setMessages(data.messages);
        setCurrentConversationId(conversationId);
      } catch (err) {
        console.error("Failed to load conversation:", err);
        setError("Failed to load conversation");
      } finally {
        setIsLoading(false);
      }
    },
    [userId]
  );

  const deleteCurrentConversation = useCallback(async () => {
    if (!currentConversationId) return;

    setIsLoading(true);
    setError(null);
    try {
      await deleteConversation(currentConversationId, userId);
      setMessages([]);
      setCurrentConversationId(null);
      // Refresh the conversation list
      await loadConversations();
    } catch (err) {
      console.error("Failed to delete conversation:", err);
      setError("Failed to delete conversation");
    } finally {
      setIsLoading(false);
    }
  }, [currentConversationId, userId, loadConversations]);

  const startNewConversation = useCallback(() => {
    // Cancel any ongoing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setCurrentConversationId(null);
    setError(null);
  }, []);

  return {
    messages,
    conversations,
    currentConversationId,
    isLoading,
    isStreaming,
    error,
    sendMessage,
    loadConversations,
    loadConversation,
    deleteCurrentConversation,
    startNewConversation,
    clearError,
  };
}
