import { Line } from "react-chartjs-2";

export default function TrendReports({ transactions }) {
  // Group transactions by month
  const monthlyData = {};
  transactions.forEach((tx) => {
    const date = new Date(tx.date);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
    if (!monthlyData[key]) monthlyData[key] = { income: 0, expenses: 0 };
    if (tx.amount > 0) monthlyData[key].income += tx.amount;
    else monthlyData[key].expenses += Math.abs(tx.amount);
  });

  const labels = Object.keys(monthlyData).sort();
  const incomeData = labels.map((l) => monthlyData[l].income);
  const expenseData = labels.map((l) => monthlyData[l].expenses);
  const savingsData = labels.map((_, i) => incomeData[i] - expenseData[i]);

  const data = {
    labels,
    datasets: [
      {
        label: "Income",
        data: incomeData,
        borderColor: "#22c55e",
        fill: false,
      },
      {
        label: "Expenses",
        data: expenseData,
        borderColor: "#ef4444",
        fill: false,
      },
      {
        label: "Savings",
        data: savingsData,
        borderColor: "#facc15",
        fill: false,
      },
    ],
  };

  return (
    <div className="bg-gradient-to-r from-blue-600 to-cyan-700 text-white p-6 rounded-lg shadow-lg mt-6">
      <h2 className="text-xl font-bold mb-3">📈 AI Trend Report</h2>
      <Line data={data} />
      <p className="mt-4 text-sm text-gray-200">
        Insights: Income vs Expenses vs Savings over time. Spot growth or
        overspending trends instantly.
      </p>
    </div>
  );
}
