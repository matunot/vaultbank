export default function BudgetCard({ b, onUpdate }) {
  const pct = Math.min(100, Math.round((b.spent / b.limit) * 100));
  const status =
    pct >= 100 ? "bg-red-600" : pct >= 80 ? "bg-yellow-500" : "bg-green-600";

  return (
    <div className="bg-gray-900 p-4 rounded-lg shadow-lg hover:scale-105 transition-transform duration-300">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-semibold text-white">{b.category}</h3>
        <input
          type="number"
          value={b.limit}
          onChange={(e) => onUpdate({ ...b, limit: Number(e.target.value) })}
          className="w-24 bg-gray-800 text-white rounded p-2 border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
        />
      </div>
      <div className="text-sm text-gray-300 mb-2">
        💰 Spent: ${b.spent.toFixed(2)} / Limit: ${b.limit.toFixed(2)}
      </div>
      <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden mb-2">
        <div
          className={`${status} h-4 rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between items-center text-xs">
        <span className="text-gray-400">{pct}% used</span>
        <span className="text-green-400">
          ${Math.max(0, b.limit - b.spent).toFixed(2)} remaining
        </span>
      </div>
      {pct >= 100 && (
        <div className="mt-3 p-2 bg-red-600/20 rounded border border-red-600">
          <p className="text-red-300 text-xs">
            ⚠️ Budget exceeded! Consider cutting expenses in this category.
          </p>
        </div>
      )}
      {pct >= 80 && pct < 100 && (
        <div className="mt-3 p-2 bg-yellow-600/20 rounded border border-yellow-600">
          <p className="text-yellow-300 text-xs">
            ⚠️ Approaching limit. {100 - pct}% budget remaining.
          </p>
        </div>
      )}
    </div>
  );
}
