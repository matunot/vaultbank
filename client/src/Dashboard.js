import React, { useState, useEffect, useCallback } from "react";
import { Pie, Bar, Line, Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title, PointElement, LineElement } from "chart.js";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import {
  TwitterShareButton,
  WhatsappShareButton,
  LinkedinShareButton
} from "react-share";
import VirtualCard from "./components/VirtualCard";
import Reports from "./components/Reports";
import TrendReports from "./components/TrendReports";
import GoalsDashboard from "./components/GoalsDashboard";
import Transfer from "./components/Transfer";
import TransferHistory from "./components/TransferHistory";
import BudgetCard from "./components/BudgetCard";
import WeeklyDigest from "./components/WeeklyDigest";
import Chatbot from "./components/Chatbot";
import AuditLog from "./components/AuditLog";
import RedeemCode from "./components/RedeemCode";
import AlertsCenter from "./components/AlertsCenter";
import Rewards from "./components/Rewards";
import NotificationDropdown from "./components/NotificationDropdown";
import LuxurySidebar from "./components/LuxurySidebar";
import { api } from "./config/apiConfig";

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title, PointElement, LineElement);

function Dashboard({ darkMode, subscription, setSubscription }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [notifications, setNotifications] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [fraudAlerts, setFraudAlerts] = useState([]);
  const [showCenter, setShowCenter] = useState(false);
  const [unreadAlertsCount, setUnreadAlertsCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  // Load unread alerts count
  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await api.get("/api/alerts/unread-count");
      if (response.success) {
        setUnreadAlertsCount(response.unreadCount);
      }
    } catch (error) {
      console.error("Failed to load unread alerts count:", error);
    }
  }, []);

  // Load alerts count when component mounts
  useEffect(() => {
    if (user) {
      loadUnreadCount();
    }
  }, [user, loadUnreadCount]);

  // Notification utility function
  const notify = useCallback((type, message) => {
    setNotifications((prev) => [
      ...prev,
      { id: Date.now(), type, message, read: false, ts: new Date().toISOString() },
    ]);
  }, []);

  // Simulate card use for testing
  const simulateCardUse = () => notify("card", "💳 Elite Card used — No Limit privilege exercised.");

  // Function to create alert via API
  const createAlert = useCallback(async (type, message, severity = 'info') => {
    try {
      const response = await api.post('/api/alerts/create', { type, message, severity });
      if (response.success) {
        loadUnreadCount(); // Refresh count
        return true;
      }
    } catch (error) {
      console.error('Failed to create alert:', error);
    }
    return false;
  }, [loadUnreadCount]);

  // Utility to push alerts
  const pushAlert = (type, message) => {
    setAlerts(prev => [...prev, { id: Date.now(), type, message }]);
  };

  // Fraud & Anomaly Detection - Premium Feature
  const pushFraudAlert = (message) => {
    setFraudAlerts(prev => [...prev, { id: Date.now(), message }]);
  };

  // AI-Powered Forecasting - Premium Feature
  const forecastNextMonth = useCallback(() => {
    if (!user?.transactions) {
      return { avgIncome: 0, avgExpenses: 0, projectedSavings: 0 };
    }

    const last3Months = user.transactions.filter(tx => {
      const date = new Date(tx.date);
      return date >= new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    });

    let income = 0, expenses = 0;
    last3Months.forEach(tx => {
      if (tx.amount > 0) income += tx.amount;
      else expenses += Math.abs(tx.amount);
    });

    const avgIncome = income / 3 || 0;
    const avgExpenses = expenses / 3 || 0;
    const projectedSavings = avgIncome - avgExpenses || 0;

    return { avgIncome, avgExpenses, projectedSavings };
  }, [user?.transactions]);

  // Premium smart notifications (goal completions, forecast improvements)
  useEffect(() => {
    if (!user?.goals) return;

    const completedGoals = user.goals.filter(goal => goal.saved >= goal.target);
    if (completedGoals.length > 0 && subscription === "premium") {
      notify("success", `🎯 Goal achieved — Elite Planner status recognized for hitting ${completedGoals[0].name}!`);

      // Earn 200 points for goal completion
      completedGoals.forEach(async (goal) => {
        try {
          await api.post("/api/rewards/earn", {
            userId: user.id || user._id,
            action: "goal",
            actionId: `goal-${goal.id}-${Date.now()}`,
            points: 200,
            description: `Earned 200 points for completing goal: ${goal.name}`,
            metadata: {
              goalId: goal.id,
              goalName: goal.name,
              targetAmount: goal.target,
              savedAmount: goal.saved,
            },
            idempotencyKey: `goal-${goal.id}-${user.id || user._id}`,
          });
          console.log(`Earned 200 rewards points for goal completion: ${goal.name}`);
        } catch (error) {
          console.error("Failed to earn goal rewards points:", error);
          // Don't block the notification if rewards earning fails
        }
      });
    }
  }, [user?.goals, subscription, notify, user?.id, user?._id]);

  // Forecast improvement notifications
  useEffect(() => {
    if (!user?.transactions || user.transactions.length === 0 || subscription === "free") return;

    const forecast = forecastNextMonth();
    if (forecast.projectedSavings > 500) {
      notify("insight", `🔮 Savings trajectory improved — projected ${forecast.projectedSavings.toFixed(2)} this month.`);
    }
  }, [user, subscription, forecastNextMonth, notify]);

  // AI Alerts - Premium Feature
  useEffect(() => {
    if (subscription === "free") return;

    // Spending spike check - last 7 days
    const last7 = user?.transactions?.filter(tx => {
      const d = new Date(tx.date);
      return d >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }) || [];

    const spend = last7.filter(tx => tx.amount < 0).reduce((s, tx) => s + Math.abs(tx.amount), 0);
    if (spend > 1000) {
      pushAlert("warning", `⚠️ Spending this week is unusually high: $${spend.toFixed(2)}.`);
    }

    // Goal progress check - nearing completion
    if (user?.goals?.some(g => g.saved >= g.target * 0.8 && !g.completed)) {
      pushAlert("success", "🎯 You’re close to achieving your goal — keep pushing!");
    }

    // Card usage simulation (would trigger on actual card use)
    if (user?.lastCardUse) {
      pushAlert("card", "💳 Elite Card used — No Limit privilege exercised.");
    }
  }, [user?.transactions, user?.goals, user?.lastCardUse, subscription]);

  // Fraud & Anomaly Detection - Premium Feature
  useEffect(() => {
    if (subscription === "free" || !user?.transactions || user.transactions.length === 0) return;

    const lastTx = user.transactions[user.transactions.length - 1];
    if (!lastTx) return;

    // Rule 1: Large transaction detection
    if (Math.abs(lastTx.amount) > 5000) {
      pushFraudAlert(`🚨 Large transaction detected: $${Math.abs(lastTx.amount).toFixed(2)} - ${lastTx.label}`);
    }

    // Rule 2: Unusual category spending spike
    const categorySpend = user.transactions
      .filter(tx => tx.category === lastTx.category && tx.amount < 0)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    if (categorySpend > 2000 && (lastTx.category === "entertainment" || lastTx.category === "shopping")) {
      pushFraudAlert(`🚨 Unusual spike in ${lastTx.category} spending: $${categorySpend.toFixed(2)}`);
    }

    // Rule 3: Multiple rapid transfers
    const recent = user.transactions.filter(tx => {
      const txDate = new Date(tx.date);
      return txDate >= new Date(Date.now() - 10 * 60 * 1000); // Last 10 minutes
    });

    if (recent.length > 3) {
      pushFraudAlert(`🚨 Multiple rapid transactions detected (${recent.length} in 10 minutes)`);
    }

    // Rule 4: International transfer anomaly
    if (lastTx.category === "transfer" && Math.abs(lastTx.amount) > 1000) {
      pushFraudAlert(`🚨 Large transfer detected: $${Math.abs(lastTx.amount).toFixed(2)}`);
    }

    // Rule 5: Cash advance detection
    if (lastTx.category === "cash" && Math.abs(lastTx.amount) > 500) {
      pushFraudAlert(`🚨 Large cash advance: $${Math.abs(lastTx.amount).toFixed(2)}`);
    }
  }, [user?.transactions, subscription]);

  const [budgets, setBudgets] = useState([
    { category: "Groceries", limit: 500, spent: 0 },
    { category: "Dining", limit: 300, spent: 0 },
    { category: "Transport", limit: 200, spent: 0 },
  ]);

  // Compute spend per category for the current month
  useEffect(() => {
    if (!user?.transactions) return;

    const start = new Date();
    start.setDate(1); start.setHours(0, 0, 0, 0);
    const monthTx = user.transactions.filter(tx => new Date(tx.date) >= start);

    const updated = budgets.map(b => {
      const spent = monthTx
        .filter(tx => tx.category === b.category && tx.amount < 0)
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
      return { ...b, spent };
    });
    setBudgets(updated);
  }, [user?.transactions, budgets]);

  // Function to update budget
  const updateBudget = (updated) => {
    setBudgets(prev => prev.map(b => b.category === updated.category ? updated : b));
  };

  // Smart budget alerts with database integration
  useEffect(() => {
    const processBudgetAlerts = async () => {
      for (const b of budgets) {
        const pct = b.spent / b.limit;
        if (pct >= 1) {
          // Create critical alert for overspent budget
          await createAlert("budget", `🚨 ${b.category} budget exceeded by $${(b.spent - b.limit).toFixed(2)}!`, "critical");
        } else if (pct >= 0.8) {
          // Create warning alert for approaching budget limit
          await createAlert("budget", `⚠️ ${b.category} budget at ${Math.round(pct * 100)}%. Consider slowing down spending.`, "warning");
        }
      }

      // Always show notifications for UX (separate from alerts)
      budgets.forEach(b => {
        const pct = b.spent / b.limit;
        if (pct >= 1) {
          notify("warning", `⚠ ${b.category} budget overspent.`);
        } else if (pct >= 0.8) {
          notify("insight", `🔔 ${b.category} budget at ${Math.round(pct * 100)}%. Slow down.`);
        }
      });
    };

    if (createAlert && budgets.length > 0) {
      processBudgetAlerts();
    }
  }, [budgets, createAlert, notify]);

  const profile = {
    name: "Demo User",
    email: "demo@vaultbank.com",
    avatar: "https://ui-avatars.com/api/?name=Demo+User&background=4f46e5&color=fff"
  };

  const [goals] = useState([
    { id: 1, name: "Vacation Fund", target: 5000, saved: 4200, progress: 4200 / 5000 },
    { id: 2, name: "New Laptop", target: 1500, saved: 1200, progress: 1200 / 1500 },
    { id: 3, name: "Emergency Fund", target: 10000, saved: 7500, progress: 7500 / 10000 }
  ]);

  const [cards] = useState([
    {
      type: "Debit Card",
      number: "1234 5678 9012 3456",
      premium: false
    },
    {
      type: "Credit Card",
      number: "9876 5432 1098 7654",
      premium: true
    }
  ]);

  // Dashboard Customization States
  const [theme, setTheme] = useState("dark");
  const [premiumTheme, setPremiumTheme] = useState("default");
  const [widgets, setWidgets] = useState({
    showBudgets: true,
    showReports: true,
    showTrends: true,
    showGoals: true,
    showInsights: true,
    showReminders: true,
    showAchievements: true
  });

  // Limited-Time Offers & Urgency Banners
  const [offer, setOffer] = useState({
    active: true,
    message: "🔥 Limited Time: Upgrade to Premium today and get 50% off your first 3 months!",
    expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  });
  const [timeLeft, setTimeLeft] = useState(offer.expires - Date.now());

  // Countdown logic
  useEffect(() => {
    if (!offer.active) return;
    const interval = setInterval(() => {
      setTimeLeft(offer.expires - Date.now());
      if (timeLeft <= 0 && offer.active) {
        setOffer({ ...offer, active: false });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [offer, timeLeft]);

  // Format time function
  const formatTime = (ms) => {
    const h = Math.floor(ms / (1000 * 60 * 60));
    const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((ms % (1000 * 60)) / 1000);
    return `${h}h ${m}m ${s}s`;
  };



  useEffect(() => {
    const token = localStorage.getItem("token");

    if (!token) {
      console.error("No token found");
      setLoading(false);
      return;
    }

    const fetchUserData = async () => {
      try {
        // Try new API endpoint first
        let response;
        try {
          response = await api.get("/api/profile");
        } catch (apiError) {
          console.warn("New API endpoint failed, trying legacy endpoint:", apiError);
          // Fallback to legacy endpoint
          response = await api.get("/auth/me");
        }

        // Ensure user data has required structure
        const userData = {
          ...response.user || response,
          balance: response.user?.balance || response.balance || 0,
          transactions: response.user?.transactions || response.transactions || [],
          summary: response.user?.summary || response.summary || {
            totalIncome: 0,
            totalExpenses: 0,
            netSavings: 0
          },
          email: response.user?.email || response.email || "demo@vaultbank.com",
          name: response.user?.name || response.name || "Demo User"
        };

        setUser(userData);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching user:", err);
        // Fallback to demo data if API fails
        const demoUser = {
          email: "demo@vaultbank.com",
          name: "Demo User",
          balance: 5230.50,
          transactions: [
            { label: "Salary Deposit", amount: 2000, date: "2025-10-01", category: "income" },
            { label: "Rent Payment", amount: -500, date: "2025-10-05", category: "housing" },
            { label: "Cashback Bonus", amount: 150, date: "2025-10-10", category: "reward" },
            { label: "Groceries", amount: -250, date: "2025-10-12", category: "food" }
          ],
          summary: {
            totalIncome: 2150,
            totalExpenses: 750,
            netSavings: 1400
          }
        };
        setUser(demoUser);
        setLoading(false);
      }
    };

    fetchUserData();
  }, []);

  // Generate user's referral code
  const referralCode = user?.email ? `VB-${user.email.split('@')[0].toUpperCase()}-${Date.now().toString().slice(-4)}` : '';

  // Calculate totals with safe fallbacks
  const totalIncome = user?.summary?.totalIncome || 0;
  const totalExpenses = user?.summary?.totalExpenses || 0;
  const netSavings = user?.summary?.netSavings || 0;

  // Calculate monthly report
  const calculateMonthlyReport = () => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let income = 0, expenses = 0, rewards = 0;

    user?.transactions?.forEach(tx => {
      const txDate = new Date(tx.date);
      if (txDate.getMonth() === currentMonth && txDate.getFullYear() === currentYear) {
        if (tx.amount > 0 && tx.category === "income") income += tx.amount;
        else if (tx.amount > 0 && tx.category === "reward") rewards += tx.amount;
        else if (tx.amount < 0) expenses += Math.abs(tx.amount);
      }
    });

    return {
      income,
      expenses,
      rewards,
      savings: income + rewards - expenses
    };
  };

  const report = calculateMonthlyReport();

  // Get monthly trends for line chart
  const getMonthlyTrends = () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let summary = {};

    // Check if user and transactions exist before processing
    if (user?.transactions) {
      user.transactions.forEach(tx => {
        const date = new Date(tx.date);
        const key = `${months[date.getMonth()]} ${date.getFullYear()}`;
        if (!summary[key]) summary[key] = { income: 0, expenses: 0 };
        if (tx.amount > 0 && tx.category === "income") summary[key].income += tx.amount;
        else if (tx.amount < 0) summary[key].expenses += Math.abs(tx.amount);
      });
    }

    const labels = Object.keys(summary);
    const incomeData = labels.map(l => summary[l].income || 0);
    const expenseData = labels.map(l => summary[l].expenses || 0);

    return { labels, incomeData, expenseData };
  };

  const trends = getMonthlyTrends();

  // Calculate Premium Analytics
  const calculateAnalytics = () => {
    if (!user?.transactions || !Array.isArray(user.transactions)) {
      return { income: 0, expenses: 0, categories: {}, profitLossRatio: 0 };
    }

    let income = 0, expenses = 0;
    let categories = {};

    user.transactions.forEach(tx => {
      if (tx.amount > 0 && tx.category === "income") income += tx.amount;
      else if (tx.amount < 0) expenses += Math.abs(tx.amount);

      if (!categories[tx.category]) categories[tx.category] = 0;
      categories[tx.category] += Math.abs(tx.amount);
    });

    const profitLossRatio = income > 0 ? ((income - expenses) / income) * 100 : 0;

    return { income, expenses, categories, profitLossRatio };
  };

  const analytics = calculateAnalytics();

  // Generate AI-style financial insights
  const generateInsights = () => {
    if (!user?.transactions) return [];

    let insights = [];
    const now = new Date();
    const currentMonth = now.getMonth();
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const currentYear = now.getFullYear();
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    const sumByMonth = (month, year, filterFn) =>
      user.transactions
        .filter(tx => {
          if (!tx.date) return false;
          const d = new Date(tx.date);
          return d.getMonth() === month && d.getFullYear() === year && filterFn(tx);
        })
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    // Food spending comparison
    const foodThisMonth = sumByMonth(currentMonth, currentYear, tx => tx.category === "food");
    const foodLastMonth = sumByMonth(lastMonth, lastMonthYear, tx => tx.category === "food");

    if (foodLastMonth > 0) {
      const diff = ((foodThisMonth - foodLastMonth) / foodLastMonth) * 100;
      if (diff < -10) insights.push(`🥗 Excellent! You spent ${Math.abs(diff).toFixed(1)}% less on food this month vs last.`);
      else if (diff > 10) insights.push(`🍔 You spent ${diff.toFixed(1)}% more on food this month. Watch your dining habits.`);
      else insights.push(`🍽️ Food spending is stable compared to last month.`);
    }

    // Income vs expenses ratio
    const income = sumByMonth(currentMonth, currentYear, tx => tx.category === "income" && tx.amount > 0);
    const expenses = sumByMonth(currentMonth, currentYear, tx => tx.amount < 0);

    if (income > 0) {
      const expenseRatio = (expenses / income) * 100;
      if (expenseRatio > 75) {
        insights.push("🔴 ALERT: Your expenses are over 75% of income! Cut back immediately.");
      } else if (expenseRatio > 50) {
        insights.push("⚠️ WARNING: Housing + expenses exceed 50% of income. Tight budgeting needed.");
      } else if (expenseRatio < 30) {
        insights.push("💰 Fantastic! You have great financial discipline with expenses under 30% of income.");
      }
    }

    // Savings achievement
    const savings = income - expenses;
    if (savings > 500) {
      insights.push("🎉 Outstanding savings! You're building wealth fast - keep it up!");
    } else if (savings > 0) {
      insights.push("👍 Good job saving this month! Small consistent wins add up.");
    } else if (savings < -500) {
      insights.push("🚨 Spending alert! You've gone over budget significantly.");
    }

    // Transportation insights
    const transportThisMonth = sumByMonth(currentMonth, currentYear, tx => tx.category === "transport");

    if (transportThisMonth > 300) {
      insights.push("🚗 Consider carpooling or public transport - high transport costs detected.");
    }

    // Reward bonuses
    const rewardsThisMonth = sumByMonth(currentMonth, currentYear, tx => tx.category === "reward" && tx.amount > 0);

    if (rewardsThisMonth > 100) {
      insights.push("🎁 Bonus alert! Great cashback this month from your spending habits.");
    }

    // Housing percentage
    const housingThisMonth = sumByMonth(currentMonth, currentYear, tx => tx.category === "housing");
    const housingRatio = (housingThisMonth / income) * 100;

    if (housingRatio > 35 && housingThisMonth > 0) {
      insights.push("🏠 Housing costs are relatively high. Consider optimizing rent/utility expenses.");
    }

    // Overall financial health
    if (insights.length === 0) {
      insights.push("📊 Your finances look stable. Keep tracking and you may unlock more insights!");
    }

    return insights;
  };

  const insights = generateInsights();

  // Generate goal reminders
  const generateGoalReminders = () => {
    return goals.map(goal => {
      const percent = (goal.saved / goal.target) * 100;
      if (percent >= 100) return `🏆 Goal completed: ${goal.name}!`;
      if (percent >= 80) return `🎯 Almost there! ${goal.name} is ${percent.toFixed(0)}% funded.`;
      if (percent >= 50) return `🚀 Great progress! ${goal.name} is halfway done.`;
      return null;
    }).filter(Boolean);
  };

  const goalReminders = generateGoalReminders();

  // Generate Personalized AI Insights
  const generatePersonalizedInsights = () => {
    if (!user?.transactions || user.transactions.length === 0) {
      return ["Welcome to VaultBank! Start adding transactions to get personalized financial insights."];
    }

    let insights = [];
    const lastMonth = user.transactions.filter(tx => {
      const date = new Date(tx.date);
      return date >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    });

    const dining = lastMonth.filter(tx => tx.category === "food" || tx.category === "dining")
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    const groceries = lastMonth.filter(tx => tx.category === "groceries" || tx.category === "food")
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    if (dining > 300) {
      insights.push(`🍽 You spent $${dining.toFixed(2)} on dining. Cutting 10% could save you $${(dining * 0.1).toFixed(2)} this month.`);
    }

    if (groceries > 500) {
      insights.push(`🛒 Grocery spend is $${groceries.toFixed(2)}. Consider setting a tighter budget to save more.`);
    }

    if (user.goals && user.goals.length > 0) {
      insights.push(`🎯 You’re on track to hit your goal "${user.goals[0].name}" earlier than expected. Keep it up!`);
    }

    const subscriptions = lastMonth.filter(tx => tx.category === "subscription" || tx.category === "services")
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    if (subscriptions > 100) {
      insights.push(`📺 Monthly subscriptions total $${subscriptions.toFixed(2)}. Review if you're getting value for all of them.`);
    }

    const cashAdvances = lastMonth.filter(tx => tx.category === "cash" || tx.amount === -500).length;
    if (cashAdvances > 0) {
      insights.push(`💸 Avoid cash advances - they cost you significant interest and fees.`);
    }

    if (insights.length === 0) {
      insights.push("✅ Your spending looks balanced. Keep building wealth!");
    }

    return insights.slice(0, 4); // Limit to 4 insights max
  };

  const personalizedInsights = generatePersonalizedInsights();

  // Generate AI-Suggested Savings Goals
  const suggestGoals = () => {
    if (!user?.transactions || user.transactions.length === 0) {
      return [{ name: "Emergency Fund", target: 1000, timeline: "3 months" }];
    }

    let goals = [];
    const lastMonth = user.transactions.filter(tx => {
      const date = new Date(tx.date);
      return date >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    });

    const income = lastMonth.filter(tx => tx.amount > 0)
      .reduce((sum, tx) => sum + tx.amount, 0);

    const expenses = lastMonth.filter(tx => tx.amount < 0)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    const savingsPotential = income - expenses;

    if (savingsPotential > 500) {
      goals.push({ name: "Emergency Fund", target: 1000, timeline: "2 months" });
    }

    if (expenses > income * 0.7) {
      goals.push({ name: "Cut Expenses by 10%", target: Math.round(expenses * 0.9), timeline: "1 month" });
    }

    if (income > 3000) {
      goals.push({ name: "Vacation Savings", target: 1500, timeline: "6 months" });
    }

    // Additional smart suggestions based on patterns
    const housingCost = lastMonth.filter(tx => tx.category === "housing")
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    if (housingCost < income * 0.3 && income > 2000) {
      goals.push({ name: "Investment Fund", target: 2000, timeline: "4 months" });
    }

    const entertainmentCost = lastMonth.filter(tx => tx.category === "entertainment")
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    if (entertainmentCost > 200 && expenses > income * 0.8) {
      goals.push({ name: "Entertainment Budget", target: Math.round(expenses * 0.05), timeline: "1 month" });
    }

    if (goals.length === 0) {
      goals.push({ name: "General Savings", target: Math.max(500, Math.round(savingsPotential * 0.5)), timeline: "3 months" });
    }

    return goals.slice(0, 3); // Limit to 3 suggestions max
  };

  const suggestedGoals = suggestGoals();

  // Generate Achievement Badges
  const calculateBadges = () => {
    if (!user?.transactions || user.transactions.length === 0) {
      return ["📝 Start your financial journey — add your first transaction to unlock badges!"];
    }

    let badges = [];

    const totalSavings = user.transactions
      .filter(tx => tx.amount > 0)
      .reduce((sum, tx) => sum + tx.amount, 0);

    if (totalSavings >= 1000) {
      badges.push("🥉 Bronze Saver — Saved first $1,000");
    }
    if (totalSavings >= 5000) {
      badges.push("🥈 Silver Saver — Saved $5,000");
    }
    if (totalSavings >= 10000) {
      badges.push("🥇 Gold Saver — Saved $10,000");
    }

    const consistentBudgeting = user.transactions.length > 20;
    if (consistentBudgeting) {
      badges.push("🏆 Wealth Builder — Consistent budgeting for 3 months");
    }

    const goalsCompleted = goals.filter(g => g.saved >= g.target).length;
    if (goalsCompleted > 0) {
      badges.push("💎 Goal Crusher — Completed " + goalsCompleted + " saving goal" + (goalsCompleted > 1 ? "s" : ""));
    }

    const noOverspending = !user.transactions.some(tx => tx.category === "cash" && tx.amount === -500);
    if (noOverspending && user.transactions.length > 10) {
      badges.push("🛡️ Budget Guardian — Avoided costly cash advances");
    }

    const smartCategories = user.transactions.filter(tx => tx.category !== "other").length;
    if (smartCategories > user.transactions.length * 0.8) {
      badges.push("📊 Category Master — Keep transactions well-organized");
    }

    if (badges.length === 0) {
      badges.push("🌱 Financial Seedling — You're just getting started! Keep building habits.");
    }

    return badges.slice(0, 4); // Limit to 4 badges max
  };

  const badges = calculateBadges();

  // Share Badge Component
  const ShareBadge = ({ badge, className = "" }) => {
    const shareText = `🏅 I just unlocked the "${badge}" achievement on VaultBank — the luxury banking app for serious wealth! 💎💰`;
    const shareUrl = "https://vaultbank.com"; // Replace with real VaultBank URL

    return (
      <div className={`flex flex-wrap gap-2 mt-2 ${className}`}>
        <TwitterShareButton url={shareUrl} title={shareText}>
          <button className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition-colors">
            🐦 Twitter
          </button>
        </TwitterShareButton>
        <WhatsappShareButton url={shareUrl} title={shareText}>
          <button className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600 transition-colors">
            💬 WhatsApp
          </button>
        </WhatsappShareButton>
        <LinkedinShareButton url={shareUrl} title={shareText}>
          <button className="px-3 py-1 bg-blue-700 text-white rounded text-sm hover:bg-blue-800 transition-colors">
            💼 LinkedIn
          </button>
        </LinkedinShareButton>
      </div>
    );
  };

  // Remove old CardComponent - using VirtualCard now

  const categoryIcon = (category) => {
    const icons = {
      income: "💰",
      housing: "🏠",
      food: "🍔",
      reward: "🎁",
      transfer: "💸",
      default: "📌"
    };
    return icons[category] || icons.default;
  };

  const categoryColor = (category) => {
    const colors = {
      income: "text-green-400",
      housing: "text-blue-400",
      food: "text-yellow-400",
      reward: "text-purple-400",
      transfer: "text-red-400",
      default: "text-gray-400"
    };
    return colors[category] || colors.default;
  };

  const chartData = {
    labels: ["Income", "Expenses"],
    datasets: [
      {
        data: [totalIncome || 0, totalExpenses || 0],
        backgroundColor: ["#22c55e", "#ef4444"],
        borderColor: ["#16a34a", "#b91c1c"],
        borderWidth: 1,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
      },
    },
    animation: {
      animateRotate: true,
      animateScale: true,
      duration: 1000,
      easing: 'easeOutBounce'
    }
  };

  const barData = user?.transactions?.length > 0 ? {
    labels: user.transactions.map(tx => tx.date || 'N/A'),
    datasets: [
      {
        label: "Transaction Amounts",
        data: user.transactions.map(tx => Math.abs(tx.amount || 0)),
        backgroundColor: user.transactions.map(tx =>
          (tx.amount || 0) < 0 ? "#ef4444" : "#22c55e"
        ),
      },
    ],
  } : {
    labels: ['No Data'],
    datasets: [{
      label: "Transaction Amounts",
      data: [0],
      backgroundColor: ["#4b5563"],
    }]
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: "Transactions Over Time",
        color: '#fff'
      },
    },
    animation: {
      duration: 1200,
      easing: 'easeInOutQuart'
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { color: '#9ca3af' },
        grid: { color: '#374151' }
      },
      x: {
        ticks: { color: '#9ca3af' },
        grid: { color: '#374151' }
      }
    }
  };



  const categorizeTransaction = (label) => {
    const lower = label.toLowerCase();

    // Income categories
    if (lower.includes("salary") || lower.includes("deposit") || lower.includes("payroll") ||
      lower.includes("wage") || lower.includes("income") || lower.includes("payment") ||
      lower.includes("received")) {
      return "income";
    }

    // Housing categories
    if (lower.includes("rent") || lower.includes("mortgage") || lower.includes("utility") ||
      lower.includes("electric") || lower.includes("water") || lower.includes("gas") ||
      lower.includes("internet") || lower.includes("phone") || lower.includes("housing")) {
      return "housing";
    }

    // Food categories
    if (lower.includes("grocery") || lower.includes("supermarket") || lower.includes("restaurant") ||
      lower.includes("food") || lower.includes("dining") || lower.includes("meal") ||
      lower.includes("cafe") || lower.includes("coffee") || lower.includes("eat")) {
      return "food";
    }

    // Entertainment categories
    if (lower.includes("movie") || lower.includes("cinema") || lower.includes("netflix") ||
      lower.includes("spotify") || lower.includes("entertainment") || lower.includes("game") ||
      lower.includes("theater") || lower.includes("concer") || lower.includes("event")) {
      return "entertainment";
    }

    // Reward/Bonus categories
    if (lower.includes("bonus") || lower.includes("cashback") || lower.includes("reward") ||
      lower.includes("refund") || lower.includes("credit") || lower.includes("rebate")) {
      return "reward";
    }

    // Transport categories
    if (lower.includes("uber") || lower.includes("lyft") || lower.includes("taxi") ||
      lower.includes("bus") || lower.includes("train") || lower.includes("metro") ||
      lower.includes("subway") || lower.includes("gas") || lower.includes("fuel") ||
      lower.includes("parking") || lower.includes("transit") || lower.includes("transport")) {
      return "transport";
    }

    // Transfer categories
    if (lower.includes("transfer") || lower.includes("atm") || lower.includes("withdrawal") ||
      lower.includes("sent") || lower.includes("wire") || lower.includes("p2p")) {
      return "transfer";
    }

    // Shopping categories
    if (lower.includes("amazon") || lower.includes("shopping") || lower.includes("purchase") ||
      lower.includes("buy") || lower.includes("store") || lower.includes("mall")) {
      return "shopping";
    }

    // Default category
    return "other";
  };

  const exportTransactions = () => {
    if (!user?.transactions || user.transactions.length === 0) {
      alert("No transactions to export!");
      return;
    }

    const headers = ["Date", "Label", "Category", "Amount"];
    const rows = user.transactions.map(tx => [
      tx.date || "N/A",
      tx.label || "N/A",
      tx.category || "Uncategorized",
      tx.amount || 0
    ]);

    let csvContent =
      "data:text/csv;charset=utf-8," +
      [headers, ...rows].map(e => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "vaultbank_transactions.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      complete: (results) => {
        const imported = results.data.map(row => ({
          id: Date.now() + Math.random(),
          date: row.Date || row.date,
          label: row.Label || row.label || "Imported Transaction",
          category: row.Category || row.category || categorizeTransaction(row.Label || row.label || ""),
          amount: parseFloat(row.Amount || row.amount) || 0
        }));

        setUser(prev => ({
          ...prev,
          transactions: [...imported, ...(prev.transactions || [])]
        }));

        alert(`Successfully imported ${imported.length} transactions!\n\nAuto-categorized using smart detection based on transaction labels.`);
      },
      error: (error) => {
        console.error("CSV parsing error:", error);
        alert("Error importing CSV file. Please check the format.");
      }
    });
  };

  const exportToExcel = () => {
    if (!user?.transactions || user.transactions.length === 0) {
      alert("No transactions to export!");
      return;
    }

    const ws = XLSX.utils.json_to_sheet(user.transactions);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");

    // Add header styling
    ws["A1"].s = { font: { bold: true }, fill: { fgColor: { rgb: "FFD700" } } };

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([wbout], { type: "application/octet-stream" }), "VaultBank_Report.xlsx");
  };

  // Filter transactions with safe checks
  const filteredTransactions = user?.transactions?.filter((tx) => {
    const searchLower = search.toLowerCase();
    return (
      (tx.label || '').toLowerCase().includes(searchLower) ||
      (tx.category || '').toLowerCase().includes(searchLower) ||
      (tx.date || '').includes(search)
    );
  }) || [];

  // Sort filtered transactions
  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    if (sortBy === "date") {
      return new Date(b.date || 0) - new Date(a.date || 0);
    }
    if (sortBy === "amount") {
      return Math.abs(b.amount || 0) - Math.abs(a.amount || 0);
    }
    if (sortBy === "category") {
      return (a.category || '').localeCompare(b.category || '');
    }
    return 0;
  });


  const forecast = forecastNextMonth();


  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${darkMode ? "bg-gray-900" : "bg-gray-50"}`}>
        <div className="text-center">
          <h2 className={`text-2xl animate-pulse mb-4 ${darkMode ? "text-yellow-400" : "text-yellow-600"}`}>
            Loading VaultBank Dashboard...
          </h2>
          <div className={`animate-spin rounded-full h-12 w-12 border-b-2 mx-auto ${darkMode ? "border-yellow-400" : "border-yellow-500"}`}></div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${darkMode ? "bg-gray-900" : "bg-gray-50"}`}>
        <div className="text-center">
          <p className={`text-xl mb-4 ${darkMode ? "text-red-400" : "text-red-600"}`}>Could not load user details.</p>
          <button
            onClick={() => window.location.href = '/login'}
            className={`px-6 py-2 rounded font-semibold ${darkMode ? "bg-blue-600 hover:bg-blue-700" : "bg-blue-500 hover:bg-blue-600"}`}
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  // Show onboarding if not completed - AFTER all hooks but before dashboard render

  return (
    <div className={`min-h-screen py-8 px-4 ${premiumTheme === "darkGold" ? "theme-darkGold" :
      premiumTheme === "luxuryGlass" ? "theme-luxuryGlass" :
        (subscription === "premium" || subscription === "trial") ? "theme-luxury" :
          (theme === "dark" ? "bg-gray-900 text-white" :
            theme === "light" ? "bg-gray-100 text-gray-900" :
              "bg-gradient-to-br from-gray-900 via-indigo-900 to-purple-900 text-white")
      }`}>
      <LuxurySidebar />
      <div className="max-w-6xl mx-auto md:ml-20 lg:ml-64">
        {/* Glass effect background overlay */}
        <div className="fixed inset-0 bg-white/5 backdrop-blur-md -z-10"></div>

        {/* Header with Profile */}
        <div className="flex justify-between items-start mb-8">
          {/* Main Header */}
          <div className="text-center flex-1">
            <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent">
              Welcome to VaultBank 💎
              <span className={`ml-2 px-2 py-1 rounded text-xs ${subscription === "premium" ? "bg-yellow-400 text-black" : "bg-gray-600 text-white"}`}>
                {subscription.toUpperCase()}
              </span>
            </h1>
            <p className={`text-xl ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Hello, {user.email}</p>
            <p className="text-3xl text-green-400 mt-2 font-bold">
              ${(user.balance || 0).toFixed(2)}
            </p>
          </div>

          {/* User Profile & Settings */}
          <div className="flex-shrink-0 flex items-center space-x-4">
            {/* Notification Bell with Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-3 rounded-lg hover:bg-gray-700 transition-all duration-200 hover:scale-110"
              >
                🔔
                {unreadAlertsCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs px-2 py-1 rounded-full min-w-[20px] text-center font-semibold animate-pulse">
                    {unreadAlertsCount}
                  </span>
                )}
              </button>

              {/* Notification Dropdown */}
              <NotificationDropdown
                isOpen={showNotifications}
                onClose={() => setShowNotifications(false)}
              />
            </div>

            <div className="flex items-center space-x-3 bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-700">
              <img
                src={profile.avatar}
                alt="avatar"
                className="w-12 h-12 rounded-full border-2 border-indigo-500 hover:border-indigo-400 transition-colors"
              />
              <div>
                <p className="font-semibold text-white">{profile.name}</p>
                <p className="text-sm text-gray-400">{profile.email}</p>
              </div>
            </div>
            <div className="flex flex-col space-y-2">
              <button
                onClick={() => alert("⚙️ Settings panel coming soon! Account preferences, avatar upload, theme toggle, and more premium features on the way!")}
                className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-md hover:shadow-lg text-sm"
              >
                ⚙️ Settings
              </button>
              <button
                onClick={() => alert("🔐 Biometric authentication coming soon! Use your fingerprint or face to securely access your VaultBank account.")}
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-md hover:shadow-lg text-sm"
              >
                🔐 Biometric Login
              </button>
            </div>
          </div>
        </div>

        {/* Alerts Center */}
        {showCenter && (
          <AlertsCenter onClose={() => setShowCenter(false)} />
        )}

        {/* Notification Dropdown */}
        <NotificationDropdown
          isOpen={showNotifications}
          onClose={() => setShowNotifications(false)}
        />

        {/* Dashboard Customization Panel */}
        <div className={`luxury-card p-6 mt-6 shadow-xl max-w-4xl mx-auto ${darkMode ? "backdrop-blur-xl bg-gray-800/80 border border-white/10" : "bg-white/90 backdrop-blur-lg border border-gray-200/50"} rounded-xl`}>
          <h2 className={`text-2xl font-semibold mb-6 text-center ${darkMode ? "" : "text-gray-900"}`}>🎨 Dashboard Customization</h2>

          {/* Subscription Toggle */}
          <div className="mb-6">
            <h3 className={`text-lg font-semibold mb-3 text-center ${darkMode ? "text-gray-200" : "text-gray-800"}`}>Subscription Plan</h3>
            <div className="flex space-x-3 justify-center mt-4">
              <button
                onClick={() => setSubscription("free")}
                className={`px-4 py-2 rounded ${subscription === "free" ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-300"}`}
              >
                Free
              </button>
              <button
                onClick={() => setSubscription("premium")}
                className={`px-4 py-2 rounded ${subscription === "premium" ? "bg-yellow-500 text-black" : "bg-gray-700 text-gray-300"}`}
              >
                Premium
              </button>
            </div>
          </div>

          {/* Trial/Premium Highlight Banner */}
          {(subscription === "premium" || subscription === "trial") && (
            <div className="bg-gradient-to-r from-yellow-400 to-orange-500 text-black font-bold p-3 rounded mt-4 shadow-lg">
              {subscription === "trial" ? (
                <>🚀 Premium Trial Active — You’re experiencing VaultBank at full power. This is not a gift, it’s a glimpse of how serious people run money.</>
              ) : (
                <>🚀 Premium Active — Your money is now working like a business asset.</>
              )}
            </div>
          )}

          {/* Trial/Premium messaging */}
          {(subscription === "premium" || subscription === "trial") && (
            <p className="mt-4 text-sm text-yellow-400 font-semibold">
              {subscription === "trial" ? (
                <>Premium isn’t just a trial — it’s a strategy. See how serious money management unlocks your financial potential.</>
              ) : (
                <>Premium isn’t an upgrade — it’s a strategy. Unlock AI Insights, Goal Reminders, and Trend Reports designed for people who treat money like business. This is where serious growth happens.</>
              )}
            </p>
          )}

          {/* Referral Rewards - Premium Feature */}
          {(subscription === "premium" || subscription === "trial") && (
            <div className="bg-gradient-to-r from-yellow-500 to-orange-600 text-black p-4 rounded mt-4 shadow-lg">
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-2xl">🎁</span>
                <span className="font-bold">Referral Rewards Program</span>
              </div>
              <p className="text-sm mb-2">
                Invite friends to join VaultBank Premium and earn <strong>$10 credit</strong> for each successful referral!
              </p>
              <div className="text-xs space-y-1">
                <p>• Share your unique referral link</p>
                <p>• Friends get Premium access</p>
                <p>• You earn $10 per successful referral</p>
              </div>
              <button
                onClick={() => alert("🔗 Referral link copied! Share with friends to earn $10 per successful Premium signup.")}
                className="mt-3 px-4 py-2 bg-black text-yellow-400 rounded font-semibold hover:bg-gray-800 transition-colors"
              >
                📤 Copy Referral Link
              </button>
            </div>
          )}

          {/* Theme Selector */}
          <div className="mb-6">
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? "text-gray-200" : "text-gray-800"}`}>Choose Theme</h3>
            <div className="flex space-x-2 flex-wrap gap-2">
              <button
                onClick={() => setTheme("dark")}
                className={`px-4 py-2 rounded font-semibold transition-all duration-300 ${theme === "dark"
                  ? "bg-indigo-600 text-white shadow-lg scale-105"
                  : "bg-gray-800 text-white hover:bg-gray-700 hover:scale-105"
                  }`}
              >
                🌙 Dark
              </button>
              <button
                onClick={() => setTheme("light")}
                className={`px-4 py-2 rounded font-semibold transition-all duration-300 ${theme === "light"
                  ? "bg-indigo-600 text-white shadow-lg scale-105"
                  : "bg-gray-200 text-black hover:bg-gray-300 hover:scale-105"
                  }`}
              >
                ☀️ Light
              </button>
              <button
                onClick={() => setTheme("gradient")}
                className={`px-4 py-2 rounded font-semibold transition-all duration-300 ${theme === "gradient"
                  ? "bg-indigo-600 text-white shadow-lg scale-105"
                  : "bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:scale-105"
                  }`}
              >
                ✨ Gradient
              </button>
            </div>
          </div>

          {/* Premium Dashboard Themes - Premium Only */}
          {subscription === "premium" || subscription === "trial" ? (
            <div className="mb-6">
              <h3 className={`text-lg font-semibold mb-3 ${darkMode ? "text-gray-200" : "text-gray-800"}`}>🎨 Premium Dashboard Themes</h3>
              <div className="flex space-x-3 mt-4">
                <button
                  onClick={() => setPremiumTheme("default")}
                  className={`px-4 py-2 rounded ${premiumTheme === "default" ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-300"}`}
                >
                  Default
                </button>
                <button
                  onClick={() => setPremiumTheme("darkGold")}
                  className={`px-4 py-2 rounded ${premiumTheme === "darkGold" ? "bg-yellow-600 text-black" : "bg-gray-700 text-gray-300"}`}
                >
                  🏅 Gold
                </button>
                <button
                  onClick={() => setPremiumTheme("luxuryGlass")}
                  className={`px-4 py-2 rounded ${premiumTheme === "luxuryGlass" ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-300"}`}
                >
                  💎 Glass
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-gray-700 text-gray-300 p-3 rounded mt-4 mb-6">
              🔒 Unlock Premium to access exclusive dashboard themes.
            </div>
          )}

          {/* Widget Visibility Toggles */}
          <div className="mb-6">
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? "text-gray-200" : "text-gray-800"}`}>Widget Visibility</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.keys(widgets).map(key => (
                <label key={key} className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={widgets[key]}
                    onChange={() => setWidgets(prev => ({ ...prev, [key]: !prev[key] }))}
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                  <span className={`${darkMode ? "text-gray-300" : "text-gray-700"} text-sm font-medium`}>
                    {key.replace("show", "").replace(/([A-Z])/g, ' $1').toLowerCase()}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Actions Bar */}
        <div className="flex flex-wrap justify-center gap-4 mt-6">
          <button
            onClick={() => alert("🚀 Quick Add Transaction feature coming soon! You can: \n1. Manual entry \n2. OCR from receipt photos \n3. Voice input \n4. SMS banking imports")}
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 transform"
          >
            ➕ Quick Add Transaction
          </button>
          <button
            onClick={() => alert("💸 Transfer feature enhanced! Includes:\n1. Instant P2P transfers\n2. International wire transfers\n3. Recurring payments\n4. Transfer history")}
            className="px-6 py-3 bg-gradient-to-r from-green-500 to-teal-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 transform"
          >
            💸 Instant Transfer
          </button>
          <button
            onClick={exportTransactions}
            className="px-6 py-3 bg-gradient-to-r from-yellow-500 to-orange-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 transform"
          >
            ⬇️ Smart Export
          </button>
          <button
            onClick={() => alert("🎯 Budget Insights:\n• Monthly spending analysis\n• Category breakdown\n• Budget recommendations\n• Automated alerts")}
            className="px-6 py-3 bg-gradient-to-r from-pink-500 to-red-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 transform"
          >
            🎯 Budget Insights
          </button>
        </div>

        {/* Limited-Time Urgency Banner */}
        {offer.active && timeLeft > 0 && (
          <div className="bg-gradient-to-r from-red-600 to-yellow-500 text-black font-bold p-4 rounded-lg shadow-lg animate-pulse mt-4 mb-6">
            {offer.message} ⏳ Ends in {formatTime(timeLeft)}
          </div>
        )}

        {/* Smart Notifications/Alerts */}
        <div className="space-y-2 mb-6">
          {notifications.map((note, index) => (
            <div
              key={note.id}
              className={`p-3 rounded shadow-md transition-all duration-500 animate-fadeInDown ${note.type === "success"
                ? "bg-green-600 text-white"
                : note.type === "warning"
                  ? "bg-yellow-500 text-black"
                  : "bg-blue-600 text-white"
                }`}
            >
              {note.message}
            </div>
          ))}
        </div>

        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Monthly Summary Card */}
          <div className={`luxury-card p-6 transition-transform duration-300 hover:scale-105 cursor-pointer ${darkMode ? "backdrop-blur-xl bg-gray-800/80 border border-white/10" : "bg-white/90 backdrop-blur-lg border border-gray-200/50"} rounded-xl`}>
            <h2 className={`text-2xl font-semibold mb-4 text-center ${darkMode ? "" : "text-gray-900"}`}>Monthly Summary</h2>
            <div className="space-y-2 mb-4">
              <p className="text-green-400 text-lg">Income: +${totalIncome.toFixed(2)}</p>
              <p className="text-red-400 text-lg">Expenses: -${totalExpenses.toFixed(2)}</p>
              <p className="text-yellow-400 font-bold text-xl">Net Savings: ${netSavings.toFixed(2)}</p>
            </div>

            {/* Pie Chart */}
            <div className="mt-6 max-w-xs mx-auto transition-opacity duration-700 ease-in opacity-0 animate-fadeIn">
              <Pie data={chartData} options={chartOptions} />
            </div>
          </div>

          {/* Bar Chart */}
          <div className={`luxury-card p-6 transition-all duration-700 hover:scale-105 cursor-pointer ease-in opacity-0 animate-fadeIn ${darkMode ? "backdrop-blur-xl bg-gray-800/80 border border-white/10" : "bg-white/90 backdrop-blur-lg border border-gray-200/50"} rounded-xl`}>
            <Bar data={barData} options={barOptions} />
          </div>
        </div>

        {/* Advanced Transfer System */}
        <Transfer
          subscription={subscription}
          user={user}
          onTransactionAdd={(transaction) => {
            setUser(prev => ({
              ...prev,
              transactions: [transaction, ...(prev.transactions || [])],
              balance: prev.balance - transaction.amount
            }));
          }}
        />
        {/* Transfer History Component */}
        <TransferHistory />

        {/* Weekly Digest Summary - Premium Feature */}
        {subscription === "premium" || subscription === "trial" ? (
          <WeeklyDigest
            user={user}
            transactions={user.transactions || []}
            goals={user.goals || []}
            badges={badges}
            alerts={alerts}
            fraudAlerts={fraudAlerts}
          />
        ) : (
          <div className="bg-gray-700 text-gray-300 p-4 rounded mt-6">
            🔒 Unlock Premium to receive your personalized Weekly Digest with insights, achievements, and financial summaries.
          </div>
        )}

        {/* Monthly Report Card */}
        {widgets.showReports && (
          <div className={`${darkMode ? "bg-gray-800" : "bg-white"} rounded-lg p-6 mt-6 shadow-xl max-w-lg mx-auto`}>
            <h2 className={`text-2xl font-semibold mb-6 text-center ${darkMode ? "" : "text-gray-900"}`}>📅 Monthly Report</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-green-600/20 p-3 rounded text-center">
                <p className="text-green-400 font-semibold text-sm">Income</p>
                <p className="text-lg font-bold text-white">${report.income.toFixed(2)}</p>
              </div>
              <div className="bg-red-600/20 p-3 rounded text-center">
                <p className="text-red-400 font-semibold text-sm">Expenses</p>
                <p className="text-lg font-bold text-white">${report.expenses.toFixed(2)}</p>
              </div>
              <div className="bg-purple-600/20 p-3 rounded text-center">
                <p className="text-purple-400 font-semibold text-sm">Rewards</p>
                <p className="text-lg font-bold text-white">${report.rewards.toFixed(2)}</p>
              </div>
              <div className="bg-blue-600/20 p-3 rounded text-center">
                <p className="text-blue-400 font-semibold text-sm">Net Savings</p>
                <p className={`text-lg font-bold ${report.savings >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${report.savings.toFixed(2)}
                </p>
              </div>
            </div>
            <div className="mt-4 text-center text-sm text-gray-400">
              {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })} Summary
            </div>
          </div>
        )}

        {/* Trend Chart - Premium Feature */}
        {(subscription === "premium" || subscription === "trial") && widgets.showTrends && (
          <div className={`${darkMode ? "bg-gray-800" : "bg-white"} rounded-lg p-6 mt-6 shadow-xl w-full max-w-4xl mx-auto`}>
            <h2 className={`text-2xl font-semibold mb-6 text-center ${darkMode ? "" : "text-gray-900"}`}>📈 Income vs Expenses Trend</h2>
            <div className="transition-opacity duration-700 ease-in opacity-0 animate-fadeIn">
              <Line
                data={{
                  labels: trends.labels,
                  datasets: [
                    {
                      label: "Income",
                      data: trends.incomeData,
                      borderColor: "rgb(34,197,94)", // green
                      backgroundColor: "rgba(34,197,94,0.2)",
                      tension: 0.3,
                      fill: true
                    },
                    {
                      label: "Expenses",
                      data: trends.expenseData,
                      borderColor: "rgb(239,68,68)", // red
                      backgroundColor: "rgba(239,68,68,0.2)",
                      tension: 0.3,
                      fill: true
                    }
                  ]
                }}
                options={{
                  responsive: true,
                  plugins: { legend: { position: "bottom" } },
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: { color: darkMode ? '#9ca3af' : '#374151' },
                      grid: { color: darkMode ? '#374151' : '#e5e7eb' }
                    },
                    x: {
                      ticks: { color: darkMode ? '#9ca3af' : '#374151' },
                      grid: { color: darkMode ? '#374151' : '#e5e7eb' }
                    }
                  },
                  animation: { duration: 1200, easing: "easeInOutQuart" }
                }}
              />
            </div>
          </div>
        )}

        {/* Premium Analytics - Premium Feature */}
        {subscription === "premium" && (
          <div className={`${darkMode ? "bg-gray-800" : "bg-white"} rounded-lg p-6 mt-6 shadow-xl w-full max-w-lg mx-auto`}>
            <h2 className={`text-2xl font-semibold mb-4 text-center ${darkMode ? "" : "text-gray-900"}`}>📊 Premium Analytics</h2>
            <div className="mb-4 space-y-2">
              <p className="mb-2">Profit/Loss Ratio: <span className="font-bold text-yellow-400">${analytics.profitLossRatio.toFixed(1)}%</span></p>
              <p className="mb-2 text-green-400">Total Income: <span className="font-bold">${analytics.income.toFixed(2)}</span></p>
              <p className="mb-2 text-red-400">Total Expenses: <span className="font-bold">${analytics.expenses.toFixed(2)}</span></p>
            </div>
            <div className="mt-6 max-w-xs mx-auto transition-opacity duration-700 ease-in opacity-0 animate-fadeIn">
              <Doughnut
                data={{
                  labels: Object.keys(analytics.categories),
                  datasets: [{
                    data: Object.values(analytics.categories),
                    backgroundColor: ["#22c55e", "#ef4444", "#3b82f6", "#eab308", "#a855f7", "#f97316"]
                  }]
                }}
                options={{ plugins: { legend: { position: "bottom" } } }}
              />
            </div>
            <p className="mt-4 text-center text-sm text-gray-400">Category spending breakdown</p>
          </div>
        )}

        {/* AI-Powered Forecasting - Premium Feature */}
        {subscription === "premium" || subscription === "trial" ? (
          <div className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white p-6 rounded-lg shadow-lg mt-6">
            <h2 className="text-xl font-bold mb-3">🔮 AI Forecast</h2>
            <p>Projected Income: <span className="text-green-300">${forecast.avgIncome.toFixed(2)}</span></p>
            <p>Projected Expenses: <span className="text-red-300">${forecast.avgExpenses.toFixed(2)}</span></p>
            <p>Projected Savings: <span className="text-yellow-300">${forecast.projectedSavings.toFixed(2)}</span></p>
          </div>
        ) : (
          <div className="bg-gray-700 text-gray-300 p-4 rounded mt-6">
            🔒 Unlock Premium to see your future income, expenses, and savings trajectory.
          </div>
        )}

        {/* Personalized AI Insights - Premium Feature */}
        {subscription === "premium" || subscription === "trial" ? (
          <div className="bg-gradient-to-r from-green-600 to-emerald-700 text-white p-6 rounded-lg shadow-lg mt-6">
            <h2 className="text-xl font-bold mb-3">💡 Personalized Insights</h2>
            <ul className="space-y-2">
              {personalizedInsights.map((tip, i) => (
                <li key={i} className="bg-black/30 p-3 rounded">{tip}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="bg-gray-700 text-gray-300 p-4 rounded mt-6">
            🔒 Unlock Premium to receive personalized financial insights tailored to your spending.
          </div>
        )}

        {/* Premium Budget Planner - Premium Feature */}
        {subscription === "premium" || subscription === "trial" ? (
          <div className="bg-gradient-to-r from-teal-700 to-emerald-700 text-white p-6 rounded-lg shadow-lg mt-6">
            <h2 className="text-xl font-bold mb-4">📏 Budget Planner</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {budgets.map((b, i) => (
                <BudgetCard key={i} b={b} onUpdate={updateBudget} />
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-gray-700 text-gray-300 p-4 rounded mt-6">
            🔒 Unlock Premium to set monthly budgets with real-time progress and alerts.
          </div>
        )}

        {/* Smart Goals - Premium Feature */}
        {subscription === "premium" || subscription === "trial" ? (
          <div className="bg-gradient-to-r from-blue-600 to-cyan-700 text-white p-6 rounded-lg shadow-lg mt-6">
            <h2 className="text-xl font-bold mb-3">🎯 Smart Goals</h2>
            <ul className="space-y-2">
              {suggestedGoals.map((goal, i) => (
                <li key={i} className="bg-black/30 p-3 rounded">
                  {goal.name} → Target: ${goal.target} in {goal.timeline}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="bg-gray-700 text-gray-300 p-4 rounded mt-6">
            🔒 Unlock Premium to receive AI-suggested savings goals tailored to your lifestyle.
          </div>
        )}

        {/* Achievement Badges & Progress Tracking - Premium Feature */}
        {subscription === "premium" || subscription === "trial" ? (
          <div className="bg-gradient-to-r from-pink-600 to-rose-700 text-white p-6 rounded-lg shadow-lg mt-6">
            <h2 className="text-xl font-bold mb-3">🏅 Achievements</h2>
            <ul className="space-y-2">
              {badges.map((badge, i) => (
                <li key={i} className="bg-black/30 p-3 rounded">
                  {badge}
                  <ShareBadge badge={badge} />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="bg-gray-700 text-gray-300 p-4 rounded mt-6">
            🔒 Unlock Premium to earn achievement badges and track your wealth journey.
          </div>
        )}

        {/* Premium features banner for Free users */}
        {subscription === "free" && (
          <div className={`${darkMode ? "bg-gray-800" : "bg-gray-100"} rounded-lg p-6 mt-6 shadow-xl w-full max-w-4xl mx-auto`}>
            <div className="text-center">
              <p className={`mb-4 ${darkMode ? "text-gray-300" : "text-gray-700"}`}>🎉 Premium Features Unlock Advanced Financial Analytics</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <div className={`${darkMode ? "bg-gray-700/50" : "bg-white"} p-4 rounded-lg shadow-md`}>
                  <h3 className="text-lg font-semibold text-yellow-400 mb-2">📈 Trend Analysis</h3>
                  <p className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Visualize your income and expenses over time with interactive charts.</p>
                </div>
                <div className={`${darkMode ? "bg-gray-700/50" : "bg-white"} p-4 rounded-lg shadow-md`}>
                  <h3 className="text-lg font-semibold text-purple-400 mb-2">🎯 Goal Reminders</h3>
                  <p className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Get motivated with personalized reminders about your financial goals.</p>
                </div>
                <div className={`${darkMode ? "bg-gray-700/50" : "bg-white"} p-4 rounded-lg shadow-md`}>
                  <h3 className="text-lg font-semibold text-blue-400 mb-2">💡 AI Insights</h3>
                  <p className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Receive intelligent financial recommendations powered by AI.</p>
                </div>
                <div className={`${darkMode ? "bg-gray-700/50" : "bg-white"} p-4 rounded-lg shadow-md`}>
                  <h3 className="text-lg font-semibold text-cyan-400 mb-2">💱 FX Preview</h3>
                  <p className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>See live currency conversion rates before international transfers.</p>
                </div>
                <div className={`${darkMode ? "bg-gray-700/50" : "bg-white"} p-4 rounded-lg shadow-md`}>
                  <h3 className="text-lg font-semibold text-indigo-400 mb-2">🗞️ Weekly Digest</h3>
                  <p className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Get comprehensive weekly summaries of your financial activities and achievements.</p>
                </div>
              </div>
              <p className="mt-6 text-sm text-gray-400">
                You’re on the Free Plan — perfect for everyday banking needs: track transactions, manage budgets, and stay on top of essentials.
              </p>
              <div className="mt-4 bg-gray-700 text-gray-200 p-3 rounded">
                <p className="text-sm">Upgrade when you’re ready to move from managing money… to mastering it.</p>
              </div>
              <button
                onClick={() => setSubscription("premium")}
                className="mt-4 px-6 py-2 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold rounded transition-colors"
              >
                Upgrade Now 🚀
              </button>
            </div>
          </div>
        )}

        {/* Savings Goals */}
        {widgets.showGoals && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <div className={`${darkMode ? "bg-gray-800" : "bg-white"} rounded-lg p-6 shadow-xl`}>
              <h2 className={`text-2xl font-semibold mb-4 text-center ${darkMode ? "" : "text-gray-900"}`}>Savings Goals</h2>
              <div className="space-y-4">
                {goals.map((goal) => {
                  const progress = Math.min((goal.saved / goal.target) * 100, 100);
                  return (
                    <div key={goal.id} className={`p-4 rounded-lg ${darkMode ? "bg-gray-700" : "bg-gray-100"}`}>
                      <div className="flex justify-between items-center mb-2">
                        <p className={`font-semibold ${darkMode ? "text-gray-100" : "text-gray-900"}`}>{goal.name}</p>
                        <p className="text-yellow-400 font-bold">{progress.toFixed(0)}%</p>
                      </div>
                      <div className={`flex justify-between text-sm mb-2 ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                        <span>Saved: ${goal.saved.toFixed(2)}</span>
                        <span>Target: ${goal.target.toFixed(2)}</span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-4 mt-3 overflow-hidden">
                        <div
                          className="bg-green-500 h-4 rounded-full transition-all duration-700 ease-out"
                          style={{ width: `${progress}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Budgets */}
            {widgets.showBudgets && (
              <div className={`${darkMode ? "bg-gray-800" : "bg-white"} rounded-lg p-6 shadow-xl`}>
                <h2 className={`text-2xl font-semibold mb-4 text-center ${darkMode ? "" : "text-gray-900"}`}>Budgets</h2>
                <div className="space-y-4">
                  {budgets.map((b, index) => {
                    const percent = Math.min((b.spent / b.limit) * 100, 100);
                    return (
                      <div key={index} className="mb-4">
                        <div className="flex justify-between text-sm">
                          <span className={darkMode ? "text-gray-300" : "text-gray-700"}>{b.category}</span>
                          <span className={darkMode ? "text-gray-400" : "text-gray-500"}>${b.spent} / ${b.limit}</span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-4 mt-2 overflow-hidden">
                          <div
                            className={`h-4 rounded-full transition-all duration-700 ${percent > 90 ? "bg-red-500" :
                              percent > 70 ? "bg-yellow-500" :
                                "bg-green-500"
                              }`}
                            style={{ width: `${percent}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Virtual Premium Cards Section */}
        <div className={`${darkMode ? "bg-gray-800" : "bg-white"} rounded-lg p-6 mt-6 shadow-xl mx-auto max-w-4xl`}>
          <h2 className={`text-2xl font-semibold mb-6 text-center ${darkMode ? "" : "text-gray-900"}`}>💳 Your Virtual Cards</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cards.map((card, index) => (
              <div key={index}>
                {/* Premium cards only shown for premium/trial users, free users get blurred version */}
                {subscription === "premium" || subscription === "trial" ? (
                  <VirtualCard type={card.type} number={card.number} premium={card.premium} />
                ) : (
                  <div className="relative w-80 h-48">
                    <div className="blur-sm opacity-60 pointer-events-none">
                      <VirtualCard type={card.type} number={card.number} premium={card.premium} />
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="bg-black/70 text-yellow-400 px-4 py-2 rounded">
                        🔒 Unlock Premium to access Elite Cards
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Achievements Section */}
        {widgets.showAchievements && (
          <div className={`${darkMode ? "bg-gray-800" : "bg-white"} rounded-xl p-6 mt-6 shadow-xl max-w-2xl mx-auto`}>
            <h2 className={`text-2xl font-semibold mb-6 text-center ${darkMode ? "" : "text-gray-900"}`}>🎖️ Achievements & Milestones</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex flex-col items-center bg-gradient-to-br from-yellow-400 via-yellow-500 to-yellow-600 p-4 rounded-xl shadow-lg hover:scale-105 transition-all duration-300">
                <span className="text-3xl mb-2">🏆</span>
                <p className="text-white font-semibold text-center text-sm">First Goal Reached</p>
              </div>
              <div className="flex flex-col items-center bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 p-4 rounded-xl shadow-lg hover:scale-105 transition-all duration-300">
                <span className="text-3xl mb-2">💰</span>
                <p className="text-white font-semibold text-center text-sm">$1,000 Saved</p>
              </div>
              <div className="flex flex-col items-center bg-gradient-to-br from-green-500 via-green-600 to-green-700 p-4 rounded-xl shadow-lg hover:scale-105 transition-all duration-300">
                <span className="text-3xl mb-2">🚀</span>
                <p className="text-white font-semibold text-center text-sm">Smart Budgeting</p>
              </div>
              <div className="flex flex-col items-center bg-gradient-to-br from-purple-500 via-purple-600 to-purple-700 p-4 rounded-xl shadow-lg hover:scale-105 transition-all duration-300">
                <span className="text-3xl mb-2">📈</span>
                <p className="text-white font-semibold text-center text-sm">Growing Wealth</p>
              </div>
            </div>
            <div className="mt-4 text-center">
              <p className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}>Stay consistent! New achievements unlock as you grow your financial wisdom.</p>
            </div>
          </div>
        )}

        {/* AI Financial Insights - Premium Feature */}
        {(subscription === "premium" || subscription === "trial") && widgets.showInsights && insights.length > 0 && (
          <div className={`luxury-card p-6 mt-6 shadow-xl max-w-2xl mx-auto ${darkMode ? "backdrop-blur-xl bg-gray-800/80 border border-white/10" : "bg-white/90 backdrop-blur-lg border border-gray-200/50"} rounded-xl`}>
            <h2 className={`text-2xl font-semibold mb-6 text-center ${darkMode ? "" : "text-gray-900"}`}>💡 AI Financial Insights</h2>
            <div className="space-y-3">
              {insights.map((tip, i) => (
                <div
                  key={i}
                  className={`p-4 rounded-lg transition-all duration-300 hover:scale-105 ${darkMode ? "bg-gray-700/50" : "bg-gray-50"}`}
                >
                  <p className={`text-sm ${darkMode ? "text-gray-100" : "text-gray-900"}`}>{tip}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 text-center">
              <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Powered by intelligent financial analysis</p>
            </div>
          </div>
        )}

        {/* Goal Reminders - Premium Feature */}
        {(subscription === "premium" || subscription === "trial") && widgets.showReminders && goalReminders.length > 0 && (
          <div className={`luxury-card p-6 mt-6 shadow-xl max-w-2xl mx-auto ${darkMode ? "backdrop-blur-xl bg-gray-800/80 border border-white/10" : "bg-white/90 backdrop-blur-lg border border-gray-200/50"} rounded-xl`}>
            <h2 className={`text-2xl font-semibold mb-6 text-center ${darkMode ? "" : "text-gray-900"}`}>🎯 Goal Reminders</h2>
            <ul className="space-y-3">
              {goalReminders.map((msg, i) => (
                <li
                  key={i}
                  className={`${darkMode ? "bg-indigo-600/20 text-indigo-300" : "bg-indigo-100 text-indigo-700"} p-4 rounded-lg transition-all duration-500 ease-in-out hover:scale-105`}
                >
                  {msg}
                </li>
              ))}
            </ul>
            <div className="mt-4 text-center">
              <p className={`text-xs ${darkMode ? "text-gray-400" : "text-gray-500"}`}>Stay motivated! Keep saving towards your goals.</p>
            </div>
          </div>
        )}

        {/* Premium Reports - Premium Feature */}
        {subscription === "premium" || subscription === "trial" ? (
          <Reports transactions={user.transactions} />
        ) : (
          <div className="bg-gray-700 text-gray-300 p-4 rounded mt-4">
            🔒 Unlock Premium to generate and export financial reports.
          </div>
        )}

        {/* AI Trend Reports - Premium Feature */}
        {subscription === "premium" || subscription === "trial" ? (
          <TrendReports transactions={user.transactions} />
        ) : (
          <div className="bg-gray-700 text-gray-300 p-4 rounded mt-4">
            🔒 Unlock Premium to see multi-month trend reports with AI insights.
          </div>
        )}

        {/* Premium Goals Dashboard with Progress Rings - Premium Feature */}
        {subscription === "premium" || subscription === "trial" ? (
          <GoalsDashboard goals={user.goals || []} />
        ) : (
          <div className="bg-gray-700 text-gray-300 p-4 rounded mt-4">
            🔒 Unlock Premium to visualize your goals with progress rings.
          </div>
        )}

        {/* Rewards Summary - Available for all users */}
        <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 rounded-xl p-6 mt-6 border border-yellow-500/30">
          <Rewards subscription={subscription} />
        </div>

        {/* Audit Logs - Premium Feature */}
        {subscription === "premium" || subscription === "trial" ? (
          <AuditLog user={user} subscription={subscription} />
        ) : (
          <div className="bg-gray-700 text-gray-300 p-4 rounded mt-6">
            🔒 Unlock Premium to access detailed audit logs and security monitoring.
          </div>
        )}

        {/* AI Alerts Tray - Premium Feature */}
        {subscription === "premium" || subscription === "trial" ? (
          <div className="fixed bottom-4 right-4 space-y-2 z-50">
            {alerts.slice(-3).map(a => (
              <div
                key={a.id}
                className={`px-4 py-3 rounded shadow-lg backdrop-blur
                  ${a.type === "warning" ? "bg-red-600/80 text-white"
                    : a.type === "success" ? "bg-green-600/80 text-white"
                      : "bg-yellow-400/90 text-black"}`}
              >
                {a.message}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-gray-700 text-gray-300 p-3 rounded mt-4">
            🔒 Unlock Premium to receive AI-powered alerts about your spending and goals.
          </div>
        )}

        {/* Fraud & Anomaly Detection Alerts - Premium Feature */}
        {subscription === "premium" || subscription === "trial" ? (
          <div className="fixed bottom-20 right-4 space-y-2 z-50">
            {fraudAlerts.slice(-3).map(f => (
              <div key={f.id} className="px-4 py-3 rounded shadow-lg bg-red-600/90 text-white backdrop-blur animate-pulse">
                <div className="flex items-center space-x-2">
                  <span className="text-xl">🚨</span>
                  <span className="font-semibold">{f.message}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-gray-700 text-gray-300 p-3 rounded mt-4">
            🔒 Unlock Premium to enable fraud detection and anomaly alerts.
          </div>
        )}

        {/* Premium Notification Tray - Fixed Position */}
        <div className="fixed top-4 right-4 space-y-2 z-50">
          {notifications.slice(-5).map(n => (
            <div
              key={n.id}
              className={`px-4 py-3 rounded shadow-lg backdrop-blur transition-all duration-500 animate-fadeInDown ${n.type === "success"
                ? "bg-green-600/80 text-white"
                : n.type === "card"
                  ? "bg-yellow-500/80 text-black"
                  : "bg-indigo-600/80 text-white"
                }`}
            >
              {n.message}
            </div>
          ))}
        </div>

        {/* Test Buttons */}
        <div className="fixed bottom-4 right-4 z-50 space-y-2">
          <button
            onClick={simulateCardUse}
            className="block px-3 py-2 bg-yellow-500 text-black rounded hover:bg-yellow-600 transition-colors shadow-lg text-sm"
          >
            🔔 Test Premium Notification
          </button>
          {(subscription === "premium" || subscription === "trial") && (
            <>
              <button
                onClick={() => pushFraudAlert("🚨 Test fraud alert - Large transaction detected: $7,500.00 - Luxury Shopping Spree")}
                className="block px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors shadow-lg text-sm"
              >
                🚨 Test Fraud Alert
              </button>
              <button
                onClick={() => {
                  // Add a test transaction to trigger FX preview
                  const testTx = {
                    id: Date.now(),
                    label: "Test International Transfer",
                    amount: -1000,
                    date: new Date().toISOString().split("T")[0],
                    category: "transfer",
                  };
                  setUser(prev => ({
                    ...prev,
                    transactions: [testTx, ...(prev.transactions || [])],
                    balance: prev.balance - 1000
                  }));
                }}
                className="block px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors shadow-lg text-sm"
              >
                💱 Test FX Detection
              </button>
              <button
                onClick={() => {
                  // Add multiple test transactions for weekly digest
                  const testTransactions = [
                    {
                      id: Date.now() - 3,
                      label: "Test Salary Income",
                      amount: 5000,
                      date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                      category: "income",
                    },
                    {
                      id: Date.now() - 2,
                      label: "Test Grocery Shopping",
                      amount: -150,
                      date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                      category: "food",
                    },
                    {
                      id: Date.now() - 1,
                      label: "Test Entertainment",
                      amount: -75,
                      date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                      category: "entertainment",
                    },
                  ];
                  setUser(prev => ({
                    ...prev,
                    transactions: [...testTransactions, ...(prev.transactions || [])],
                    balance: prev.balance + 5000 - 150 - 75
                  }));
                }}
                className="block px-3 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors shadow-lg text-sm"
              >
                🗞️ Test Weekly Digest
              </button>
            </>
          )}
        </div>

        {/* Recent Transactions */}
        <div className={`${darkMode ? "bg-gray-800" : "bg-white"} mt-8 rounded-lg p-6 shadow-xl`}>
          <div className="flex justify-between items-center mb-6">
            <h2 className={`text-2xl font-semibold ${darkMode ? "" : "text-gray-900"}`}>Recent Transactions</h2>
            <div className="flex gap-3">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                id="csv-import"
              />
              <label
                htmlFor="csv-import"
                className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 transition-colors shadow-md hover:shadow-lg cursor-pointer"
              >
                📥 Import CSV
              </label>
              <button
                onClick={exportTransactions}
                className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-md hover:shadow-lg"
              >
                📊 Export CSV
              </button>
              <button
                onClick={exportToExcel}
                className="px-4 py-2 rounded bg-yellow-500 text-black hover:bg-yellow-600 transition-colors shadow-md hover:shadow-lg"
              >
                📑 Export Excel
              </button>
            </div>
          </div>

          {/* Search and Sort Controls */}
          <div className="mt-4 flex flex-col sm:flex-row gap-4">
            <input
              type="text"
              placeholder="Search transactions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`flex-1 p-3 rounded ${darkMode ? "bg-gray-700 text-white border-gray-600" : "bg-gray-100 text-gray-900 border-gray-300"} border focus:border-yellow-400 focus:outline-none transition-colors`}
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className={`p-3 rounded ${darkMode ? "bg-gray-700 text-white border-gray-600" : "bg-gray-100 text-gray-900 border-gray-300"} border focus:border-yellow-400 focus:outline-none transition-colors`}
            >
              <option value="date">Sort by Date</option>
              <option value="amount">Sort by Amount</option>
              <option value="category">Sort by Category</option>
            </select>
          </div>

          <ul className="mt-4 space-y-2">
            {sortedTransactions && sortedTransactions.length > 0 ? (
              sortedTransactions.map((tx, index) => (
                <li key={tx.id || index} className={`flex justify-between items-center p-3 rounded-lg ${darkMode ? "bg-gray-700" : "bg-gray-50"}`}>
                  <span className={`flex items-center space-x-2 ${categoryColor(tx.category)}`}>
                    <span>{categoryIcon(tx.category)}</span>
                    <span className={darkMode ? "" : "text-gray-900"}>{tx.label}</span>
                  </span>
                  <span className={darkMode ? "text-gray-300" : "text-gray-600"}>{tx.date}</span>
                  <span className={tx.amount < 0 ? "text-red-400" : "text-green-400"}>
                    {tx.amount < 0 ? `-${Math.abs(tx.amount).toFixed(2)}` : `+${tx.amount.toFixed(2)}`}
                  </span>
                </li>
              ))
            ) : (
              <p className={`${darkMode ? "text-gray-400" : "text-gray-500"} text-center py-4`}>{search ? `No transactions match "${search}"` : "No transactions yet."}</p>
            )}
          </ul>
        </div>
      </div>

      {/* Redeem Code - Available for all users */}
      <RedeemCode onRedeem={(tier) => setSubscription(tier)} />

      {/* Referral Program - Premium Feature */}
      {(subscription === "premium" || subscription === "trial") && referralCode && (
        <div className="bg-gradient-to-r from-yellow-500 to-orange-600 text-black p-4 rounded-lg shadow-lg mt-6 max-w-2xl mx-auto">
          <div className="flex items-center space-x-2 mb-2">
            <span className="text-2xl">🎁</span>
            <h3 className="text-xl font-bold">Invite Friends & Earn Rewards</h3>
          </div>
          <p className="mb-2">Share your unique referral code with friends and family!</p>
          <div className="flex items-center space-x-2 mb-3">
            <span className="font-mono bg-black/10 px-3 py-2 rounded text-lg font-bold tracking-wider">{referralCode}</span>
          </div>
          <p className="text-sm mb-3">
            Your friends get Premium access for free, and you earn <strong>$10 credit</strong> for each successful referral!
          </p>
          <button
            onClick={() => {
              navigator.clipboard.writeText(referralCode);
              alert(`🎉 Referral code "${referralCode}" copied to clipboard! Share it with friends to earn rewards.`);
            }}
            className="px-6 py-3 bg-black text-yellow-400 rounded-xl font-bold hover:bg-gray-800 transition-colors shadow-lg"
          >
            📋 Copy Referral Code
          </button>
        </div>
      )}

      {/* Referral History - Premium Feature */}
      {subscription === "premium" || subscription === "trial" ? (
        <div className="mt-6 bg-gradient-to-r from-green-600 to-blue-700 text-white p-6 rounded-xl shadow-xl max-w-2xl mx-auto">
          <h3 className="text-xl font-bold mb-4 flex items-center space-x-2">
            <span>👥</span>
            <span>Referral History</span>
          </h3>
          <div className="bg-black/20 p-4 rounded-lg">
            <p className="text-yellow-200 mb-2">
              💰 <strong>$0.00</strong> earned from referrals
            </p>
            <p className="text-sm text-gray-200">
              Share your referral code with friends. Once they sign up and activate Premium, you'll both earn rewards!
            </p>
            <div className="mt-3 text-sm">
              <p className="text-gray-300">No successful referrals yet.</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* AI Chatbot - Available for all users */}
      <Chatbot />
    </div>
  );
}

export default Dashboard;
