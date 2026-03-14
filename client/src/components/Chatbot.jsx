import { useState } from "react";

// Predefined intents with structured responses
const CHAT_INTENTS = {
  TRANSFER: {
    keywords: ["transfer", "send money", "payment", "pay"],
    response:
      "💸 I'd be happy to help you with transfers! Premium users get instant transfers, international support, and live FX rates.",
    quickActions: [
      { label: "🚀 Start Transfer", action: "openTransfer" },
      { label: "💱 Check FX Rates", action: "openTransferFx" },
    ],
  },
  BUDGET: {
    keywords: ["budget", "spending", "expense", "costs"],
    response:
      "📊 Budget management is essential for financial success! Premium users get advanced budget planners with real-time alerts.",
    quickActions: [
      { label: "📊 View Budget", action: "openBudget" },
      { label: "📈 Spending Reports", action: "openReports" },
    ],
  },
  GOALS: {
    keywords: ["goal", "saving", "savings", "target"],
    response:
      "🎯 Setting financial goals is the first step to wealth! Premium users get AI-suggested goals and progress tracking.",
    quickActions: [
      { label: "🎯 Set Savings Goal", action: "openGoals" },
      { label: "📈 Track Progress", action: "openGoals" },
    ],
  },
  FX: {
    keywords: ["fx", "currency", "exchange", "rate", "convert"],
    response:
      "💱 Live currency conversion is available for Premium users! We support USD, EUR, INR, GBP, and more.",
    quickActions: [
      { label: "💱 FX Calculator", action: "openTransfer" },
      { label: "🌍 View Rates", action: "openTransferFx" },
    ],
  },
  REPORT: {
    keywords: ["report", "analytics", "trend", "chart"],
    response:
      "📈 Financial insights help you make better decisions! Premium users get weekly digests and trend analysis.",
    quickActions: [
      { label: "📊 Generate Report", action: "openReports" },
      { label: "📈 View Trends", action: "openTrends" },
    ],
  },
  SUPPORT: {
    keywords: ["help", "support", "contact", "problem", "issue"],
    response: null, // Handled specially for support
    quickActions: null,
  },
};

