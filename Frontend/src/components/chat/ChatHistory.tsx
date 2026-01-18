import React from "react";
import type { ConversationSummary } from "../../api/agent";

interface ChatHistoryProps {
  conversations: ConversationSummary[];
  currentId: number | null;
  onSelect: (conversationId: number) => void;
  isLoading?: boolean;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
  conversations,
  currentId,
  onSelect,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg bg-gray-100"
          />
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <svg
          className="h-8 w-8 text-gray-300 mb-2"
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
        <p className="text-sm text-gray-500">No conversations yet</p>
        <p className="text-xs text-gray-400 mt-1">
          Start a new chat to begin
        </p>
      </div>
    );
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: "short" });
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  return (
    <div className="space-y-1">
      {conversations.map((conv) => (
        <button
          key={conv.conversationId}
          onClick={() => onSelect(conv.conversationId)}
          className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
            currentId === conv.conversationId
              ? "bg-[#cab99a]/20 border border-[#cab99a]/30"
              : "hover:bg-gray-50 border border-transparent"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p
              className={`text-sm font-medium truncate ${
                currentId === conv.conversationId
                  ? "text-[#8a7a5a]"
                  : "text-gray-800"
              }`}
            >
              {conv.title || "New conversation"}
            </p>
            <span className="text-xs text-gray-400 whitespace-nowrap">
              {formatDate(conv.updatedAt)}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {conv.messageCount} message{conv.messageCount !== 1 ? "s" : ""}
          </p>
        </button>
      ))}
    </div>
  );
};

export default ChatHistory;
