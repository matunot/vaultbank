import { Bar } from "react-chartjs-2";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

export default function Reports({ transactions }) {
  const income = transactions
    .filter((tx) => tx.amount > 0)
    .reduce((s, tx) => s + tx.amount, 0);
  const expenses = transactions
    .filter((tx) => tx.amount < 0)
    .reduce((s, tx) => s + Math.abs(tx.amount), 0);

  const data = {
    labels: ["Income", "Expenses"],
    datasets: [
      {
        label: "Amount",
        data: [income, expenses],
        backgroundColor: ["#22c55e", "#ef4444"],
      },
    ],
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.text("VaultBank Premium Report", 20, 20);
    doc.text(`Total Income: $${income}`, 20, 40);
    doc.text(`Total Expenses: $${expenses}`, 20, 50);
    doc.save("VaultBank_Report.pdf");
  };

  const exportExcel = () => {
    const wsData = [
      ["VaultBank Premium Report"],
      ["Generated On", new Date().toLocaleString()],
      [],
      ["Category", "Amount"],
      ["Income", income],
      ["Expenses", expenses],
      ["Net Savings", income - expenses],
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(
      new Blob([wbout], { type: "application/octet-stream" }),
      "VaultBank_Report.xlsx"
    );
  };

  return (
    <div className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white p-6 rounded-lg shadow-lg mt-6">
      <h2 className="text-xl font-bold mb-3">📊 Premium Report</h2>
      <Bar data={data} />
      <div className="flex space-x-3 mt-4">
        <button
          onClick={exportPDF}
          className="px-4 py-2 bg-yellow-400 text-black rounded hover:bg-yellow-500 transition-colors"
        >
          📥 Download PDF
        </button>
        <button
          onClick={exportExcel}
          className="px-4 py-2 bg-green-400 text-black rounded hover:bg-green-500 transition-colors"
        >
          📊 Export Excel
        </button>
      </div>
    </div>
  );
}
