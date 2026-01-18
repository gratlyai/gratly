import React, { useState, useRef, useEffect } from "react";
import { useChatAgent } from "../../hooks/useChatAgent";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";

interface ChatWidgetProps {
  userId: number;
}

const ChatWidget: React.FC<ChatWidgetProps> = ({ userId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    isStreaming,
    error,
    sendMessage,
    startNewConversation,
    clearError,
  } = useChatAgent({ userId });

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  if (!userId) return null;

  return (
    <>
      {/* Floating Chat Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#cab99a] text-white shadow-lg transition-all hover:bg-[#b5a589] hover:scale-105"
        aria-label={isOpen ? "Close chat" : "Open chat"}
      >
        {isOpen ? (
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        ) : (
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[500px] w-[380px] flex-col overflow-hidden rounded-2xl border border-[#e4dccf] bg-[#faf7f2] shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#e4dccf] bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#cab99a]">
                <span className="text-sm font-semibold text-white">G</span>
              </div>
              <div>
                <span className="font-semibold text-gray-900">
                  Gratly Assistant
                </span>
                <p className="text-xs text-gray-500">AI-powered help</p>
              </div>
            </div>
            <button
              onClick={startNewConversation}
              className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              title="Start new conversation"
            >
              New Chat
            </button>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="bg-red-50 px-4 py-2 text-xs text-red-600 border-b border-red-100">
              {error}
            </div>
          )}

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#cab99a]/10">
                  <svg
                    className="h-6 w-6 text-[#cab99a]"
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
                <p className="text-sm font-medium text-gray-800">
                  Hi! I'm your Gratly Assistant.
                </p>
                <p className="mt-1 text-xs text-gray-500 max-w-[250px]">
                  Ask me about employees, payouts, schedules, or reports.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {[
                    "Who worked yesterday?",
                    "Show this week's payouts",
                    "List all employees",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => sendMessage(suggestion)}
                      className="rounded-full border border-[#e4dccf] bg-white px-3 py-1.5 text-xs text-gray-600 hover:border-[#cab99a] hover:text-gray-800"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, index) => (
                <ChatMessage key={index} message={msg} />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <ChatInput onSend={sendMessage} disabled={isStreaming} />
        </div>
      )}
    </>
  );
};

export default ChatWidget;
