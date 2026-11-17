import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Shield, Send } from 'lucide-react';

import LoginPage from './components/LoginPage';
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import Header from './components/Header';
import MarketTicker from './components/MarketTicker';
import DashboardSection from './components/DashboardSection';
import ErrorBoundary from './components/ErrorBoundary';
import PreviewOnlyNotice from './components/PreviewOnlyNotice';
import { useAppStore } from './store';
import { api } from './api';

// Screens and modal workflows that are not needed for the first authenticated
// paint stay out of the entry bundle. Each dynamic import is its own chunk.
const SignupPage = lazy(() => import('./components/SignupPage'));
const EmailVerificationPage = lazy(() => import('./components/EmailVerificationPage'));
const SettingsModal = lazy(() => import('./components/SettingsModal'));

// All money modals live in one module; a single dynamic import keeps them in a
// shared modal chunk that is fetched the first time any workflow is opened.
const TransferModal = lazy(() => import('./components/Modals').then((m) => ({ default: m.TransferModal })));
const DepositModal = lazy(() => import('./components/Modals').then((m) => ({ default: m.DepositModal })));
const TradeModal = lazy(() => import('./components/Modals').then((m) => ({ default: m.TradeModal })));
const WithdrawModal = lazy(() => import('./components/Modals').then((m) => ({ default: m.WithdrawModal })));

// Lazy load heavy sections.
// ponytail: dev-only preview components are excluded from the production
// bundle at build time (gated imports, not just gated rendering).
const isDev = import.meta.env.DEV;
const CardProgramSection = lazy(() => import('./components/CardProgramSection'));
const LoanApplicationSection = lazy(() => import('./components/LoanApplicationSection'));
const PaymentsSection = lazy(() => import('./components/PaymentsSection'));
const InvestmentsSection = isDev ? lazy(() => import('./components/InvestmentsSection')) : (null as unknown as typeof import('./components/InvestmentsSection').default);
const VaultSection = isDev ? lazy(() => import('./components/VaultSection')) : (null as unknown as typeof import('./components/VaultSection').default);
const SavingsAccountsSection = lazy(() => import('./components/SavingsAccountsSection'));
const DebtsSection = isDev ? lazy(() => import('./components/DebtsSection')) : (null as unknown as typeof import('./components/DebtsSection').default);
const CreditSection = isDev ? lazy(() => import('./components/CreditSection')) : (null as unknown as typeof import('./components/CreditSection').default);

const SwissSection = lazy(() => import('./components/SwissSection'));
const BudgetSection = isDev ? lazy(() => import('./components/BudgetSection')) : (null as unknown as typeof import('./components/BudgetSection').default);
const TransferSection = lazy(() => import('./components/TransferSection'));
const HistorySection = lazy(() => import('./components/HistorySection'));
const RewardsSection = isDev ? lazy(() => import('./components/RewardsSection')) : (null as unknown as typeof import('./components/RewardsSection').default);
const VerificationSection = lazy(() => import('./components/VerificationSection'));

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

const FullPageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-[#050508]">
    <div className="w-10 h-10 rounded-full border-2 border-amber-500/20 border-t-amber-500 animate-spin" />
  </div>
);

