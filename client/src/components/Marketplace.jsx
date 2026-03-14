import { useState, useEffect } from "react";
import {
  FaShoppingCart,
  FaCoins,
  FaGift,
  FaClock,
  FaStar,
  FaLock,
  FaCheckCircle,
  FaCopy,
} from "react-icons/fa";

export default function Marketplace({ subscription, onRewardsUpdate }) {
  const [items, setItems] = useState([]);
  const [redeemedItems, setRedeemedItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(null);
  const [activeTab, setActiveTab] = useState("store"); // 'store' or 'redeemed'
  const [error, setError] = useState(null);
  const [userPoints, setUserPoints] = useState(0);

  // Fetch marketplace items
  const fetchItems = async () => {
    try {
      const response = await fetch("/api/marketplace/items", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      const data = await response.json();
      if (data.success) {
        setItems(data.data);
      } else {
        setError(data.message);
      }
    } catch (err) {
      console.error("Failed to fetch marketplace items:", err);
      setError("Failed to load marketplace");
    } finally {
      setLoading(false);
    }
  };

  // Fetch user's redeemed items
  const fetchRedeemedItems = async () => {
    try {
      const response = await fetch("/api/marketplace/redeemed", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      const data = await response.json();
      if (data.success) {
        setRedeemedItems(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch redeemed items:", err);
    }
  };

  // Fetch user rewards balance
  const fetchUserPoints = async () => {
    try {
      const response = await fetch("/api/rewards/me", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      const data = await response.json();
      if (data.success) {
        setUserPoints(data.data.points || 0);
      }
    } catch (err) {
      console.error("Failed to fetch user points:", err);
    }
  };

  useEffect(() => {
    fetchItems();
    fetchRedeemedItems();
    fetchUserPoints();
  }, []);

  // Handle item redemption
  const handleRedeem = async (item) => {
    if (userPoints < item.costPoints) {
      alert("❌ Insufficient reward points!");
      return;
    }

    setRedeeming(item._id);

    try {
      const response = await fetch("/api/marketplace/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          marketplaceItemId: item._id,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert(data.data.message);

        // Update local state
        setUserPoints(data.data.newBalance);
        await fetchRedeemedItems(); // Refresh redeemed items
        await fetchItems(); // Refresh available items (in case of limited stock)

        // Notify parent component
        if (onRewardsUpdate) {
          onRewardsUpdate();
        }

        // Copy voucher code to clipboard if applicable
        if (data.data.redeemedItem.voucherCode) {
          navigator.clipboard
            .writeText(data.data.redeemedItem.voucherCode)
            .then(() => {
              alert("🎁 Voucher code copied to clipboard!");
            })
            .catch(() => {
              alert(`🎁 Voucher Code: ${data.data.redeemedItem.voucherCode}`);
            });
        }
      } else {
        alert(`❌ ${data.message}`);
      }
    } catch (err) {
      console.error("Redemption error:", err);
      alert("❌ Redemption failed. Please try again.");
    } finally {
      setRedeeming(null);
    }
  };

  // Copy voucher code
  const copyVoucherCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      alert("✅ Voucher code copied to clipboard!");
    } catch (err) {
      alert(`Voucher Code: ${code}`);
    }
  };

  // Get category icon
  const getCategoryIcon = (category) => {
    const icons = {
      shopping: "🛒",
      food: "🍽️",
      entertainment: "🎬",
      lifestyle: "✨",
      financial: "💰",
      premium: "💎",
    };
    return icons[category] || "🎁";
  };

  // Get item type styling
  const getTypeStyling = (type) => {
    switch (type) {
      case "voucher":
        return {
          bg: "bg-green-500/10",
          border: "border-green-500/30",
          text: "text-green-400",
          icon: <FaGift className="text-green-400" />,
        };
      case "perk":
        return {
          bg: "bg-blue-500/10",
          border: "border-blue-500/30",
          text: "text-blue-400",
          icon: <FaStar className="text-blue-400" />,
        };
      case "upgrade":
        return {
          bg: "bg-purple-500/10",
          border: "border-purple-500/30",
          text: "text-purple-400",
          icon: <FaClock className="text-purple-400" />,
        };
      case "service":
        return {
          bg: "bg-orange-500/10",
          border: "border-orange-500/30",
          text: "text-orange-400",
          icon: <FaShoppingCart className="text-orange-400" />,
        };
      default:
        return {
          bg: "bg-gray-500/10",
          border: "border-gray-500/30",
          text: "text-gray-400",
          icon: <FaGift className="text-gray-400" />,
        };
    }
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-indigo-900/50 to-purple-900/50 text-white p-8 rounded-xl shadow-xl">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400 mx-auto mb-4"></div>
          <p>Loading marketplace...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gradient-to-br from-red-900/50 to-red-800/50 text-white p-8 rounded-xl shadow-xl">
        <div className="text-center">
          <p className="text-red-300">❌ {error}</p>
          <button
            onClick={fetchItems}
            className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-900/50 to-purple-900/50 text-white p-6 rounded-xl shadow-xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-3xl font-bold mb-2">
              🏪 VaultBank Marketplace
            </h2>
            <p className="text-blue-200">
              Spend your reward points on amazing items!
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Points Balance */}
            <div className="flex items-center gap-2 bg-black/30 rounded-lg px-4 py-2">
              <FaCoins className="text-yellow-400" />
              <span className="font-bold text-yellow-400">
                {userPoints.toLocaleString()}
              </span>
              <span className="text-gray-300">points</span>
            </div>

            {/* Tier Info */}
            <div className="text-sm text-gray-300">
              {userPoints >= 15000
                ? "💎 Platinum Member"
                : userPoints >= 5000
                ? "🥈 Gold Member"
                : "🥉 Silver Member"}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 bg-gray-800 p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab("store")}
          className={`px-6 py-2 rounded-md font-medium transition-all ${
            activeTab === "store"
              ? "bg-blue-600 text-white shadow"
              : "text-gray-300 hover:text-white hover:bg-gray-700"
          }`}
        >
          🛍️ Store
        </button>
        <button
          onClick={() => setActiveTab("redeemed")}
          className={`px-6 py-2 rounded-md font-medium transition-all ${
            activeTab === "redeemed"
              ? "bg-blue-600 text-white shadow"
              : "text-gray-300 hover:text-white hover:bg-gray-700"
          }`}
        >
          📦 My Rewards ({redeemedItems.length})
        </button>
      </div>

      {activeTab === "store" ? (
        /* Marketplace Store */
        <>
          {/* Categories */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {[
              "shopping",
              "food",
              "entertainment",
              "lifestyle",
              "financial",
              "premium",
            ].map((category) => {
              const count = items.filter(
                (item) => item.category === category
              ).length;
              return (
                <button
                  key={category}
                  className="bg-gray-800/80 hover:bg-gray-700 text-white p-3 rounded-lg transition-colors text-sm"
                  onClick={() => {
                    // Would implement category filtering
                  }}
                >
                  {getCategoryIcon(category)}{" "}
                  {category.charAt(0).toUpperCase() + category.slice(1)} (
                  {count})
                </button>
              );
            })}
          </div>

          {/* Items Grid */}
          {items.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {items.map((item) => {
                const typeStyle = getTypeStyling(item.type);
                const canAfford = userPoints >= item.costPoints;
                const isLimited = item.isLimited && item.stockRemaining < 100;
                const isSoldOut = item.stockRemaining === 0;

                return (
                  <div
                    key={item._id}
                    className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 hover:scale-105 border-2 ${typeStyle.border} relative`}
                  >
                    {/* Limited Badge */}
                    {isLimited && !isSoldOut && (
                      <div className="absolute top-2 left-2 bg-red-500 text-white px-2 py-1 rounded-full text-xs font-semibold z-10">
                        🔥 Limited ({item.stockRemaining} left)
                      </div>
                    )}

                    {/* Sold Out Overlay */}
                    {isSoldOut && (
                      <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20">
                        <div className="text-center text-white">
                          <FaLock className="text-4xl mx-auto mb-2" />
                          <p className="font-bold text-lg">SOLD OUT</p>
                        </div>
                      </div>
                    )}

                    {/* Item Content */}
                    <div className={`p-6 bg-gradient-to-br ${typeStyle.bg}`}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-4xl">{typeStyle.icon}</div>
                        <div className="text-right">
                          <div
                            className={`font-bold text-2xl ${typeStyle.text}`}
                          >
                            {item.costPoints.toLocaleString()}
                          </div>
                          <div className="text-xs text-gray-500">points</div>
                        </div>
                      </div>

                      <h3 className="text-xl font-bold mb-2 text-gray-900 dark:text-white">
                        {item.name}
                      </h3>

                      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                        {item.description}
                      </p>

                      <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
                        <span>
                          {getCategoryIcon(item.category)} {item.provider}
                        </span>
                        {item.value && (
                          <span className="font-semibold">
                            Worth ₹{item.value}
                          </span>
                        )}
                      </div>

                      {/* Redemption Button */}
                      <button
                        onClick={() => handleRedeem(item)}
                        disabled={
                          !canAfford || redeeming === item._id || isSoldOut
                        }
                        className={`w-full py-3 px-4 rounded-lg font-semibold transition-all duration-200 ${
                          canAfford && !isSoldOut
                            ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 shadow-lg hover:shadow-xl transform hover:scale-105"
                            : "bg-gray-300 text-gray-500 cursor-not-allowed opacity-60"
                        }`}
                      >
                        {redeeming === item._id ? (
                          <div className="flex items-center justify-center">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Redeeming...
                          </div>
                        ) : isSoldOut ? (
                          "Out of Stock"
                        ) : canAfford ? (
                          "🎁 Redeem Now"
                        ) : (
                          <div className="flex flex-col items-center">
                            <span>
                              Need{" "}
                              {(item.costPoints - userPoints).toLocaleString()}{" "}
                              more
                            </span>
                            <span className="text-xs">points</span>
                          </div>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <FaShoppingCart className="text-6xl text-gray-400 mx-auto mb-4" />
              <p className="text-xl text-gray-500">
                No items available at the moment
              </p>
              <p className="text-sm text-gray-400">
                Check back later for new items!
              </p>
            </div>
          )}
        </>
      ) : (
        /* Redeemed Items */
        <>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
            <h3 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">
              📦 Your Redeemed Rewards
            </h3>

            {redeemedItems.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {redeemedItems.map((item) => {
                  const typeStyle = getTypeStyling(item.type);
                  const isVoucher = item.type === "voucher";
                  const hasExpired = isVoucher && item.isExpired;

                  return (
                    <div
                      key={item._id}
                      className={`p-4 rounded-lg border-2 ${typeStyle.border} ${
                        typeStyle.bg
                      } ${hasExpired ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="text-2xl">{typeStyle.icon}</div>
                          <div>
                            <h4 className="font-bold text-gray-900 dark:text-white">
                              {item.itemName}
                            </h4>
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                              {item.itemDescription}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {getCategoryIcon("")} {item.provider} •{" "}
                              {new Date(item.redeemedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-lg font-bold text-blue-600">
                            -{item.pointsSpent.toLocaleString()}
                          </div>
                          <div className="text-xs text-gray-500">points</div>
                        </div>
                      </div>

                      {/* Voucher Code */}
                      {item.voucherCode && (
                        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                                Voucher Code
                              </p>
                              <p className="font-mono text-lg font-bold text-green-600 break-all">
                                {item.voucherCode}
                              </p>
                              {item.expiryDate && (
                                <p className="text-xs text-gray-500 mt-1">
                                  Expires:{" "}
                                  {new Date(
                                    item.expiryDate
                                  ).toLocaleDateString()}
                                  {hasExpired && (
                                    <span className="text-red-500 ml-2">
                                      • Expired
                                    </span>
                                  )}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => copyVoucherCode(item.voucherCode)}
                              className="p-2 bg-gray-200 dark:bg-gray-600 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                              title="Copy code"
                            >
                              <FaCopy className="text-gray-600 dark:text-gray-300" />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Service/Upgrade Status */}
                      {(item.type === "service" || item.type === "upgrade") && (
                        <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                          <div className="flex items-center gap-2">
                            <FaCheckCircle className="text-green-600" />
                            <p className="text-sm font-medium text-green-700 dark:text-green-300">
                              {item.type === "upgrade"
                                ? "Subscription Upgraded!"
                                : "Service Activated!"}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <FaGift className="text-6xl text-gray-400 mx-auto mb-4" />
                <p className="text-xl text-gray-500">No redeemed items yet</p>
                <p className="text-sm text-gray-400 mb-4">
                  Start earning points by making transactions and complete
                  goals!
                </p>
                <button
                  onClick={() => setActiveTab("store")}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  🛍️ Browse Marketplace
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* How to Earn More Points */}
      <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 dark:from-blue-600/20 dark:to-purple-600/20 rounded-xl p-6 border border-blue-500/20">
        <h3 className="text-xl font-bold mb-4 text-center text-gray-900 dark:text-white">
          🚀 Earn More Points
        </h3>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-3xl mb-2">💳</div>
            <div className="font-semibold mb-1">Transactions</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              1 point per ₹100 spent
            </div>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-2">👥</div>
            <div className="font-semibold mb-1">Referrals</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              500 points when friends join
            </div>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-2">🎯</div>
            <div className="font-semibold mb-1">Goals</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              200 points per goal completed
            </div>
          </div>
        </div>

        <div className="text-center mt-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Higher tiers get bonus points (Gold: +5%, Platinum: +10%)
          </div>
        </div>
      </div>
    </div>
  );
}
