import { CircularProgressbar, buildStyles } from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";

export default function GoalsDashboard({ goals }) {
  return (
    <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white p-6 rounded-lg shadow-lg mt-6">
      <h2 className="text-xl font-bold mb-4">🎯 Premium Goals Dashboard</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {goals.map((g, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className="w-32 h-32">
              <CircularProgressbar
                value={g.progress * 100}
                text={`${Math.round(g.progress * 100)}%`}
                styles={buildStyles({
                  textColor: "#fff",
                  pathColor: g.progress >= 1 ? "#FFD700" : "#22c55e",
                  trailColor: "#1f2937",
                })}
              />
            </div>
            <p className="mt-2 font-semibold">{g.name}</p>
            <p className="text-sm text-gray-200">Target: ${g.target}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
