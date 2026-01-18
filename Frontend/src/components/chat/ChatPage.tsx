import React, { useEffect, useRef } from "react";
import { useChatAgent } from "../../hooks/useChatAgent";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import ChatHistory from "./ChatHistory";

interface ChatPageProps {
  userId: number;
}

const ChatPage: React.FC<ChatPageProps> = ({ userId }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const {
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
  } = useChatAgent({ userId });

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  const suggestionPrompts = [
    "Show me yesterday's payouts",
    "Who worked this week?",
    "Calculate John's tips for this month",
    "List all payout schedules",
    "What are the pending approvals?",
    "Show this month's report",
  ];

  return (
    <div className="flex h-[calc(100vh-64px)] bg-[#f4f2ee]">
      {/* Sidebar - Conversation History */}
      <aside className="w-72 flex-shrink-0 border-r border-[#e4dccf] bg-white flex flex-col">
        <div className="p-4 border-b border-[#e4dccf]">
          <button
            onClick={startNewConversation}
            className="w-full rounded-lg bg-[#cab99a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#b5a589] transition-colors flex items-center justify-center gap-2"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            New Conversation
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <ChatHistory
            conversations={conversations}
            currentId={currentConversationId}
            onSelect={loadConversation}
            isLoading={isLoading && conversations.length === 0}
          />
        </div>
      </aside>

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[#e4dccf] bg-white px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Gratly Assistant
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Ask questions about employees, payouts, schedules, and reports
            </p>
          </div>
          {currentConversationId && (
            <button
              onClick={deleteCurrentConversation}
              className="rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              title="Delete this conversation"
            >
              Delete Chat
            </button>
          )}
        </header>

        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 px-6 py-3 text-sm text-red-600 border-b border-red-100 flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={clearError}
              className="text-red-400 hover:text-red-600"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-[#e4dccf] bg-white p-8">
                <div className="text-center mb-6">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#cab99a]/10">
                    <svg
                      className="h-8 w-8 text-[#cab99a]"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                      />
                    </svg>
                  </div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Welcome to Gratly Assistant
                  </h2>
                  <p className="mt-2 text-sm text-gray-500">
                    I can help you with employee information, payout
                    calculations, schedules, and reports.
                  </p>
                </div>
                <div className="border-t border-[#e4dccf] pt-6">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
                    Try asking
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {suggestionPrompts.map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => sendMessage(suggestion)}
                        className="rounded-lg border border-[#e4dccf] bg-[#faf7f2] px-4 py-3 text-left text-sm text-gray-700 hover:border-[#cab99a] hover:bg-[#cab99a]/5 transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg, index) => (
                <ChatMessage key={index} message={msg} />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t border-[#e4dccf] bg-white">
          <div className="mx-auto max-w-3xl">
            <ChatInput onSend={sendMessage} disabled={isStreaming} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
