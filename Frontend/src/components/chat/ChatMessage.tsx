import React from "react";
import type { ChatMessage as ChatMessageType } from "../../api/agent";

interface ChatMessageProps {
  message: ChatMessageType;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? "bg-[#cab99a] text-white"
            : "bg-white border border-[#e4dccf] text-gray-800"
        }`}
      >
        {/* Simple markdown-like rendering for code blocks */}
        <div className="text-sm whitespace-pre-wrap break-words">
          {message.content.split("```").map((part, index) => {
            if (index % 2 === 1) {
              // Code block
              return (
                <pre
                  key={index}
                  className="bg-gray-100 rounded p-2 my-2 overflow-x-auto text-xs font-mono text-gray-800"
                >
                  <code>{part.trim()}</code>
                </pre>
              );
            }
            // Regular text - handle inline code
            return (
              <span key={index}>
                {part.split("`").map((segment, i) =>
                  i % 2 === 1 ? (
                    <code
                      key={i}
                      className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono text-gray-800"
                    >
                      {segment}
                    </code>
                  ) : (
                    segment
                  )
                )}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
