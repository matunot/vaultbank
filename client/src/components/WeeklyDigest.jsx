export default function WeeklyDigest({
  user,
  transactions,
  goals,
  badges,
  alerts,
  fraudAlerts,
}) {
  // Calculate weekly totals (last 7 days)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weeklyTransactions = transactions.filter(
    (tx) => new Date(tx.date) >= weekAgo
  );

  const totalIncome = weeklyTransactions
    .filter((tx) => tx.amount > 0)
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalExpenses = weeklyTransactions
    .filter((tx) => tx.amount < 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  const netSavings = totalIncome - totalExpenses;

  // Get completed goals this week
  const completedGoals = goals.filter((g) => g.progress >= 1);

  // Get recent badges (last 3)
  const newBadges = badges.slice(-3);

  // Get recent alerts (last 3 from both regular alerts and fraud alerts)
  const recentAlerts = [...alerts, ...fraudAlerts].slice(-3);

  // Calculate weekly category breakdown
  const categoryTotals = {};
  weeklyTransactions.forEach((tx) => {
    if (tx.amount < 0) {
      const category = tx.category || "other";
      categoryTotals[category] =
        (categoryTotals[category] || 0) + Math.abs(tx.amount);
    }
  });

  const topCategories = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  return (
    <div className="bg-gradient-to-br from-indigo-700 via-purple-700 to-pink-700 text-white p-6 rounded-xl shadow-xl mt-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold flex items-center space-x-2">
          <span>🗞️</span>
          <span>Weekly Digest</span>
        </h2>
        <div className="text-sm text-gray-300">
          {new Date().toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Financial Summary */}
        <div className="space-y-4">
          <div className="bg-black/30 p-4 rounded-lg">
            <h3 className="font-semibold text-lg mb-3 flex items-center space-x-2">
              <span>💰</span>
              <span>Weekly Financial Summary</span>
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-green-400">Income:</span>
                <span className="font-semibold text-green-300">
                  ${totalIncome.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-red-400">Expenses:</span>
                <span className="font-semibold text-red-300">
                  ${totalExpenses.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-600 pt-2">
                <span className="text-yellow-400 font-semibold">
                  Net Savings:
                </span>
                <span
                  className={`font-bold ${
                    netSavings >= 0 ? "text-green-300" : "text-red-300"
                  }`}
                >
                  ${netSavings.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Top Spending Categories */}
          {topCategories.length > 0 && (
            <div className="bg-black/30 p-4 rounded-lg">
              <h3 className="font-semibold text-lg mb-3 flex items-center space-x-2">
                <span>📊</span>
                <span>Top Spending Categories</span>
              </h3>
              <div className="space-y-2">
                {topCategories.map(([category, amount], index) => (
                  <div
                    key={category}
                    className="flex justify-between items-center"
                  >
                    <div className="flex items-center space-x-2">
                      <span className="text-xs bg-gray-600 px-2 py-1 rounded">
                        #{index + 1}
                      </span>
                      <span className="capitalize">{category}</span>
                    </div>
                    <span className="font-semibold text-red-300">
                      ${amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Goals & Achievements */}
        <div className="space-y-4">
          {/* Goals Completed */}
          <div className="bg-black/30 p-4 rounded-lg">
            <h3 className="font-semibold text-lg mb-3 flex items-center space-x-2">
              <span>🎯</span>
              <span>Goals Progress</span>
            </h3>
            {completedGoals.length > 0 ? (
              <div className="space-y-2">
                <p className="text-green-400 font-semibold">
                  🎉 {completedGoals.length} goal
                  {completedGoals.length > 1 ? "s" : ""} completed this week!
                </p>
                <ul className="space-y-1">
                  {completedGoals.slice(0, 3).map((goal, i) => (
                    <li
                      key={i}
                      className="text-sm text-gray-300 flex items-center space-x-2"
                    >
                      <span className="text-green-400">✓</span>
                      <span>{goal.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-gray-400">
                No goals completed this week. Keep pushing! 💪
              </p>
            )}
          </div>

          {/* New Badges */}
          <div className="bg-black/30 p-4 rounded-lg">
            <h3 className="font-semibold text-lg mb-3 flex items-center space-x-2">
              <span>🏅</span>
              <span>Recent Achievements</span>
            </h3>
            {newBadges.length > 0 ? (
              <ul className="space-y-1">
                {newBadges.map((badge, i) => (
                  <li
                    key={i}
                    className="text-sm text-gray-300 flex items-center space-x-2"
                  >
                    <span className="text-yellow-400">🏆</span>
                    <span>{badge}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-400">No new achievements this week.</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Alerts */}
      <div className="mt-6 bg-black/30 p-4 rounded-lg">
        <h3 className="font-semibold text-lg mb-3 flex items-center space-x-2">
          <span>🔔</span>
          <span>Recent Alerts & Notifications</span>
        </h3>
        {recentAlerts.length > 0 ? (
          <div className="space-y-2">
            {recentAlerts.map((alert, i) => (
              <div
                key={i}
                className="text-sm text-gray-300 flex items-center space-x-2"
              >
                <span
                  className={
                    alert.type === "warning" ? "text-red-400" : "text-blue-400"
                  }
                >
                  {alert.type === "warning" ? "⚠️" : "ℹ️"}
                </span>
                <span>{alert.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400">
            No alerts this week. Great job staying on track! ✅
          </p>
        )}
      </div>

      {/* Weekly Insights */}
      <div className="mt-6 bg-gradient-to-r from-yellow-600/20 to-orange-600/20 p-4 rounded-lg border border-yellow-500/30">
        <h3 className="font-semibold text-lg mb-2 flex items-center space-x-2">
          <span>💡</span>
          <span>Weekly Insights</span>
        </h3>
        <div className="text-sm text-gray-300">
          {netSavings > 0 ? (
            <p>
              🎉 Excellent week! You're building wealth with $
              {netSavings.toFixed(2)} in savings.
            </p>
          ) : netSavings < -500 ? (
            <p>
              ⚠️ Your spending exceeded your income this week. Consider
              reviewing your budget.
            </p>
          ) : (
            <p>
              📊 Steady progress! Keep maintaining your financial discipline.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
