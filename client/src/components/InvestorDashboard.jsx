import React, { useEffect, useState } from "react";

/**
 * InvestorDashboard component
 * Fetches Prometheus metrics from the /metrics endpoint (protected by investor role)
 * and displays them in a simple preformatted block.
 * If the user is not an investor, it redirects to the home page.
 */
function InvestorDashboard({ user }) {
  const [metrics, setMetrics] = useState("");
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    // Ensure only investors can view this dashboard
    if (!user || user.role !== "investor") {
      // Redirect to home if not authorized
      window.location.href = "/";
      return;
    }

    const fetchMetrics = async () => {
      try {
        const token = localStorage.getItem("token");
        const response = await fetch("/metrics", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/plain",
          },
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch metrics: ${response.status}`);
        }
        const text = await response.text();
        setMetrics(text);
      } catch (err) {
        console.error(err);
        setError(err.message);
      }
    };
    fetchMetrics();
  }, [user]);

  const downloadReport = async () => {
    setDownloading(true);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("/api/reports/compliance", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to download report: ${response.status}`);
      }
      const blob = await response.blob();
      const { saveAs } = await import("file-saver");
      saveAs(blob, "compliance_report.csv");
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  if (error) {
    return (
      <div className="p-4">
        <h2 className="text-xl font-bold mb-4">Investor Dashboard</h2>
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Investor Dashboard</h2>
      {metrics ? (
        <pre
          className="bg-gray-800 text-green-200 p-4 rounded overflow-x-auto"
          style={{ maxHeight: "70vh" }}
        >
          {metrics}
        </pre>
      ) : (
        <p>Loading metrics...</p>
      )}
      {/* Download compliance report button */}
      <div className="mt-4">
        <button
          onClick={downloadReport}
          disabled={downloading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {downloading ? "Downloading..." : "Download Compliance Report"}
        </button>
      </div>
    </div>
  );
}

export default InvestorDashboard;