export default function Chatbot({
  user,
  subscription,
  onOpenTransfer,
  onOpenBudget,
  onOpenGoals,
  onOpenReports,
}) {
  const [messages, setMessages] = useState([
    {
      from: "bot",
      text: "👋 Hi! I'm your VaultBank Assistant. Ask me about transfers, goals, budgets, or any banking questions!",
    },
  ]);
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [transcript, setTranscript] = useState([]);

  // Detect intent from message
  const detectIntent = (message) => {
    const lowerMessage = message.toLowerCase();
    for (const [intent, data] of Object.entries(CHAT_INTENTS)) {
      if (data.keywords.some((keyword) => lowerMessage.includes(keyword))) {
        return { intent, ...data };
      }
    }
    return null;
  };

  // Create support ticket with transcript
  const createSupportTicket = async (userMessage) => {
    const ticketId = `ticket_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 6)}`;
    const fullTranscript = [
      ...transcript,
      { timestamp: new Date().toISOString(), from: "user", text: userMessage },
    ];

    try {
      const response = await fetch("/support/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: localStorage.getItem("token"),
          "X-Ticket-ID": ticketId,
        },
        body: JSON.stringify({
          userId: user?.id,
          subject: `Support Request: ${userMessage.substring(0, 50)}...`,
          message: userMessage,
          transcript: fullTranscript,
          subscription: subscription,
          priority: subscription === "premium" ? "high" : "normal",
          category: "chat_support",
        }),
      });

      if (response.ok) {
        return ticketId;
      }
    } catch (error) {
      console.error("Support ticket creation failed:", error);
    }
    return null;
  };

  const sendMessage = () => {
    if (!input.trim()) return;

    const userMessage = input.trim();
    const currentMessage = {
      from: "user",
      text: userMessage,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, currentMessage]);
    setTranscript((prev) => [...prev, currentMessage]);
    setInput("");

    // Detect intent and generate response
    setTimeout(async () => {
      const intentData = detectIntent(userMessage);
      let botResponse = "";
      let quickActions = null;

      if (intentData) {
        if (intentData.intent === "SUPPORT") {
          // Handle support handoff
          botResponse =
            "🎫 I'm connecting you with our support team. They'll help resolve your issue right away.";

          const ticketId = await createSupportTicket(userMessage);
          if (ticketId) {
            botResponse += `\n\n📋 Support Ticket: ${ticketId}\n💬 Our team will respond within ${
              subscription === "premium" ? "2 hours" : "24 hours"
            }.`;
          } else {
            botResponse +=
              "\n\n⚠️ Unable to create support ticket. Please email support@vaultbank.com";
          }
        } else {
          botResponse = intentData.response;
          quickActions = intentData.quickActions;
        }
      } else {
        // Fallback responses for other queries
        const lowerMessage = userMessage.toLowerCase();

        if (
          lowerMessage.includes("premium") ||
          lowerMessage.includes("upgrade")
        ) {
          botResponse =
            "🚀 Premium features include: AI insights, fraud detection, international transfers, crypto support, weekly digests, and priority support. Upgrade for the complete banking experience!";
        } else if (
          lowerMessage.includes("fraud") ||
          lowerMessage.includes("security")
        ) {
          botResponse =
            "🛡️ Premium users get advanced fraud detection that monitors for suspicious transactions, large transfers, and unusual spending patterns. Your security is our priority!";
        } else if (
          lowerMessage.includes("card") ||
          lowerMessage.includes("credit")
        ) {
          botResponse =
            "💳 Premium users get exclusive virtual cards with no limits, cashback rewards, and enhanced security features. Perfect for serious wealth building!";
        } else if (
          lowerMessage.includes("hello") ||
          lowerMessage.includes("hi")
        ) {
          botResponse =
            "👋 Hello! I'm here to help you navigate VaultBank. What would you like to know about your financial journey?";
        } else {
          botResponse = `🤖 I understand you're asking about "${userMessage}". I'm still learning, but I can help with transfers, goals, budgets, and Premium features. What specific banking question do you have?`;
        }
      }

      const botMessage = { from: "bot", text: botResponse, quickActions };
      setMessages((prev) => [...prev, botMessage]);
      setTranscript((prev) => [...prev, botMessage]);
    }, 1000);
  };

  // Handle quick action button clicks
  const handleQuickAction = (action) => {
    switch (action) {
      case "openTransfer":
        onOpenTransfer && onOpenTransfer();
        addBotMessage("🚀 Opening transfer form for you!");
        break;
      case "openBudget":
        onOpenBudget && onOpenBudget();
        addBotMessage("📊 Opening budget section!");
        break;
      case "openGoals":
        onOpenGoals && onOpenGoals();
        addBotMessage("🎯 Opening goals dashboard!");
        break;
      case "openReports":
        onOpenReports && onOpenReports();
        addBotMessage("📈 Opening reports section!");
        break;
      default:
        break;
    }
  };

  // Helper to add bot messages
  const addBotMessage = (text) => {
    const message = { from: "bot", text, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, message]);
    setTranscript((prev) => [...prev, message]);
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      sendMessage();
    }
  };

  if (!isOpen) {
    return (
      <div className="fixed bottom-4 left-4 z-50">
        <button
          onClick={() => setIsOpen(true)}
          className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-4 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110"
        >
          <span className="text-2xl">🤖</span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 w-80 bg-gray-900 text-white rounded-lg shadow-2xl border border-gray-700 z-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-3 rounded-t-lg flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <span className="text-xl">🤖</span>
          <div>
            <p className="font-semibold">VaultBank Assistant</p>
            <p className="text-xs text-blue-200">AI Financial Guide</p>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-white hover:text-gray-300 text-xl"
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div className="h-80 overflow-y-auto p-3 space-y-3">
        {messages.map((message, i) => (
          <div
            key={i}
            className={`flex ${
              message.from === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div className="flex flex-col space-y-2">
              <div
                className={`max-w-xs px-3 py-2 rounded-lg ${
                  message.from === "user"
                    ? "bg-yellow-500 text-black"
                    : "bg-gray-800 text-gray-200"
                }`}
              >
                <div className="text-sm whitespace-pre-wrap">
                  {message.text}
                </div>
              </div>

              {/* Quick Actions for bot messages */}
              {message.from === "bot" && message.quickActions && (
                <div className="flex flex-wrap gap-1 max-w-xs">
                  {message.quickActions.map((action, actionIndex) => (
                    <button
                      key={actionIndex}
                      onClick={() => handleQuickAction(action.action)}
                      className="text-xs bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded transition-colors"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-700">
        <div className="flex space-x-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            className="flex-1 p-2 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
            placeholder="Ask me about banking..."
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim()}
            className="px-4 py-2 bg-gradient-to-r from-yellow-500 to-orange-600 text-black rounded font-semibold hover:from-yellow-400 hover:to-orange-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>

        {/* Quick suggestions */}
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            onClick={() => setInput("How do I make a transfer?")}
            className="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded transition-colors"
          >
            💸 Transfer
          </button>
          <button
            onClick={() => setInput("Tell me about Premium features")}
            className="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded transition-colors"
          >
            🚀 Premium
          </button>
          <button
            onClick={() => setInput("How do I set a budget?")}
            className="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded transition-colors"
          >
            📊 Budget
          </button>
          <button
            onClick={() => setInput("What are savings goals?")}
            className="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded transition-colors"
          >
            🎯 Goals
          </button>
        </div>
      </div>
    </div>
  );
}
