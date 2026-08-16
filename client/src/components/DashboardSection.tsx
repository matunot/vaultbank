import { memo } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Send } from 'lucide-react';
import HeroBalance from './HeroBalance';
import QuickActions from './QuickActions';
import SpendingPanel from './SpendingPanel';
import Transactions from './Transactions';
import SavingsGoals from './SavingsGoals';
import BudgetPanel from './BudgetPanel';
import CurrencyConverter from './CurrencyConverter';
import CardsPanel from './CardsPanel';
import InvestmentsPanel from './InvestmentsPanel';
import CalendarEvents from './CalendarEvents';
import QuickContacts from './QuickContacts';
import AchievementsPanel from './AchievementsPanel';
import SmartInsights from './SmartInsights';
import { useAppStore } from '../store';
import { useAccountData, TransactionData } from '../hooks/useAccountData';

const Section = memo(({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) => (
  <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}>
    {children}
  </motion.div>
));

Section.displayName = 'Section';

interface Props {
  onOpenModal: (modal: string) => void;
  userName?: string;
  accountNumber?: string;
}

function mapTransaction(tx: TransactionData, index: number) {
  return {
    id: typeof tx.id === 'number' ? tx.id : index,
    name: tx.description || 'Transaction',
    cat: (tx.category || 'Other').charAt(0).toUpperCase() + (tx.category || 'other').slice(1),
    amount: tx.type === 'debit' ? -Math.abs(tx.amount) : Math.abs(tx.amount),
    date: tx.date ? new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today',
    icon: tx.type === 'credit' ? (tx.category === 'income' ? '💰' : '⬇️') : '💸',
    gem: tx.type === 'credit' ? 'emerald' : 'ruby',
  };
}

const DashboardSection = memo(function DashboardSection({ onOpenModal, userName = 'Guest', accountNumber }: Props) {
  const store = useAppStore();
  const { balance, account, transactions: apiTransactions, loading } = useAccountData();
  const realTransactions = apiTransactions.length
    ? apiTransactions.map(mapTransaction)
    : store.transactions;
  const income = realTransactions.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  const displayAccountNumber = accountNumber || account?.accountNumber;
  const displayBalance = balance?.total ?? 0;

  return (
    <div className="space-y-5">
      {/* Hero greeting */}
      <Section delay={0.05}>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="font-display text-3xl lg:text-5xl text-white tracking-tight">
                Good <span className="text-gold">evening</span>, {userName}
              </h1>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 12, repeat: Infinity, ease: 'linear' }} className="hidden md:block">
                <Sparkles className="w-5 h-5 lg:w-6 lg:h-6 text-amber-400/60" />
              </motion.div>
            </div>
            <p className="text-sm text-white/40">
              Tuesday, December 24 · Your portfolio is up <span className="text-emerald-400 font-semibold">14.2%</span> this month
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onOpenModal('send')}
            className="hidden lg:flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold text-sm shadow-lg glow-amber"
          >
            <Send className="w-4 h-4" /> Quick Send
          </motion.button>
        </div>
      </Section>

      <Section delay={0.1}>
        <HeroBalance
          balance={displayBalance}
          accountNumber={displayAccountNumber}
          loading={loading}
          income={income}
        />
      </Section>

      <Section delay={0.15}>
        <QuickActions
          onSend={() => onOpenModal('send')}
          onDeposit={() => onOpenModal('deposit')}
          onPayBill={() => onOpenModal('bill')}
          onConvert={() => onOpenModal('convert')}
          onWire={() => onOpenModal('wire')}
          onMobile={() => onOpenModal('mobile')}
        />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Section delay={0.2}><Transactions transactions={realTransactions} loading={loading} /></Section>
        </div>
        <Section delay={0.25}><SpendingPanel /></Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Section delay={0.3}><SavingsGoals goals={store.goals} onAddToGoal={store.addToGoal} /></Section>
        <Section delay={0.35}><BudgetPanel budget={store.budget} /></Section>
        <Section delay={0.4}><CurrencyConverter /></Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        <div className="lg:col-span-2">
          <Section delay={0.45}><CardsPanel cards={store.cards} onLockCard={store.lockCard} formatMoney={store.formatMoney} /></Section>
        </div>
        <Section delay={0.5}><InvestmentsPanel /></Section>
        <Section delay={0.55}><CalendarEvents /></Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Section delay={0.6}><QuickContacts /></Section>
        <Section delay={0.65}><AchievementsPanel /></Section>
        <Section delay={0.7}><SmartInsights /></Section>
      </div>
    </div>
  );
});

export default DashboardSection;