const ModalLoader = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="status" aria-label="Loading">
    <div className="w-10 h-10 rounded-full border-2 border-amber-500/20 border-t-amber-500 animate-spin" />
  </div>
);

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => api.isAuthenticated());
  const [verifyEmailToken, setVerifyEmailToken] = useState<string | null>(() => new URLSearchParams(window.location.search).get('verify-email'));
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
  const finishEmailVerification = useCallback(() => {
    window.history.replaceState({}, '', window.location.pathname);
    setVerifyEmailToken(null);
  }, []);

  // Gold toast fired the moment a REAL transfer completes
  const [sendToast, setSendToast] = useState<{ name: string; amount: number } | null>(null);

  // One-tap funding deep link (?addfunds=1) — card-declined notifications point here
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('addfunds') === '1') {
      window.history.replaceState({}, '', window.location.pathname);
      setModal('deposit');
    }
  }, []);

  // In-app "Add money" requests (Cards panel) open the deposit modal
  useEffect(() => {
    const openDeposit = () => setModal('deposit');
    window.addEventListener('vaultbank:addfunds', openDeposit);
    return () => window.removeEventListener('vaultbank:addfunds', openDeposit);
  }, []);


  const handleSend = useCallback(async (recipient: string, amount: number, note?: string, recipientName?: string) => {
    await store.sendMoney(recipient, amount, note);
    const who = (recipientName || recipient).trim();
    setSendToast({ name: who, amount });
    setTimeout(() => setSendToast(null), 5000);
    closeModal();
  }, [store, closeModal]);

  const handleTrade = useCallback(async (ticker: string, action: 'buy' | 'sell', shares: number): Promise<boolean> => {
    await store.executeTrade(ticker, action, shares);
    closeModal();
    return true;
  }, [store, closeModal]);

  if (verifyEmailToken) {
    return (
      <Suspense fallback={<FullPageLoader />}>
        <EmailVerificationPage token={verifyEmailToken} onFinish={finishEmailVerification} />
      </Suspense>
    );
  }

  if (!isAuthenticated) {
    if (authMode === 'signup') {
      return (
        <Suspense fallback={<FullPageLoader />}>
          <SignupPage onSignup={() => setIsAuthenticated(true)} onSwitchToLogin={() => setAuthMode('login')} />
        </Suspense>
      );
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
        <MobileNav active={active} setActive={setActive} onSettings={() => setShowSettings(true)} onLogout={() => setIsAuthenticated(false)} />

        <main className="flex-1 overflow-y-auto h-screen min-w-0 pb-20 lg:pb-0">
          <Header theme={theme} onThemeChange={setTheme} />

          {/* Gold toast — REAL money sent confirmation */}
          {sendToast && (
            <div className="vb-enter px-4 sm:px-5 lg:px-8 pt-4">
              <div className="relative overflow-hidden rounded-2xl p-4 border border-amber-400/40 bg-linear-to-r from-amber-500/15 via-yellow-500/10 to-amber-500/15">
                <div className="toast-shimmer absolute inset-y-0 w-1/4 bg-linear-to-r from-transparent via-amber-300/25 to-transparent" />
                <div className="relative flex items-center gap-3">
                  <div className="vb-scale-in w-10 h-10 rounded-full bg-amber-400/30 border border-amber-300/50 flex items-center justify-center shrink-0">
                    <Send className="w-5 h-5 text-amber-200 -rotate-12" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-amber-100">
                      {store.formatMoney(sendToast.amount)} sent to {sendToast.name}
                    </p>
                    <p className="text-[11px] text-amber-300/70 mt-0.5 tracking-wide">
                      REAL MONEY · INSTANT TRANSFER · BALANCE UPDATED
                    </p>
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
                </div>
              </div>
            </div>
          )}

          <div className="px-4 sm:px-5 lg:px-8 pb-12">
            <div key={active} className="vb-enter">
              <ErrorBoundary>
                <Suspense fallback={<SectionLoader />}>
                    {active === 'home' && <DashboardSection onOpenModal={openModal} userName={firstName} accountNumber={currentAccount ? currentAccount.accountNumber : undefined} />}
                    {active === 'vault' && (isDev ? <VaultSection /> : <SavingsAccountsSection />)}
                    {active === 'swiss' && <SwissSection previewOnly={!isDev} />}
                    {active === 'cards' && <CardProgramSection />}
                    {active === 'payments' && <PaymentsSection onOpenModal={openModal} />}
                    {active === 'invest' && (isDev ? <InvestmentsSection investments={store.investments} onOpenTrade={() => openModal('trade')} /> : <PreviewOnlyNotice title="Investment features are not connected" message="The development preview uses sample holdings. Live investment balances and trade execution are not available through this section." />)}
                    {active === 'credit' && (isDev ? <CreditSection /> : <CardProgramSection defaultCardType="credit" />)}

                    {active === 'loans' && (isDev ? <DebtsSection /> : <LoanApplicationSection />)}
                    {active === 'budget' && (isDev ? <BudgetSection /> : <PreviewOnlyNotice title="Budget tools are a development preview" message="The current budget figures are example data, not your personal spending history. Live transaction-linked budgets are not connected yet." />)}
                    {active === 'send' && <TransferSection />}
                    {active === 'history' && <HistorySection />}
                    {active === 'rewards' && (isDev ? <RewardsSection /> : <PreviewOnlyNotice title="Rewards program is not live yet" message="The development preview contains sample points and benefits. Production rewards, interest rates, and fee waivers are not being promised by this screen." />)}
                    {active === 'security' && <VerificationSection />}
                  </Suspense>
                </ErrorBoundary>
            </div>
          </div>

          {/* Footer */}
          <div className="vb-fade text-center pt-2 pb-8" style={{ '--vb-delay': '600ms' } as React.CSSProperties}>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass">
              <Shield className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[10px] tracking-widest font-semibold text-white/30">
                LIVE FEATURES ARE LABELED BY AVAILABILITY
              </span>
            </div>
          </div>
        </main>
      </div>

      {/* Modals - lazy workflows, mounted only when opened */}
      <Suspense fallback={<ModalLoader />}>
        {modal === 'send' && (
          <TransferModal isOpen={true} onClose={closeModal} onSend={handleSend} />
        )}
        {modal === 'deposit' && (
          <DepositModal isOpen={true} onClose={closeModal} />
        )}
        {modal === 'withdraw' && (
          <WithdrawModal isOpen={true} onClose={closeModal} />
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
      </Suspense>
    </div>
  );
}
