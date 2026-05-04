import { useState, useEffect } from "react";
import { api } from "../config/apiConfig";

/**
 * TransferHistory – fetches the user's transfer history from the Vercel serverless endpoint
 * GET /api/transfers/history and displays a simple list.
 * The server returns { success, data: { transactions }, count }.
 */
export default function TransferHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const response = await api.get("/api/transfers/history");
        if (response.success) {
          setHistory(response.data?.transactions || []);
        } else {
          setError(response.message || "Failed to load transfer history");
        }
      } catch (err) {
        console.error("Error fetching transfer history:", err);
        setError(err.message || "Error fetching transfer history");
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  if (loading) {
    return (
      <p className="text-center text-gray-400">Loading transfer history...</p>
    );
  }

  if (error) {
    return <p className="text-center text-red-500">{error}</p>;
  }

  if (history.length === 0) {
    return <p className="text-center text-gray-400">No transfers found.</p>;
  }

  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-4 text-center">
        Transfer History
      </h3>
      <ul className="space-y-2 max-h-64 overflow-y-auto">
        {history.map((tx) => (
          <li
            key={tx.id}
            className="flex justify-between items-center bg-gray-800 p-2 rounded"
          >
            <span className="text-sm text-gray-300">
              {new Date(tx.date).toLocaleDateString()}
            </span>
            <span className="text-sm text-gray-300">{tx.recipient}</span>
            <span className="text-sm font-medium">
              {tx.amount < 0
                ? `- $${Math.abs(tx.amount).toFixed(2)}`
                : `$${tx.amount.toFixed(2)}`}
            </span>
            <span className="text-xs text-gray-400 capitalize">
              {tx.method}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
