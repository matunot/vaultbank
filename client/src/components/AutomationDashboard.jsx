import React, { useState, useEffect } from "react";
import {
  Plus,
  Rule,
  History,
  Trash2,
  Play,
  Pause,
  AlertTriangle,
  DollarSign,
  PiggyBank,
  CreditCard,
} from "lucide-react";
import api from "../utils/api";

const AutomationDashboard = () => {
  const [activeTab, setActiveTab] = useState("rules");
  const [rules, setRules] = useState([]);
  const [templates, setTemplates] = useState({});
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [newRule, setNewRule] = useState({
    name: "",
    type: "",
    condition: {},
    action: {},
  });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Load rules and templates on mount
  useEffect(() => {
    loadRules();
    loadTemplates();
  }, []);

  // Load history when history tab is selected
  useEffect(() => {
    if (activeTab === "history") {
      loadHistory();
    }
  }, [activeTab]);

  const loadRules = async () => {
    try {
      const response = await api.get("/automation/rules");
      setRules(response.data.rules);
    } catch (error) {
      console.error("Error loading rules:", error);
      setError("Failed to load automation rules");
    }
  };

  const loadTemplates = async () => {
    try {
      const response = await api.get("/automation/templates");
      setTemplates(response.data.templates);
    } catch (error) {
      console.error("Error loading templates:", error);
    }
  };

  const loadHistory = async () => {
    try {
      const response = await api.get("/audit/me");

      // Filter for automation-related actions
      const automationLogs = response.data.data.logs.filter(
        (log) =>
          log.action === "AUTOMATION_RULE_TRIGGERED" ||
          log.action === "AUTOMATION_RULE_ERROR"
      );

      // Transform logs to match expected format
      const historyData = automationLogs.map((log) => ({
        id: log._id,
        message: log.details.ruleName
          ? `${log.details.ruleName} was ${
              log.action === "AUTOMATION_RULE_TRIGGERED"
                ? "triggered"
                : "encountered an error"
            }`
          : log.action.replace("_", " ").toLowerCase(),
        timestamp: new Date(log.createdAt).toLocaleString(),
      }));

      setHistory(historyData);
    } catch (error) {
      console.error("Error loading history:", error);
      setError("Failed to load automation history");
    }
  };

  const handleCreateRule = async (ruleData) => {
    setLoading(true);
    setError("");

    try {
      const response = await api.post("/automation/rules", ruleData);
      setRules([...rules, response.data.rule]);
      setIsCreateModalOpen(false);
      setSelectedTemplate(null);
      setNewRule({
        name: "",
        type: "",
        condition: {},
        action: {},
      });
      setSuccess("Automation rule created successfully!");
    } catch (error) {
      console.error("Error creating rule:", error);
      setError(
        error.response?.data?.message || "Failed to create automation rule"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRuleStatus = async (ruleId) => {
    try {
      const response = await api.patch(`/automation/rules/${ruleId}/toggle`);
      const updatedRules = rules.map((rule) =>
        rule.id === ruleId
          ? { ...rule, status: response.data.rule.status }
          : rule
      );
      setRules(updatedRules);
      setSuccess(`Rule ${response.data.rule.status}`);
    } catch (error) {
      console.error("Error toggling rule:", error);
      setError("Failed to toggle rule status");
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (
      window.confirm("Are you sure you want to delete this automation rule?")
    ) {
      try {
        await api.delete(`/automation/rules/${ruleId}`);
        const updatedRules = rules.filter((rule) => rule.id !== ruleId);
        setRules(updatedRules);
        setSuccess("Automation rule deleted successfully!");
      } catch (error) {
        console.error("Error deleting rule:", error);
        setError("Failed to delete automation rule");
      }
    }
  };

  const RuleCard = ({ rule }) => {
    const getTypeIcon = (type) => {
      switch (type) {
        case "auto_transfer":
          return <DollarSign className="h-5 w-5 text-green-600" />;
        case "spending_alert":
          return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
        case "savings_goal":
          return <PiggyBank className="h-5 w-5 text-blue-600" />;
        case "budget_limit":
          return <CreditCard className="h-5 w-5 text-red-600" />;
        default:
          return <Rule className="h-5 w-5 text-gray-600" />;
      }
    };

    const getTypeColor = (type) => {
      switch (type) {
        case "auto_transfer":
          return "bg-green-50 border-green-200";
        case "spending_alert":
          return "bg-yellow-50 border-yellow-200";
        case "savings_goal":
          return "bg-blue-50 border-blue-200";
        case "budget_limit":
          return "bg-red-50 border-red-200";
        default:
          return "bg-gray-50 border-gray-200";
      }
    };

    return (
      <div className={`p-4 border rounded-lg ${getTypeColor(rule.type)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {getTypeIcon(rule.type)}
            <div>
              <h3 className="font-medium text-gray-900">{rule.name}</h3>
              <p className="text-sm text-gray-500 capitalize">
                {rule.type.replace("_", " ")}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span
              className={`px-2 py-1 text-xs rounded-full ${
                rule.status === "active"
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {rule.status}
            </span>
            <button
              onClick={() => handleToggleRuleStatus(rule.id)}
              className={`p-1 rounded ${
                rule.status === "active"
                  ? "text-yellow-600 hover:bg-yellow-50"
                  : "text-green-600 hover:bg-green-50"
              }`}
              title={rule.status === "active" ? "Pause rule" : "Activate rule"}
            >
              {rule.status === "active" ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => handleDeleteRule(rule.id)}
              className="p-1 text-red-600 hover:bg-red-50 rounded"
              title="Delete rule"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 text-sm text-gray-600">
          <p>
            <strong>Triggered:</strong> {rule.triggerCount} times
          </p>
          <p>
            <strong>Success:</strong> {rule.successCount} times
          </p>
          {rule.lastTriggered && (
            <p>
              <strong>Last run:</strong>{" "}
              {new Date(rule.lastTriggered).toLocaleDateString()}
            </p>
          )}
          {rule.lastError && (
            <p className="text-red-600">
              <strong>Error:</strong> {rule.lastError.message}
            </p>
          )}
        </div>
      </div>
    );
  };

  const CreateRuleWizard = ({ template, rule, onSave, onCancel, loading }) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [formData, setFormData] = useState(
      rule || {
        name: template?.name || "",
        type: template?.type || "",
        condition: template?.condition || {},
        action: template?.action || {},
      }
    );

    const steps = [
      { title: "Basic Info", fields: ["name", "type"] },
      { title: "Conditions", fields: ["condition"] },
      { title: "Actions", fields: ["action"] },
    ];

    const handleNext = () => {
      if (currentStep < steps.length - 1) {
        setCurrentStep(currentStep + 1);
      }
    };

    const handlePrev = () => {
      if (currentStep > 0) {
        setCurrentStep(currentStep - 1);
      }
    };

    const handleSubmit = () => {
      onSave(formData);
    };

    const renderBasicFields = () => (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Rule Name
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            placeholder="Enter rule name"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Rule Type
          </label>
          <select
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">Select type</option>
            <option value="auto_transfer">Auto Transfer</option>
            <option value="spending_alert">Spending Alert</option>
            <option value="savings_goal">Savings Goal</option>
            <option value="budget_limit">Budget Limit</option>
          </select>
        </div>
      </div>
    );

    const renderConditionFields = () => (
      <div className="space-y-4">
        {formData.type === "auto_transfer" && (
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Day of Week
            </label>
            <select
              value={formData.condition.dayOfWeek || ""}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  condition: {
                    ...formData.condition,
                    dayOfWeek: parseInt(e.target.value),
                  },
                })
              }
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">Select day</option>
              <option value="0">Sunday</option>
              <option value="1">Monday</option>
              <option value="2">Tuesday</option>
              <option value="3">Wednesday</option>
              <option value="4">Thursday</option>
              <option value="5">Friday</option>
              <option value="6">Saturday</option>
            </select>
          </div>
        )}

        {(formData.type === "spending_alert" ||
          formData.type === "budget_limit") && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Category
              </label>
              <select
                value={formData.condition.category || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    condition: {
                      ...formData.condition,
                      category: e.target.value,
                    },
                  })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">Select category</option>
                <option value="food">Food & Dining</option>
                <option value="shopping">Shopping</option>
                <option value="entertainment">Entertainment</option>
                <option value="transportation">Transportation</option>
                <option value="utilities">Utilities</option>
                <option value="healthcare">Healthcare</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Amount ($)
              </label>
              <input
                type="number"
                value={formData.condition.amount || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    condition: {
                      ...formData.condition,
                      amount: parseFloat(e.target.value),
                    },
                  })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="0.00"
              />
            </div>
          </>
        )}

        {formData.type === "savings_goal" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Goal Amount ($)
              </label>
              <input
                type="number"
                value={formData.condition.goalAmount || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    condition: {
                      ...formData.condition,
                      goalAmount: parseFloat(e.target.value),
                    },
                  })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="5000.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Monthly Transfer ($)
              </label>
              <input
                type="number"
                value={formData.condition.monthlyTransfer || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    condition: {
                      ...formData.condition,
                      monthlyTransfer: parseFloat(e.target.value),
                    },
                  })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="200.00"
              />
            </div>
          </>
        )}
      </div>
    );

    const renderActionFields = () => (
      <div className="space-y-4">
        {(formData.type === "auto_transfer" ||
          formData.type === "savings_goal") && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Amount ($)
              </label>
              <input
                type="number"
                value={formData.action.amount || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    action: {
                      ...formData.action,
                      amount: parseFloat(e.target.value),
                    },
                  })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="500.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                From Account
              </label>
              <input
                type="text"
                value={formData.action.fromAccountId || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    action: {
                      ...formData.action,
                      fromAccountId: e.target.value,
                    },
                  })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Enter account ID"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                To Account
              </label>
              <input
                type="text"
                value={formData.action.toAccountId || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    action: { ...formData.action, toAccountId: e.target.value },
                  })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Enter account ID"
              />
            </div>
          </>
        )}

        {(formData.type === "spending_alert" ||
          formData.type === "budget_limit") && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Message
              </label>
              <textarea
                value={formData.action.message || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    action: { ...formData.action, message: e.target.value },
                  })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                rows={3}
                placeholder="Enter alert message"
              />
            </div>
            {formData.type === "spending_alert" && (
              <div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.action.autoNotify || false}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        action: {
                          ...formData.action,
                          autoNotify: e.target.checked,
                        },
                      })
                    }
                    className="mr-2"
                  />
                  Auto-notify when triggered
                </label>
              </div>
            )}
            {formData.type === "budget_limit" && (
              <div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.action.blockTransactions || false}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        action: {
                          ...formData.action,
                          blockTransactions: e.target.checked,
                        },
                      })
                    }
                    className="mr-2"
                  />
                  Block further transactions
                </label>
              </div>
            )}
          </>
        )}
      </div>
    );

    return (
      <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
        <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
          <div className="mt-3">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Create Automation Rule
            </h3>

            {/* Progress indicator */}
            <div className="flex mb-6">
              {steps.map((step, index) => (
                <div key={index} className="flex items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      index <= currentStep
                        ? "bg-blue-500 text-white"
                        : "bg-gray-200 text-gray-600"
                    }`}
                  >
                    {index + 1}
                  </div>
                  {index < steps.length - 1 && (
                    <div className="w-12 h-1 bg-gray-200"></div>
                  )}
                </div>
              ))}
            </div>

            <div className="mb-6">
              <h4 className="text-md font-medium mb-2">
                {steps[currentStep].title}
              </h4>
              {currentStep === 0 && renderBasicFields()}
              {currentStep === 1 && renderConditionFields()}
              {currentStep === 2 && renderActionFields()}
            </div>

            <div className="flex justify-between">
              <button
                onClick={handlePrev}
                disabled={currentStep === 0}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded disabled:opacity-50"
              >
                Previous
              </button>

              {currentStep < steps.length - 1 ? (
                <button
                  onClick={handleNext}
                  disabled={!formData.name || !formData.type}
                  className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="px-4 py-2 bg-green-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Creating..." : "Create Rule"}
                </button>
              )}
            </div>
          </div>

          <button
            onClick={onCancel}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
      </div>
    );
  };

  const templateIcons = {
    auto_transfer: DollarSign,
    spending_alert: AlertTriangle,
    savings_goal: PiggyBank,
    budget_limit: CreditCard,
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Automation Engine
        </h1>
        <p className="text-gray-600">
          Create intelligent rules to automate your banking activities
        </p>
      </div>

      {/* Success/Error messages */}
      {success && (
        <div className="mb-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
          {success}
        </div>
      )}
      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab("rules")}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === "rules"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <Rule className="inline h-5 w-5 mr-2" />
            My Rules
          </button>
          <button
            onClick={() => setActiveTab("create")}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === "create"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <Plus className="inline h-5 w-5 mr-2" />
            Create Rule
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === "history"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <History className="inline h-5 w-5 mr-2" />
            History
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "rules" && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Your Automation Rules</h2>
            <button
              onClick={() => setActiveTab("create")}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center"
            >
              <Plus className="h-5 w-5 mr-2" />
              Create Rule
            </button>
          </div>

          {rules.length === 0 ? (
            <div className="text-center py-12">
              <Rule className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                No automation rules
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Get started by creating your first automation rule.
              </p>
              <div className="mt-6">
                <button
                  onClick={() => setActiveTab("create")}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                  Create your first rule
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rules.map((rule) => (
                <RuleCard key={rule.id} rule={rule} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "create" && (
        <div>
          <h2 className="text-xl font-semibold mb-6">
            Create New Automation Rule
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {Object.entries(templates).map(([key, template]) => {
              const IconComponent = templateIcons[key] || Rule;
              return (
                <div
                  key={key}
                  onClick={() => {
                    setSelectedTemplate(template);
                    setNewRule({
                      name: template.name,
                      type: template.type,
                      condition: template.condition,
                      action: template.action,
                    });
                    setIsCreateModalOpen(true);
                  }}
                  className="p-4 border border-gray-200 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors"
                >
                  <div className="flex items-center mb-2">
                    <IconComponent className="h-6 w-6 text-blue-600 mr-2" />
                    <h3 className="font-medium">{template.name}</h3>
                  </div>
                  <p className="text-sm text-gray-600">
                    {key === "auto_transfer" &&
                      "Automatically transfer money on a schedule."}
                    {key === "spending_alert" &&
                      "Get notified when spending reaches a threshold."}
                    {key === "savings_goal" &&
                      "Automatically save for your goals."}
                    {key === "budget_limit" &&
                      "Block spending when budget is exceeded."}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div>
          <h2 className="text-xl font-semibold mb-6">Automation History</h2>

          {history.length === 0 ? (
            <div className="text-center py-12">
              <History className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                No automation history
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                History of triggered automations will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="p-4 border border-gray-200 rounded-lg"
                >
                  <p className="text-gray-900">{item.message}</p>
                  <p className="text-sm text-gray-600">{item.timestamp}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Rule Modal */}
      {isCreateModalOpen && (
        <CreateRuleWizard
          template={selectedTemplate}
          rule={newRule}
          onSave={handleCreateRule}
          onCancel={() => {
            setIsCreateModalOpen(false);
            setSelectedTemplate(null);
            setNewRule({
              name: "",
              type: "",
              condition: {},
              action: {},
            });
          }}
          loading={loading}
        />
      )}
    </div>
  );
};

export default AutomationDashboard;
