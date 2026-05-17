import React, { useState, useEffect } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2";
import { useLog } from "../hooks/useLog";
import { api } from "../config/apiConfig";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

export default function AdminDashboard() {
  const [auditData, setAuditData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { log } = useLog();

  useEffect(() => {
    fetchAuditData();
  }, []);

  const fetchAuditData = async () => {
    try {
      setLoading(true);
      const response = await api.get("/api/admin/audit-report");
      setAuditData(response.data.data);
      log("info", "Audit data fetched successfully");
    } catch (err) {
      setError(err.message);
      log("error", "Failed to fetch audit data");
    } finally {
      setLoading(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-xl">Loading Admin Dashboard...</div>
      </div>
    );
  if (error)
    return (
      <div className="flex items-center justify-center h-screen text-red-500">
        Error: {error}
      </div>
    );

  const loginsData = {
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    datasets: [
      {
        label: "Logins",
        data: [12, 19, 15, 25, 22, 18, 30],
        borderColor: "rgb(59, 130, 246)",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        fill: true,
        tension: 0.4,
      },
    ],
  };

  const transfersData = {
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    datasets: [
      {
        label: "Transfers",
        data: [45000, 52000, 49000, 63000, 58000, 72000],
        backgroundColor: "rgba(16, 185, 129, 0.7)",
        borderColor: "rgb(16, 185, 129)",
        borderWidth: 1,
      },
    ],
  };

  const anomaliesData = {
    labels: [
      "Login Attempts",
      "Suspicious Activity",
      "Failed Payments",
      "Security Events",
    ],
    datasets: [
      {
        data: [45, 12, 8, 23],
        backgroundColor: [
          "rgba(239, 68, 68, 0.8)",
          "rgba(245, 158, 11, 0.8)",
          "rgba(168, 85, 247, 0.8)",
          "rgba(59, 130, 246, 0.8)",
        ],
        borderWidth: 0,
      },
    ],
  };

  const summaryCards = [
    {
      title: "Total Logins",
      value: "2,847",
      change: "+12%",
      color: "text-blue-600",
    },
    {
      title: "Transfers",
      value: "$342,500",
      change: "+8%",
      color: "text-green-600",
    },
    {
      title: "Anomalies",
      value: "23",
      change: "-5%",
      color: "text-red-600",
    },
    {
      title: "Security Events",
      value: "45",
      change: "+2%",
      color: "text-purple-600",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Admin Compliance Dashboard
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {summaryCards.map((card, index) => (
            <div key={index} className="bg-white rounded-lg shadow p-6">
              <p className="text-gray-600 text-sm">{card.title}</p>
              <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              <p className="text-sm text-gray-500">
                {card.change} from last period
              </p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Logins Per Day</h2>
            <Line data={loginsData} />
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Transfers Volume</h2>
            <Bar data={transfersData} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Payment Anomalies</h2>
            <Doughnut data={anomaliesData} />
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Audit Report</h2>
            {auditData ? (
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 rounded">
                  <p className="text-sm text-gray-600">Report Path</p>
                  <p className="font-mono text-sm">{auditData.reportPath}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded">
                  <p className="text-sm text-gray-600">Generated At</p>
                  <p className="text-sm">
                    {new Date(auditData.generatedAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-gray-500">No audit data available</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
