import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * VaultBank Smart Assistant Widget
 *
 * Floating chat interface that provides intelligent banking assistance
 * using the backend assistant API with real account data integration
 */
const AssistantWidget = ({ user, isAuthenticated }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Initialize with welcome message when user is authenticated
  useEffect(() => {
    if (isAuthenticated && user && messages.length === 0) {
      const welcomeMessage = {
        id: Date.now(),
        from: "bot",
        content: `🤖 Hello! I'm VaultBot, your AI financial assistant. I can help you with:\n\n💰 Account balances & transactions\n🔒 Security questions & risk scores\n💸 Transfer help & budgeting advice\n📊 Analytics & financial insights\n\nWhat would you like to know?`,
        timestamp: new Date(),
        suggestedActions: [
          {
            label: "💰 Check Balance",
            action: "message",
            value: "What's my balance?",
          },
          {
            label: "📊 View Analytics",
            action: "navigate",
            value: "/analytics",
          },
          {
            label: "🔒 Security Tips",
            action: "message",
            value: "Give me security tips",
          },
        ],
      };
      setMessages([welcomeMessage]);
    }
  }, [isAuthenticated, user, messages.length]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle sending messages to the assistant API
  const handleSendMessage = async (messageText = null) => {
    const messageToSend = messageText || inputValue.trim();
    if (!messageToSend) return;

    setInputValue("");
    setIsLoading(true);

    // Add user message to chat
    const userMessage = {
      id: Date.now(),
      from: "user",
      content: messageToSend,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      // Call the assistant API
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          userId: user?.id || user?._id,
          message: messageToSend,
          context: {
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            page: window.location.pathname,
          },
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Add bot response
        const botMessage = {
          id: Date.now() + 1,
          from: "bot",
          content: data.response,
          timestamp: new Date(),
          suggestedActions: data.suggestedActions || [],
        };
        setMessages((prev) => [...prev, botMessage]);
      } else {
        // Handle API error
        const errorMessage = {
          id: Date.now() + 1,
          from: "bot",
          content:
            "Sorry, I'm having trouble processing your request right now. Please try again or contact our support team.",
          timestamp: new Date(),
          suggestedActions: [
            {
              label: "📞 Contact Support",
              action: "contact",
              value: "support",
            },
            { label: "🆘 Help Center", action: "navigate", value: "/help" },
          ],
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    } catch (error) {
      console.error("Assistant API error:", error);
      const errorMessage = {
        id: Date.now() + 1,
        from: "bot",
        content:
          "I'm experiencing connectivity issues. Please check your internet connection and try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    }

    setIsLoading(false);
  };

  // Handle suggested action clicks
  const handleSuggestedAction = (action) => {
    switch (action.action) {
      case "message":
        handleSendMessage(action.value);
        break;
      case "navigate":
        navigate(action.value);
        setIsOpen(false);
        break;
      case "contact":
        // Open support modal or navigate to contact page
        navigate("/help");
        setIsOpen(false);
        break;
      case "open":
        // Handle special actions like opening modals
        console.log("Opening:", action.value);
        break;
      default:
        console.log("Unknown action:", action);
    }
  };

  // Handle keyboard input
  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Don't render if user is not authenticated
  if (!isAuthenticated) return null;

  return (
    <>
      {/* Floating Chat Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white p-4 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 z-50"
          aria-label="Open VaultBot Assistant"
        >
          <span className="text-2xl">🤖</span>
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-96 h-[500px] bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 z-50 flex flex-col">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 rounded-t-lg flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                <span className="text-lg">🤖</span>
              </div>
              <div>
                <h3 className="font-semibold">VaultBot</h3>
                <p className="text-xs text-blue-100">AI Financial Assistant</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-white hover:text-gray-300 text-xl leading-none"
              aria-label="Close chat"
            >
              ×
            </button>
          </div>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.from === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] ${
                    message.from === "user" ? "order-2" : "order-1"
                  }`}
                >
                  {/* Message Bubble */}
                  <div
                    className={`p-3 rounded-lg ${
                      message.from === "user"
                        ? "bg-blue-600 text-white rounded-br-md"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-md"
                    }`}
                  >
                    <div className="text-sm whitespace-pre-wrap">
                      {message.content}
                    </div>
                    <div className="text-xs mt-1 opacity-70">
                      {message.timestamp.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>

                  {/* Suggested Actions */}
                  {message.from === "bot" &&
                    message.suggestedActions &&
                    message.suggestedActions.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {message.suggestedActions.map((action, index) => (
                          <button
                            key={index}
                            onClick={() => handleSuggestedAction(action)}
                            className="text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 px-3 py-1 rounded-full transition-colors duration-200"
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    )}
                </div>
              </div>
            ))}

            {/* Typing Indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg rounded-bl-md">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                    <div
                      className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
                      style={{ animationDelay: "0.1s" }}
                    ></div>
                    <div
                      className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
                      style={{ animationDelay: "0.2s" }}
                    ></div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <div className="flex space-x-2">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask me anything about banking..."
                className="flex-1 p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                disabled={isLoading}
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={isLoading || !inputValue.trim()}
                className="px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg transition-all duration-200 disabled:cursor-not-allowed font-medium"
              >
                {isLoading ? "..." : "Send"}
              </button>
            </div>

            {/* Quick Suggestions */}
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={() => handleSendMessage("What's my balance?")}
                className="text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-3 py-1 rounded-full transition-colors duration-200"
                disabled={isLoading}
              >
                💰 Balance
              </button>
              <button
                onClick={() => handleSendMessage("Security tips")}
                className="text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-3 py-1 rounded-full transition-colors duration-200"
                disabled={isLoading}
              >
                🛡️ Security
              </button>
              <button
                onClick={() => handleSendMessage("Show recent transactions")}
                className="text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-3 py-1 rounded-full transition-colors duration-200"
                disabled={isLoading}
              >
                📊 Transactions
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AssistantWidget;
