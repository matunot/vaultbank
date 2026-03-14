export default function VirtualCard({
  type = "Credit",
  number = "9876 5432 1098 7654",
  premium = true,
}) {
  return (
    <div className="group perspective w-80 h-48 mx-auto">
      <div className="relative preserve-3d transition-transform duration-700 w-full h-full group-hover:rotate-y-180">
        {/* Front */}
        <div
          className={`absolute inset-0 backface-hidden rounded-xl shadow-xl p-6 flex flex-col justify-between ${
            premium
              ? "bg-gradient-to-r from-yellow-400 via-orange-500 to-yellow-700 text-black animate-glow"
              : "bg-gray-800 text-white"
          }`}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">{type} Card</h3>
            {premium && (
              <span className="px-2 py-1 rounded-full bg-black/20 text-black font-semibold">
                Elite
              </span>
            )}
          </div>
          <p className="tracking-widest text-xl">
            **** **** **** {number.slice(-4)}
          </p>
        </div>
        {/* Back */}
        <div className="absolute inset-0 rotate-y-180 backface-hidden rounded-xl shadow-xl bg-black text-yellow-300 flex items-center justify-center">
          {premium ? "💎 No Limit — Elite Access" : "Basic Card"}
        </div>
      </div>
    </div>
  );
}
