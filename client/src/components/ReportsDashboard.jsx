import React, { useState, useEffect, useCallback } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Pie, Bar, Line } from "react-chartjs-2";

// Register Chart components
ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
);

const ReportsDashboard = ({ user }) => {
  const [activeTab, setActiveTab] = useState("generate");
  const [reportsList, setReportsList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reportTypes, setReportTypes] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Form state for report generation
  const [formData, setFormData] = useState({
    type: "SAR",
    format: "json",
    filters: {
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0], // 30 days ago
      endDate: new Date().toISOString().split("T")[0], // Today
      riskLevel: [],
      userId: "",
      action: "",
      limit: 10000,
    },
  });

  const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

  // Check if user is admin
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  // Fetch reports list
  const fetchReportsList = useCallback(async () => {
    if (!isAdmin) return;

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/reports`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();
      if (result.success) {
        setReportsList(result.data);
      }
    } catch (error) {
      console.error("Reports fetch error:", error);
    } finally {
      setLoading(false);
    }
  }, [API_BASE_URL, isAdmin]);

  // Fetch report types
  const fetchReportTypes = useCallback(async () => {
    if (!isAdmin) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/reports/types/list`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();
      if (result.success) {
        setReportTypes(result.data);
      }
    } catch (error) {
      console.error("Report types fetch error:", error);
    }
  }, [API_BASE_URL, isAdmin]);

  // Initialize
  useEffect(() => {
    if (isAdmin) {
      fetchReportsList();
      fetchReportTypes();
    }
  }, [isAdmin, fetchReportsList, fetchReportTypes]);

  // Handle form input changes
  const handleFormChange = (field, value) => {
    if (field.includes(".")) {
      // Handle nested fields like filters.startDate
      const [parent, child] = field.split(".");
      setFormData((prev) => ({
        ...prev,
        [parent]: {
          ...prev[parent],
          [child]: value,
        },
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [field]: value,
      }));
    }
  };

  // Handle risk level checkboxes
  const handleRiskLevelChange = (level, checked) => {
    setFormData((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        riskLevel: checked
          ? [...prev.filters.riskLevel, level]
          : prev.filters.riskLevel.filter((l) => l !== level),
      },
    }));
  };

  // Generate report
  const handleGenerateReport = async () => {
    try {
      setGenerating(true);

      const reportData = {
        type: formData.type,
        format: formData.format,
        filters: {
          ...formData.filters,
          startDate: formData.filters.startDate
            ? new Date(formData.filters.startDate).toISOString()
            : undefined,
          endDate: formData.filters.endDate
            ? new Date(formData.filters.endDate).toISOString()
            : undefined,
        },
      };

      const response = await fetch(`${API_BASE_URL}/api/reports/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reportData),
      });

      const result = await response.json();

      if (result.success) {
        // Poll for report completion
        pollReportStatus(result.data.reportId);
      } else {
        alert(`Error: ${result.message}`);
      }
    } catch (error) {
      console.error("Report generation error:", error);
      alert("Failed to generate report");
    }
  };

  // Poll for report status
  const pollReportStatus = async (reportId) => {
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max

    const poll = async () => {
      attempts++;

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/reports/${reportId}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
              "Content-Type": "application/json",
            },
          }
        );

        const result = await response.json();

        if (result.success) {
          const report = result.data;

          if (report.status === "completed") {
            alert(`Report generated successfully!`);
            setGenerating(false);
            fetchReportsList(); // Refresh list
            return;
          } else if (report.status === "failed") {
            alert(`Report generation failed: ${report.error}`);
            setGenerating(false);
            return;
          }
        }

        // Continue polling if not completed and not too many attempts
        if (attempts < maxAttempts) {
          setTimeout(poll, 1000);
        } else {
          alert("Report generation timed out");
          setGenerating(false);
        }
      } catch (error) {
        console.error("Poll error:", error);
        setGenerating(false);
      }
    };

    poll();
  };

  // Download report
  const handleDownloadReport = async (reportId) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/reports/download/${reportId}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      // Get filename from headers or create one
      const contentDisposition = response.headers.get("content-disposition");
      const fileName = contentDisposition
        ? contentDisposition.split("filename=")[1]?.replace(/["']/g, "")
        : `report-${reportId}.json`;

      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download error:", error);
      alert("Failed to download report");
    }
  };

  // Delete report
  const handleDeleteReport = (reportId) => {
    setDeleteConfirm({ reportId, type: "delete" });
  };

  const confirmDeleteReport = async () => {
    if (!deleteConfirm || deleteConfirm.type !== "delete") return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/reports/${deleteConfirm.reportId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
            "Content-Type": "application/json",
          },
        }
      );

      const result = await response.json();

      if (result.success) {
        alert("Report deleted successfully");
        fetchReportsList(); // Refresh list
        setDeleteConfirm(null);
      } else {
        alert(`Error: ${result.message}`);
      }
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete report");
    }
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Get status color
  const getStatusColor = (status) => {
    switch (status) {
      case "completed":
        return "text-green-600";
      case "failed":
        return "text-red-600";
      case "generating":
        return "text-blue-600";
      default:
        return "text-gray-600";
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="luxury-card p-8 text-center">
          <div className="text-6xl mb-4">🚫</div>
          <h1 className="text-2xl font-bold text-red-600 mb-2">
            Access Denied
          </h1>
          <p className="text-gray-600">
            You do not have permission to access the Reports Dashboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="luxury-card p-6 bg-gradient-to-r from-blue-600 to-purple-700 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold mb-2">
              📊 Compliance Reports Dashboard
            </h2>
            <p className="text-blue-100">
              Generate and manage compliance reports for VaultBank
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="px-3 py-1 bg-white/20 rounded-full text-sm">
              🔐 Admin Mode - {user?.role}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="luxury-card">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6">
            {[
              { id: "generate", label: "⚡ Generate Report", icon: "⚡" },
              { id: "history", label: "📋 Report History", icon: "📋" },
              { id: "exports", label: "💾 Quick Exports", icon: "💾" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {/* Generate Report Tab */}
          {activeTab === "generate" && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold">Generate New Report</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Report Type Selection */}
                <div className="luxury-card p-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Report Type
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => handleFormChange("type", e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="SAR">
                      Suspicious Activity Report (SAR)
                    </option>
                    <option value="AML">AML Compliance Report</option>
                    <option value="Audit">Audit Report</option>
                    <option value="Summary">System Summary Report</option>
                  </select>
                  {reportTypes[formData.type] && (
                    <p className="text-sm text-gray-500 mt-2">
                      {reportTypes[formData.type].description}
                    </p>
                  )}
                </div>

                {/* Export Format */}
                <div className="luxury-card p-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Export Format
                  </label>
                  <select
                    value={formData.format}
                    onChange={(e) => handleFormChange("format", e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                    <option value="pdf">PDF</option>
                    <option value="xlsx">Excel (XLSX)</option>
                  </select>
                </div>
              </div>

              {/* Filters Section */}
              <div className="luxury-card p-4">
                <h4 className="font-semibold mb-4">Report Filters</h4>

                {/* Date Range */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={formData.filters.startDate}
                      onChange={(e) =>
                        handleFormChange("filters.startDate", e.target.value)
                      }
                      className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={formData.filters.endDate}
                      onChange={(e) =>
                        handleFormChange("filters.endDate", e.target.value)
                      }
                      className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Type-specific filters */}
                {formData.type === "SAR" && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Risk Level
                    </label>
                    <div className="flex space-x-4">
                      {["high", "critical"].map((level) => (
                        <label key={level} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={formData.filters.riskLevel.includes(level)}
                            onChange={(e) =>
                              handleRiskLevelChange(level, e.target.checked)
                            }
                            className="mr-2"
                          />
                          {level.charAt(0).toUpperCase() + level.slice(1)}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {formData.type === "Audit" && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        User ID (optional)
                      </label>
                      <input
                        type="text"
                        placeholder="User ID to filter"
                        value={formData.filters.userId}
                        onChange={(e) =>
                          handleFormChange("filters.userId", e.target.value)
                        }
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Action (optional)
                      </label>
                      <input
                        type="text"
                        placeholder="Action to filter"
                        value={formData.filters.action}
                        onChange={(e) =>
                          handleFormChange("filters.action", e.target.value)
                        }
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Limit
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="50000"
                        value={formData.filters.limit}
                        onChange={(e) =>
                          handleFormChange("filters.limit", e.target.value)
                        }
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Generate Button */}
              <div className="flex justify-center">
                <button
                  onClick={handleGenerateReport}
                  disabled={generating}
                  className={`px-6 py-3 rounded-lg font-semibold text-white transition-colors ${
                    generating
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  }`}
                >
                  {generating ? (
                    <>
                      <div className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                      Generating Report...
                    </>
                  ) : (
                    "⚡ Generate Report"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Report History Tab */}
          {activeTab === "history" && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold">Generated Reports</h3>

              {loading ? (
                <div className="text-center py-8">Loading reports...</div>
              ) : reportsList.length > 0 ? (
                <div className="space-y-3">
                  {reportsList.map((report) => (
                    <div key={report.id} className="luxury-card p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-start space-x-4">
                          <div className="text-lg">
                            {report.type === "SAR"
                              ? "🚨"
                              : report.type === "AML"
                              ? "🔍"
                              : report.type === "Audit"
                              ? "📝"
                              : "📊"}
                          </div>
                          <div>
                            <div className="font-semibold">
                              {report.type} Report
                            </div>
                            <div className="text-sm text-gray-600">
                              ID: {report.reportId} • Generated:{" "}
                              {new Date(report.createdAt).toLocaleString()}
                            </div>
                            <div className="flex items-center space-x-4 text-xs text-gray-500 mt-1">
                              <span>
                                Status:{" "}
                                <span className={getStatusColor(report.status)}>
                                  {report.status}
                                </span>
                              </span>
                              {report.recordCount && (
                                <span>Records: {report.recordCount}</span>
                              )}
                              {report.fileSize && (
                                <span>
                                  Size: {formatFileSize(report.fileSize)}
                                </span>
                              )}
                              {report.executionTime && (
                                <span>Time: {report.executionTime}ms</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex space-x-2">
                          {report.status === "completed" && (
                            <button
                              onClick={() =>
                                handleDownloadReport(report.reportId)
                              }
                              className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                            >
                              ⬇️ Download
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteReport(report.reportId)}
                            className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </div>

                      {/* Filters summary */}
                      {report.filters &&
                        Object.keys(report.filters).length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-200">
                            <div className="text-xs text-gray-500">
                              Filters:{" "}
                              {Object.entries(report.filters)
                                .filter(([key, value]) => value && value !== "")
                                .map(
                                  ([key, value]) =>
                                    `${key}: ${
                                      Array.isArray(value)
                                        ? value.join(", ")
                                        : value
                                    }`
                                )
                                .join(", ")}
                            </div>
                          </div>
                        )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <div className="text-4xl mb-2">📄</div>
                  <p>No reports generated yet</p>
                </div>
              )}
            </div>
          )}

          {/* Quick Exports Tab */}
          {activeTab === "exports" && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold">Quick Export Tools</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* SAR Card */}
                <div className="luxury-card p-6 text-center">
                  <div className="text-4xl mb-4">🚨</div>
                  <h4 className="font-bold mb-2">SAR Report</h4>
                  <p className="text-sm text-gray-600 mb-4">
                    Suspicious Activity Report with high-risk cases
                  </p>
                  <button
                    onClick={() => {
                      setFormData((prev) => ({
                        ...prev,
                        type: "SAR",
                        format: "pdf",
                      }));
                      handleGenerateReport();
                    }}
                    disabled={generating}
                    className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    Export SAR
                  </button>
                </div>

                {/* AML Card */}
                <div className="luxury-card p-6 text-center">
                  <div className="text-4xl mb-4">🔍</div>
                  <h4 className="font-bold mb-2">AML Compliance</h4>
                  <p className="text-sm text-gray-600 mb-4">
                    AML case analytics and compliance metrics
                  </p>
                  <button
                    onClick={() => {
                      setFormData((prev) => ({
                        ...prev,
                        type: "AML",
                        format: "xlsx",
                      }));
                      handleGenerateReport();
                    }}
                    disabled={generating}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    Export AML
                  </button>
                </div>

                {/* Audit Card */}
                <div className="luxury-card p-6 text-center">
                  <div className="text-4xl mb-4">📝</div>
                  <h4 className="font-bold mb-2">Audit Log</h4>
                  <p className="text-sm text-gray-600 mb-4">
                    Complete audit trail export
                  </p>
                  <button
                    onClick={() => {
                      setFormData((prev) => ({
                        ...prev,
                        type: "Audit",
                        format: "csv",
                      }));
                      handleGenerateReport();
                    }}
                    disabled={generating}
                    className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    Export Audit
                  </button>
                </div>

                {/* System Summary Card */}
                <div className="luxury-card p-6 text-center">
                  <div className="text-4xl mb-4">📊</div>
                  <h4 className="font-bold mb-2">System Summary</h4>
                  <p className="text-sm text-gray-600 mb-4">
                    Comprehensive system metrics and KPIs
                  </p>
                  <button
                    onClick={() => {
                      setFormData((prev) => ({
                        ...prev,
                        type: "Summary",
                        format: "pdf",
                      }));
                      handleGenerateReport();
                    }}
                    disabled={generating}
                    className="w-full px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                  >
                    Export Summary
                  </button>
                </div>

                {/* Weekly Digest Card */}
                <div className="luxury-card p-6 text-center">
                  <div className="text-4xl mb-4">📧</div>
                  <h4 className="font-bold mb-2">Weekly Digest</h4>
                  <p className="text-sm text-gray-600 mb-4">
                    Last 7 days key metrics summary
                  </p>
                  <button
                    onClick={() => {
                      const sevenDaysAgo = new Date(
                        Date.now() - 7 * 24 * 60 * 60 * 1000
                      )
                        .toISOString()
                        .split("T")[0];
                      setFormData((prev) => ({
                        ...prev,
                        type: "Summary",
                        format: "json",
                        filters: { ...prev.filters, startDate: sevenDaysAgo },
                      }));
                      handleGenerateReport();
                    }}
                    disabled={generating}
                    className="w-full px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
                  >
                    Weekly Digest
                  </button>
                </div>

                {/* Export All Card */}
                <div className="luxury-card p-6 text-center">
                  <div className="text-4xl mb-4">📦</div>
                  <h4 className="font-bold mb-2">Bulk Export</h4>
                  <p className="text-sm text-gray-600 mb-4">
                    Export all reports for compliance audit
                  </p>
                  <button
                    onClick={() => {
                      // This would require a bulk export endpoint
                      alert(
                        "Bulk export functionality would require additional backend implementation"
                      );
                    }}
                    className="w-full px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                  >
                    Coming Soon
                  </button>
                </div>
              </div>

              {/* Generation Status */}
              {generating && (
                <div className="luxury-card p-4 bg-yellow-50">
                  <div className="flex items-center space-x-3">
                    <div className="animate-spin w-6 h-6 border-2 border-yellow-600 border-t-transparent rounded-full"></div>
                    <div>
                      <div className="font-semibold text-yellow-800">
                        Generating Report
                      </div>
                      <div className="text-sm text-yellow-600">
                        This may take a few moments...
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && deleteConfirm.type === "delete" && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="luxury-card p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold mb-4">Delete Report</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this report? This action cannot be
              undone.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteReport}
                disabled={generating}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {generating ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportsDashboard;
