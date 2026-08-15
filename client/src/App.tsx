import { useState, useCallback, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield } from 'lucide-react';

import LoginPage from './components/LoginPage';
import SignupPage from './components/SignupPage';
import SettingsModal from './components/SettingsModal';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import MarketTicker from './components/MarketTicker';
import DashboardSection from './components/DashboardSection';
import ErrorBoundary from './components/ErrorBoundary';
import { TransferModal, DepositModal, PayBillModal, ConvertModal, WireModal, MobileModal, TradeModal } from './components/Modals';
import { useAppStore } from './store';
import { api } from './api';

// Lazy load heavy sections
const CardsSection = lazy(() => import('./components/CardsSection'));
const PaymentsSection = lazy(() => import('./components/PaymentsSection'));
const InvestmentsSection = lazy(() => import('./components/InvestmentsSection'));
const VaultSection = lazy(() => import('./components/VaultSection'));
const DebtsSection = lazy(() => import('./components/DebtsSection'));
const SwissSection = lazy(() => import('./components/SwissSection'));
const BudgetSection = lazy(() => import('./components/BudgetSection'));
const TransferSection = lazy(() => import('./components/TransferSection'));
const HistorySection = lazy(() => import('./components/HistorySection'));
const RewardsSection = lazy(() => import('./components/RewardsSection'));
const SecuritySection = lazy(() => import('./components/SecuritySection'));

// Loading fallback
const SectionLoader = () => (
  <div className="flex items-center justify-center min-h-100">
    <div className="relative">
      <div className="w-12 h-12 rounded-full border-2 border-amber-500/20 border-t-amber-500 animate-spin" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-6 h-6 rounded-full bg-amber-500/20 animate-pulse" />
      </div>
    </div>
  </div>
);

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => api.isAuthenticated());
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [theme, setTheme] = useState<'obsidian' | 'royal' | 'diamond'>('obsidian');
  const [active, setActive] = useState('home');
  const [modal, setModal] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const store = useAppStore();
  const currentUser = api.getUser();
  const currentAccount = api.getAccount();
  const userName = currentUser ? (currentUser.full_name || currentUser.fullName || 'Guest') : 'Guest';
  const firstName = userName.split(' ')[0] || 'Guest';

  const openModal = useCallback((name: string) => setModal(name), []);
  const closeModal = useCallback(() => setModal(null), []);

  const handleSend = useCallback(async (recipient: string, amount: number, note?: string) => {
    await store.sendMoney(recipient, amount, note);
    closeModal();
  }, [store, closeModal]);

  const handleTrade = useCallback(async (ticker: string, action: 'buy' | 'sell', shares: number): Promise<boolean> => {
    await store.executeTrade(ticker, action, shares);
    closeModal();
    return true;
  }, [store, closeModal]);

  if (!isAuthenticated) {
    if (authMode === 'signup') {
      return <SignupPage onSignup={() => setIsAuthenticated(true)} onSwitchToLogin={() => setAuthMode('login')} />;
    }
    return <LoginPage onLogin={() => setIsAuthenticated(true)} onSwitchToSignup={() => setAuthMode('signup')} />;
  }

  return (
    <div className={`min-h-screen text-white grain relative overflow-hidden theme-${theme}`}>
      {/* Luxury diamond/gold background only */}
      <div className="luxury-bg" />
      <div className="fixed inset-0 pointer-events-none will-change-transform z-0">
        <div className="diamond-aura gold -top-32 left-[12%] w-136 h-136" />
        <div className="diamond-aura diamond top-[8%] right-[6%] w-120 h-120" style={{ animationDelay: '1.5s' }} />
        <div className="diamond-aura purple -bottom-40 right-[22%] w-xl h-144" style={{ animationDelay: '3s' }} />
        <div className="diamond-aura gold bottom-[8%] left-[2%] w-88 h-88" style={{ animationDelay: '4.5s' }} />
      </div>

      <MarketTicker />

      <div className="flex relative z-10">
        <Sidebar active={active} setActive={setActive} onSettings={() => setShowSettings(true)} onLogout={() => setIsAuthenticated(false)} />

        <main className="flex-1 overflow-y-auto h-screen min-w-0">
          <Header theme={theme} onThemeChange={setTheme} />

          <div className="px-5 lg:px-8 pb-12">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <ErrorBoundary>
                  <Suspense fallback={<SectionLoader />}>
                    {active === 'home' && <DashboardSection onOpenModal={openModal} userName={firstName} accountNumber={currentAccount ? currentAccount.accountNumber : undefined} />}
                    {active === 'vault' && <VaultSection />}
                    {active === 'swiss' && <SwissSection />}
                    {active === 'cards' && <CardsSection cards={store.cards} onLockCard={store.lockCard} formatMoney={store.formatMoney} />}
                    {active === 'payments' && <PaymentsSection />}
                    {active === 'invest' && <InvestmentsSection investments={store.investments} onOpenTrade={() => openModal('trade')} />}
                    {active === 'loans' && <DebtsSection />}
                    {active === 'budget' && <BudgetSection />}
                    {active === 'send' && <TransferSection />}
                    {active === 'history' && <HistorySection />}
                    {active === 'rewards' && <RewardsSection />}
                    {active === 'security' && <SecuritySection />}
                  </Suspense>
                </ErrorBoundary>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="text-center pt-2 pb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass">
              <Shield className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[10px] tracking-widest font-semibold text-white/30">
                END-TO-END ENCRYPTED · FDIC INSURED · 256-BIT SSL
              </span>
            </div>
          </motion.div>
        </main>
      </div>

      {/* Modals - only render when open for performance */}
      {modal === 'send' && (
        <TransferModal isOpen={true} onClose={closeModal} onSend={handleSend} contacts={store.contacts} />
      )}
      {modal === 'deposit' && (
        <DepositModal isOpen={true} onClose={closeModal} onDeposit={store.depositMoney} />
      )}
      {modal === 'bill' && (
        <PayBillModal isOpen={true} onClose={closeModal} onPayBill={store.payBill} />
      )}
      {modal === 'convert' && (
        <ConvertModal isOpen={true} onClose={closeModal} />
      )}
      {modal === 'wire' && (
        <WireModal isOpen={true} onClose={closeModal} />
      )}
      {modal === 'mobile' && (
        <MobileModal isOpen={true} onClose={closeModal} />
      )}
      {modal === 'trade' && (
        <TradeModal 
          isOpen={true} 
          onClose={closeModal} 
          onTrade={handleTrade} 
          investments={store.investments} 
          available={store.available} 
        />
      )}

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
        theme={theme}
        onThemeChange={setTheme}
        onLogout={() => { setShowSettings(false); setIsAuthenticated(false); }} 
      />
    </div>
  );
}
