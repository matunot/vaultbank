import { useAppStore } from '../store';
import SavingsGoals from './SavingsGoals';
import BudgetPanel from './BudgetPanel';
import CurrencyConverter from './CurrencyConverter';
import InvestmentsPanel from './InvestmentsPanel';
import CalendarEvents from './CalendarEvents';
import QuickContacts from './QuickContacts';
import AchievementsPanel from './AchievementsPanel';
import SmartInsights from './SmartInsights';

/**
 * Development-only dashboard sample panels.
 *
 * Loaded dynamically only when `import.meta.env.DEV` is true, so the sample
 * data widgets (and their animation/runtime dependencies) never ship in the
 * production entry graph.
 */
export default function DashboardDevPanels() {
  const store = useAppStore();

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <SavingsGoals goals={store.goals} onAddToGoal={store.addToGoal} />
        <BudgetPanel budget={store.budget} />
        <CurrencyConverter />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <InvestmentsPanel />
        <CalendarEvents />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <QuickContacts />
        <AchievementsPanel />
        <SmartInsights />
      </div>
    </>
  );
}
