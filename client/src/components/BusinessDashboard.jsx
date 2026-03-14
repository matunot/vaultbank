import React, { useState, useEffect } from "react";
import { Pie, Area, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  PointElement,
  LineElement,
  AreaElement,
} from "chart.js";

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  PointElement,
  LineElement,
  AreaElement
);

const BusinessDashboard = ({ darkMode }) => {
  const [activeTab, setActiveTab] = useState("overview");
  const [businesses, setBusinesses] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [analytics, setAnalytics] = useState({});
  const [invoices, setInvoices] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch user's businesses
  const fetchBusinesses = async () => {
    try {
      const response = await fetch("/api/business/me", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      const data = await response.json();
      if (data.success) {
        setBusinesses(data.data);
        if (data.data.length > 0 && !selectedBusiness) {
          setSelectedBusiness(data.data[0].businessDetails);
          fetchBusinessDetails(data.data[0].businessDetails._id);
        }
      }
    } catch (error) {
      console.error("Failed to fetch businesses:", error);
    }
  };

  // Fetch business details
  const fetchBusinessDetails = async (businessId) => {
    try {
      const [analyticsRes, invoicesRes, payrollRes, teamRes] =
        await Promise.all([
          fetch(`/api/business/${businessId}/analytics`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }),
          fetch(`/api/business/${businessId}/invoices?status=`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }),
          fetch(`/api/business/${businessId}/payroll`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }),
          fetch(`/api/business/${businessId}/team`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }),
        ]);

      const [analyticsData, invoicesData, payrollData, teamData] =
        await Promise.all([
          analyticsRes.json(),
          invoicesRes.json(),
          payrollRes.json(),
          teamRes.json(),
        ]);

      if (analyticsData.success) setAnalytics(analyticsData.data);
      if (invoicesData.success) setInvoices(invoicesData.data);
      if (payrollData.success) setPayroll(payrollData.data);
      if (teamData.success) setTeam(teamData.data);
    } catch (error) {
      console.error("Failed to fetch business details:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBusinesses();
  }, []);

  useEffect(() => {
    if (selectedBusiness) {
      fetchBusinessDetails(selectedBusiness._id);
    }
  }, [selectedBusiness]);

  // Chart data for revenue vs expenses
  const revenueChartData = {
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    datasets: [
      {
        label: "Revenue",
        data: [12000, 15000, 18000, 22000, 19000, 25000],
        borderColor: "#22c55e",
        backgroundColor: "rgba(34, 197, 94, 0.1)",
        borderWidth: 2,
      },
      {
        label: "Expenses",
        data: [8000, 9500, 11000, 13000, 12000, 14000],
        borderColor: "#ef4444",
        backgroundColor: "rgba(239, 68, 68, 0.1)",
        borderWidth: 2,
      },
    ],
  };

  // Invoice status pie chart
  const invoiceStatusData = {
    labels: ["Paid", "Pending", "Overdue"],
    datasets: [
      {
        data: [
          invoices.filter((inv) => inv.status === "paid").length,
          invoices.filter((inv) =>
            ["sent", "viewed", "partial"].includes(inv.status)
          ).length,
          invoices.filter((inv) => inv.status === "overdue").length,
        ],
        backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"],
        borderWidth: 2,
      },
    ],
  };

  const formatCurrency = (amount) =>
    `$${parseFloat(amount || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (businesses.length === 0) {
    return (
      <div
        className={`p-6 rounded-lg shadow-lg ${
          darkMode ? "bg-gray-800 text-white" : "bg-white text-gray-900"
        }`}
      >
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold mb-4">
            🏢 No Business Account Yet
          </h2>
          <p className="text-gray-600 mb-6">
            Create your first business account to get started with business
            banking.
          </p>
          <button className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold">
            Create Business Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`p-6 rounded-lg shadow-lg ${
        darkMode ? "bg-gray-800 text-white" : "bg-white text-gray-900"
      }`}
    >
      {/* Business Selector */}
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-4">🏢 Business Banking</h2>
        <select
          value={selectedBusiness?._id || ""}
          onChange={(e) => {
            const business = businesses.find(
              (b) => b.businessDetails._id === e.target.value
            )?.businessDetails;
            setSelectedBusiness(business);
          }}
          className={`w-full p-3 rounded-lg border ${
            darkMode
              ? "bg-gray-700 border-gray-600"
              : "bg-gray-50 border-gray-200"
          }`}
        >
          {businesses.map((business) => (
            <option
              key={business.businessDetails._id}
              value={business.businessDetails._id}
            >
              {business.businessDetails.businessName}
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 bg-gray-100 p-1 rounded-lg">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
            activeTab === "overview"
              ? "bg-blue-500 text-white shadow-md"
              : "text-gray-600 hover:bg-gray-200"
          }`}
        >
          📊 Overview
        </button>
        <button
          onClick={() => setActiveTab("invoices")}
          className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
            activeTab === "invoices"
              ? "bg-blue-500 text-white shadow-md"
              : "text-gray-600 hover:bg-gray-200"
          }`}
        >
          📄 Invoices
        </button>
        <button
          onClick={() => setActiveTab("payroll")}
          className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
            activeTab === "payroll"
              ? "bg-blue-500 text-white shadow-md"
              : "text-gray-600 hover:bg-gray-200"
          }`}
        >
          💰 Payroll
        </button>
        <button
          onClick={() => setActiveTab("team")}
          className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
            activeTab === "team"
              ? "bg-blue-500 text-white shadow-md"
              : "text-gray-600 hover:bg-gray-200"
          }`}
        >
          👥 Team
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">
                Total Revenue
              </h3>
              <p className="text-2xl font-bold text-green-500">
                {formatCurrency(analytics.totalRevenue)}
              </p>
            </div>
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">
                Pending Revenue
              </h3>
              <p className="text-2xl font-bold text-blue-500">
                {formatCurrency(analytics.pendingRevenue)}
              </p>
            </div>
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">
                Total Payroll
              </h3>
              <p className="text-2xl font-bold text-red-500">
                {formatCurrency(analytics.totalPayroll)}
              </p>
            </div>
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">
                Outstanding Invoices
              </h3>
              <p className="text-2xl font-bold text-orange-500">
                {analytics.overdueInvoices || 0}
              </p>
            </div>
          </div>

          {/* Revenue Chart */}
          <div
            className={`p-6 rounded-lg ${
              darkMode ? "bg-gray-700" : "bg-gray-50"
            }`}
          >
            <h3 className="text-xl font-semibold mb-4">Revenue vs Expenses</h3>
            <div className="max-w-4xl mx-auto">
              <Area
                data={revenueChartData}
                options={{
                  responsive: true,
                  plugins: { legend: { position: "top" } },
                }}
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === "invoices" && (
        <div className="space-y-6">
          {/* Invoice Status Chart */}
          <div
            className={`p-6 rounded-lg ${
              darkMode ? "bg-gray-700" : "bg-gray-50"
            }`}
          >
            <h3 className="text-xl font-semibold mb-4">
              Invoice Status Overview
            </h3>
            <div className="max-w-md mx-auto">
              <Pie
                data={invoiceStatusData}
                options={{ plugins: { legend: { position: "bottom" } } }}
              />
            </div>
          </div>

          {/* Invoice List */}
          <div
            className={`p-6 rounded-lg ${
              darkMode ? "bg-gray-700" : "bg-gray-50"
            }`}
          >
            <h3 className="text-xl font-semibold mb-4">Recent Invoices</h3>
            <div className="space-y-2">
              {invoices.slice(0, 10).map((invoice) => (
                <div
                  key={invoice._id}
                  className={`flex justify-between items-center p-4 rounded-lg ${
                    darkMode ? "bg-gray-600" : "bg-white"
                  } shadow`}
                >
                  <div>
                    <h4 className="font-semibold">{invoice.invoiceNumber}</h4>
                    <p className="text-sm text-gray-500">
                      {invoice.clientName}
                    </p>
                    <p className="text-sm text-gray-500">
                      Due: {new Date(invoice.dueDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">
                      {formatCurrency(invoice.totalAmount)}
                    </p>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        invoice.status === "paid"
                          ? "bg-green-100 text-green-800"
                          : invoice.status === "sent"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {invoice.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "payroll" && (
        <div className="space-y-6">
          {/* Payroll Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">
                Employees Paid
              </h3>
              <p className="text-2xl font-bold">
                {payroll.filter((p) => p.status === "completed").length}
              </p>
            </div>
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">
                Upcoming Payrolls
              </h3>
              <p className="text-2xl font-bold">
                {payroll.filter((p) => p.status === "scheduled").length}
              </p>
            </div>
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">
                Monthly Payroll Cost
              </h3>
              <p className="text-2xl font-bold">
                {formatCurrency(analytics.pendingPayroll)}
              </p>
            </div>
          </div>

          {/* Payroll List */}
          <div
            className={`p-6 rounded-lg ${
              darkMode ? "bg-gray-700" : "bg-gray-50"
            }`}
          >
            <h3 className="text-xl font-semibold mb-4">Payroll Schedule</h3>
            <div className="space-y-2">
              {payroll.map((payrollItem) => (
                <div
                  key={payrollItem._id}
                  className={`flex justify-between items-center p-4 rounded-lg ${
                    darkMode ? "bg-gray-600" : "bg-white"
                  } shadow`}
                >
                  <div>
                    <h4 className="font-semibold">
                      {payrollItem.employeeName}
                    </h4>
                    <p className="text-sm text-gray-500">
                      {payrollItem.employeeEmail}
                    </p>
                    <p className="text-sm text-gray-500">
                      Pay Date:{" "}
                      {new Date(payrollItem.payDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">
                      {formatCurrency(payrollItem.netAmount)}
                    </p>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        payrollItem.status === "completed"
                          ? "bg-green-100 text-green-800"
                          : payrollItem.status === "scheduled"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {payrollItem.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "team" && (
        <div className="space-y-6">
          <div
            className={`p-6 rounded-lg ${
              darkMode ? "bg-gray-700" : "bg-gray-50"
            }`}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">
                Team Members ({team.length})
              </h3>
              <button className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold">
                Invite Member
              </button>
            </div>
            <div className="space-y-2">
              {team.map((member) => (
                <div
                  key={member._id}
                  className={`flex justify-between items-center p-4 rounded-lg ${
                    darkMode ? "bg-gray-600" : "bg-white"
                  } shadow`}
                >
                  <div>
                    <h4 className="font-semibold">
                      {member.userProfile?.email || "Pending Invitation"}
                    </h4>
                    <p className="text-sm text-gray-500">Role: {member.role}</p>
                    {member.joinedAt && (
                      <p className="text-sm text-gray-500">
                        Joined: {new Date(member.joinedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      member.status === "active"
                        ? "bg-green-100 text-green-800"
                        : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {member.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BusinessDashboard;
