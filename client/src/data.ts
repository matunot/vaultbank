export const navItems = [
  { id: 'home',     label: 'Dashboard',  icon: 'Home' },
  { id: 'vault',    label: 'Vault',      icon: 'Vault' },
  { id: 'swiss',    label: 'Swiss Bank', icon: 'Mountain' },
  { id: 'cards',    label: 'Cards',      icon: 'CreditCard' },
  { id: 'payments', label: 'Payments',   icon: 'Wallet' },
  { id: 'invest',   label: 'Invest',     icon: 'TrendingUp' },
  { id: 'loans',    label: 'Debts',      icon: 'Landmark' },
  { id: 'send',     label: 'Transfer',   icon: 'Send' },
  { id: 'history',  label: 'History',    icon: 'History' },
  { id: 'rewards',  label: 'Rewards',    icon: 'Gem' },
  { id: 'security', label: 'Security',   icon: 'Shield' },
];

export const balance = {
  total: 252897.40,
  available: 24562.80,
  income: 18450.00,
  spent: 6270.80,
  savings: 142350.50,
  invested: 125400.00,
};

export const cards = [
  {
    id: 1,
    type: 'Obsidian Gold',
    network: 'VISA',
    last4: '4827',
    balance: 142350.50,
    limit: 25000,
    color: 'gold',
    gradient: 'from-amber-500/20 via-yellow-500/10 to-amber-700/20',
    accent: '#d4af37',
    expiry: '12/28',
    holder: 'JOHN ANDERSON',
  },
  {
    id: 2,
    type: 'Emerald Elite',
    network: 'Mastercard',
    last4: '9014',
    balance: 85420.00,
    limit: 15000,
    color: 'emerald',
    gradient: 'from-emerald-500/20 via-teal-500/10 to-emerald-700/20',
    accent: '#10b981',
    expiry: '09/27',
    holder: 'JOHN ANDERSON',
  },
  {
    id: 3,
    type: 'Sapphire Reserve',
    network: 'AMEX',
    last4: '3156',
    balance: 25126.90,
    limit: 10000,
    color: 'sapphire',
    gradient: 'from-blue-500/20 via-indigo-500/10 to-blue-700/20',
    accent: '#3b82f6',
    expiry: '03/29',
    holder: 'JOHN ANDERSON',
  },
  {
    id: 4,
    type: 'Platinum Travel',
    network: 'VISA',
    last4: '6692',
    balance: 8930.00,
    limit: 15000,
    color: 'ruby',
    gradient: 'from-rose-500/20 via-red-500/10 to-rose-700/20',
    accent: '#e11d48',
    expiry: '08/30',
    holder: 'JOHN ANDERSON',
  },
];

export const cardTransactions: Record<number, { name: string; date: string; amount: number; category: string; }[]> = {
  1: [
    { name: 'Saks Fifth Avenue',     date: 'Today',       amount: -2840, category: 'Luxury' },
    { name: 'Private Jet Membership',date: 'Yesterday',   amount: -12000,category: 'Travel' },
    { name: 'The Restaurant at DZ',  date: 'Dec 20',      amount: -890,  category: 'Dining' },
    { name: 'Vault Concierge Fee',   date: 'Dec 15',      amount: -250,  category: 'Service' },
  ],
  2: [
    { name: 'Technogym Equipment',   date: 'Today',       amount: -3400, category: 'Fitness' },
    { name: 'Mastercard Rewards',    date: 'Yesterday',   amount: 120,   category: 'Cashback' },
    { name: 'Organic Groceries',     date: 'Dec 21',      amount: -280,  category: 'Groceries' },
    { name: 'Annual Fee',            date: 'Dec 10',      amount: -95,   category: 'Fee' },
  ],
  3: [
    { name: 'Delta Airlines First',  date: 'Today',       amount: -5200, category: 'Travel' },
    { name: 'AMEX Platinum Credit',  date: 'Yesterday',   amount: 350,   category: 'Credit' },
    { name: 'Ritz Carlton Suite',    date: 'Dec 22',      amount: -2800, category: 'Travel' },
  ],
  4: [
    { name: 'Booking.com Hotel',     date: 'Today',       amount: -1450, category: 'Travel' },
    { name: 'Air France Business',   date: 'Yesterday',   amount: -3200, category: 'Travel' },
    { name: 'Global Entry Renewal',  date: 'Dec 18',      amount: -100,  category: 'Government' },
  ],
};

export const cardSpendingCategories: Record<number, { label: string; amount: number; color: string; }[]> = {
  1: [
    { label: 'Luxury Goods',  amount: 8400, color: '#d4af37' },
    { label: 'Travel',        amount: 5200, color: '#3b82f6' },
    { label: 'Dining',        amount: 3800, color: '#ef4444' },
    { label: 'Service',       amount: 2500, color: '#a855f7' },
  ],
  2: [
    { label: 'Fitness',       amount: 5400, color: '#10b981' },
    { label: 'Groceries',     amount: 3200, color: '#f59e0b' },
    { label: 'Entertainment', amount: 1800, color: '#ec4899' },
    { label: 'Other',         amount: 1200, color: '#64748b' },
  ],
  3: [
    { label: 'Travel',        amount: 8200, color: '#3b82f6' },
    { label: 'Dining',        amount: 2400, color: '#ef4444' },
    { label: 'Entertainment', amount: 1500, color: '#ec4899' },
    { label: 'Services',      amount: 800,  color: '#a855f7' },
  ],
  4: [
    { label: 'Travel',        amount: 4800, color: '#3b82f6' },
    { label: 'Hotels',        amount: 2900, color: '#8b5cf6' },
    { label: 'Dining',        amount: 1200, color: '#ef4444' },
    { label: 'Other',         amount: 600,  color: '#64748b' },
  ],
};

export const transactions = [
  { id: 1,  name: 'Aman Tokyo',          cat: 'Dining',     amount: -480.00, date: 'Today · 8:42 PM',  icon: '🍣', gem: 'ruby'     },
  { id: 2,  name: 'Salary — Atlas Corp', cat: 'Income',     amount:  8500.00, date: 'Today · 9:00 AM',  icon: '💎', gem: 'emerald'  },
  { id: 3,  name: 'Tesla Supercharger',  cat: 'Auto',       amount:  -62.40, date: 'Yesterday',        icon: '⚡', gem: 'sapphire' },
  { id: 4,  name: 'Sotheby\'s Auction',  cat: 'Luxury',     amount: -12500.00,date: 'Dec 23',           icon: '🏛️', gem: 'gold'     },
  { id: 5,  name: 'Apple Vision Pro',    cat: 'Tech',       amount: -3499.00, date: 'Dec 22',           icon: '🥽', gem: 'amethyst' },
  { id: 6,  name: 'Dividends — AAPL',    cat: 'Investment', amount:   920.00, date: 'Dec 21',           icon: '📈', gem: 'emerald'  },
  { id: 7,  name: 'Private Jet — E20',   cat: 'Travel',     amount: -8400.00, date: 'Dec 19',           icon: '✈️', gem: 'gold'     },
  { id: 8,  name: 'Nobu Malibu',         cat: 'Dining',     amount: -890.00,  date: 'Dec 18',           icon: '🍱', gem: 'ruby'     },
  { id: 9,  name: 'Crypto — BTC Buy',    cat: 'Investment', amount: -5000.00, date: 'Dec 17',           icon: '₿',  gem: 'amber'    },
  { id: 10, name: 'Ritz Carlton',        cat: 'Travel',     amount: -1200.00, date: 'Dec 16',           icon: '🏨', gem: 'sapphire' },
];

export const spending = [
  { label: 'Luxury',     amount: 14200, pct: 38, color: '#d4af37', glow: 'rgba(212,175,55,0.4)' },
  { label: 'Dining',     amount:  6800, pct: 18, color: '#ef4444', glow: 'rgba(239,68,68,0.4)'   },
  { label: 'Travel',     amount:  5400, pct: 14, color: '#3b82f6', glow: 'rgba(59,130,246,0.4)'  },
  { label: 'Investments',amount:  4900, pct: 13, color: '#10b981', glow: 'rgba(16,185,129,0.4)'  },
  { label: 'Tech',       amount:  3700, pct: 10, color: '#a855f7', glow: 'rgba(168,85,247,0.4)'  },
  { label: 'Other',      amount:  2800, pct:  7, color: '#64748b', glow: 'rgba(100,116,139,0.4)' },
];

export const weekly = [
  { d: 'M', v: 42 },
  { d: 'T', v: 68 },
  { d: 'W', v: 55 },
  { d: 'T', v: 84 },
  { d: 'F', v: 72 },
  { d: 'S', v: 95 },
  { d: 'S', v: 60 },
];

export const investments = [
  { ticker: 'AAPL',  name: 'Apple Inc.',     price: 198.42, change:  2.4, value: 42800, shares: 215.5 },
  { ticker: 'TSLA',  name: 'Tesla Inc.',     price: 248.10, change: -1.8, value: 28500, shares: 114.8 },
  { ticker: 'BTC',   name: 'Bitcoin',        price: 67250.00, change: 5.2, value: 35200, shares: 0.523 },
  { ticker: 'ETH',   name: 'Ethereum',       price: 3480.50, change: 3.1, value: 18900, shares: 5.43 },
];

export const savingsGoals = [
  { id: 1, name: 'Tesla Model S',     target: 90000,  current: 65000, emoji: '🚗', color: '#ef4444', deadline: 'Mar 2025' },
  { id: 2, name: 'Maldives Trip',     target: 25000,  current: 18200, emoji: '🏝️', color: '#3b82f6', deadline: 'Jun 2025' },
  { id: 3, name: 'Emergency Fund',    target: 50000,  current: 42000, emoji: '🛡️', color: '#10b981', deadline: 'Ongoing' },
  { id: 4, name: 'Investment Property',target: 200000, current: 45000, emoji: '🏢', color: '#d4af37', deadline: 'Dec 2026' },
];

export const budgetCategories = [
  { name: 'Dining',    budget: 8000,  spent: 6800,  icon: '🍽️' },
  { name: 'Travel',    budget: 6000,  spent: 5400,  icon: '✈️' },
  { name: 'Shopping',  budget: 5000,  spent: 4200,  icon: '🛍️' },
  { name: 'Entertainment', budget: 3000, spent: 1800, icon: '🎭' },
];

export const currencies = [
  { code: 'USD', name: 'US Dollar',     rate: 1,       flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro',          rate: 0.92,    flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', rate: 0.79,    flag: '🇬🇧' },
  { code: 'JPY', name: 'Japanese Yen',  rate: 148.5,   flag: '🇯🇵' },
  { code: 'CHF', name: 'Swiss Franc',   rate: 0.88,    flag: '🇨🇭' },
  { code: 'CAD', name: 'Canadian Dollar',rate: 1.35,   flag: '🇨🇦' },
  { code: 'AUD', name: 'Australian Dollar',rate: 1.52, flag: '🇦🇺' },
  { code: 'SGD', name: 'Singapore Dollar',rate: 1.34,  flag: '🇸🇬' },
];

export const contacts = [
  { name: 'Sarah Chen',      handle: '@sarahc',    img: 'https://i.pravatar.cc/150?img=5',   recent: true },
  { name: 'Michael Ross',    handle: '@mross',     img: 'https://i.pravatar.cc/150?img=11',  recent: true },
  { name: 'Emma Watson',     handle: '@emmaw',     img: 'https://i.pravatar.cc/150?img=9',   recent: false },
  { name: 'David Kim',       handle: '@dkim',      img: 'https://i.pravatar.cc/150?img=13',  recent: false },
  { name: 'Lisa Park',       handle: '@lisap',     img: 'https://i.pravatar.cc/150?img=24',  recent: true },
];

export const notifications = [
  { id: 1, title: 'Payment Received',    message: 'You received $8,500 from Atlas Corp',    time: '2m ago',    type: 'success', read: false },
  { id: 2, title: 'Large Transaction',   message: '$12,500 spent at Sotheby\'s Auction',    time: '1h ago',    type: 'warning', read: false },
  { id: 3, title: 'Stock Alert',         message: 'AAPL is up 2.4% today',                  time: '3h ago',    type: 'info',    read: true },
  { id: 4, title: 'Goal Reached',        message: 'Maldives Trip is 72% funded!',           time: '5h ago',    type: 'success', read: true },
  { id: 5, title: 'Security Alert',      message: 'New login from iPhone 15 Pro',           time: '1d ago',    type: 'warning', read: true },
];

export const rewards = {
  tier: 'Obsidian',
  points: 48200,
  nextTier: 'Platinum',
  nextPoints: 50000,
  benefits: [
    'Unlimited airport lounge access',
    '4.5% APY on savings',
    'Zero forex fees',
    'Concierge service',
    'Private jet discounts',
  ],
};

export const marketTicker = [
  { symbol: 'AAPL', price: 198.42, change: 2.4 },
  { symbol: 'GOOGL', price: 142.65, change: -0.8 },
  { symbol: 'MSFT', price: 378.91, change: 1.2 },
  { symbol: 'AMZN', price: 153.42, change: -1.5 },
  { symbol: 'TSLA', price: 248.10, change: -1.8 },
  { symbol: 'BTC', price: 67250, change: 5.2 },
  { symbol: 'ETH', price: 3480.50, change: 3.1 },
  { symbol: 'NVDA', price: 495.22, change: 4.5 },
];

export const calendarEvents = [
  { day: 24, month: 'Dec', title: 'Christmas Eve',     type: 'holiday' },
  { day: 25, month: 'Dec', title: 'Christmas',         type: 'holiday' },
  { day: 28, month: 'Dec', title: 'Rent Due',          type: 'bill', amount: 3500 },
  { day: 31, month: 'Dec', title: 'NYE Dinner',        type: 'event' },
  { day: 1,  month: 'Jan', title: 'New Year',          type: 'holiday' },
  { day: 5,  month: 'Jan', title: 'Credit Card Bill',  type: 'bill', amount: 4200 },
];

export const achievements = [
  { id: 1, name: 'First Million',       description: 'Reached $1M in assets',            unlocked: true,  icon: '💎', date: 'Dec 2023' },
  { id: 2, name: 'Super Saver',         description: 'Saved 50% of income for 3 months', unlocked: true,  icon: '🐷', date: 'Nov 2023' },
  { id: 3, name: 'Globe Trotter',       description: 'Spent in 10+ countries',           unlocked: true,  icon: '🌍', date: 'Oct 2023' },
  { id: 4, name: 'Crypto King',         description: 'First crypto purchase',            unlocked: true,  icon: '₿',  date: 'Sep 2023' },
  { id: 5, name: 'Platinum Member',     description: 'Reach Platinum tier',              unlocked: false, icon: '👑', progress: 96 },
  { id: 6, name: 'Master Investor',     description: '10x return on investment',         unlocked: false, icon: '📈', progress: 65 },
];

export const fullTransactionHistory = [
  { id: 1,  name: 'Salary Deposit',        cat: 'Income',     amount:  8500.00, date: 'Today · 9:00 AM',   icon: '💎', gem: 'emerald' },
  { id: 2,  name: 'Apple Store Purchase',  cat: 'Electronics',amount: -1299.00, date: 'Today · 2:30 PM',   icon: '🍎', gem: 'sapphire' },
  { id: 3,  name: 'Aman Tokyo',            cat: 'Dining',     amount:  -480.00, date: 'Yesterday',         icon: '🍣', gem: 'ruby' },
  { id: 4,  name: 'Tesla Supercharger',    cat: 'Auto',       amount:   -62.40, date: 'Yesterday',         icon: '⚡', gem: 'cyan' },
  { id: 5,  name: 'Sotheby\'s Auction',    cat: 'Luxury',     amount:-12500.00, date: 'Dec 23',            icon: '🏛️', gem: 'gold' },
  { id: 6,  name: 'Apple Vision Pro',      cat: 'Tech',       amount: -3499.00, date: 'Dec 22',            icon: '🥽', gem: 'amethyst' },
  { id: 7,  name: 'Dividends — AAPL',      cat: 'Investment', amount:   920.00, date: 'Dec 21',            icon: '📈', gem: 'emerald' },
  { id: 8,  name: 'Nobu Malibu',           cat: 'Dining',     amount:  -890.00, date: 'Dec 18',            icon: '🍱', gem: 'ruby' },
  { id: 9,  name: 'Crypto — BTC Buy',      cat: 'Investment', amount: -5000.00, date: 'Dec 17',            icon: '₿',  gem: 'amber' },
  { id: 10, name: 'Ritz Carlton',          cat: 'Travel',     amount: -1200.00, date: 'Dec 16',            icon: '🏨', gem: 'sapphire' },
  { id: 11, name: 'Netflix Premium',       cat: 'Entertainment',amount: -15.99, date: 'Dec 15',            icon: '🎬', gem: 'amethyst' },
  { id: 12, name: 'Whole Foods Market',    cat: 'Groceries',  amount:  -127.45, date: 'Dec 14',            icon: '🥑', gem: 'emerald' },
  { id: 13, name: 'Uber Ride',             cat: 'Transport',  amount:   -24.50, date: 'Dec 13',            icon: '🚗', gem: 'cyan' },
  { id: 14, name: 'Freelance Payment',     cat: 'Income',     amount:  2500.00, date: 'Dec 12',            icon: '💻', gem: 'emerald' },
  { id: 15, name: 'Electric Bill',         cat: 'Utilities',  amount:  -185.00, date: 'Dec 10',            icon: '⚡', gem: 'amber' },
  { id: 16, name: 'Starbucks',             cat: 'Food & Drink', amount:  -8.75, date: 'Dec 9',             icon: '☕', gem: 'ruby' },
];

export const transferHistory = [
  { id: 1,  name: 'Sent to Sarah Chen',     amount: -250, date: 'Today · 3:24 PM',     status: 'completed', initials: 'SC', color: 'emerald' },
  { id: 2,  name: 'Sent to Michael Ross',   amount: -180, date: 'Today · 11:08 AM',    status: 'completed', initials: 'MR', color: 'sapphire' },
  { id: 3,  name: 'Sent to Lisa Park',      amount: -120, date: 'Yesterday',           status: 'completed', initials: 'LP', color: 'ruby' },
  { id: 4,  name: 'Sent to David Kim',      amount: -85,  date: 'Yesterday',           status: 'completed', initials: 'DK', color: 'amber' },
  { id: 5,  name: 'Sent to Emma Watson',    amount: -340, date: 'Dec 22',              status: 'completed', initials: 'EW', color: 'amethyst' },
  { id: 6,  name: 'Sent to Sarah Chen',     amount: -90,  date: 'Dec 21',              status: 'completed', initials: 'SC', color: 'emerald' },
  { id: 7,  name: 'Sent to Michael Ross',   amount: -220, date: 'Dec 19',              status: 'completed', initials: 'MR', color: 'sapphire' },
  { id: 8,  name: 'International Wire — UK',amount: -1500,date: 'Dec 18',              status: 'completed', initials: 'GB', color: 'cyan' },
];

export const rewardsHistory = [
  { id: 1, date: 'Dec 22', desc: 'Luxury Hotel Stay',         points: 1500, icon: '🏨' },
  { id: 2, date: 'Dec 18', desc: 'Concierge Service',          points: 250,  icon: '⭐' },
  { id: 3, date: 'Dec 10', desc: 'Airport Lounge Access',     points: 100,  icon: '✈️' },
  { id: 4, date: 'Dec 5',  desc: 'Private Dining',             points: 750,  icon: '🍾' },
  { id: 5, date: 'Nov 28', desc: 'Premium Account Bonus',      points: 2000, icon: '🎁' },
];

export const rewardTiers = [
  { tier: 'Silver', min: 0,       color: '#94a3b8', benefits: ['1% cashback', 'Standard support'] },
  { tier: 'Gold',   min: 10000,   color: '#d4af37', benefits: ['2% cashback', 'Priority support', 'Travel insurance'] },
  { tier: 'Obsidian',min: 25000,  color: '#1a1a1a', benefits: ['3% cashback', '24/7 concierge', 'Lounge access'] },
  { tier: 'Platinum',min: 50000,  color: '#e5e7eb', benefits: ['5% cashback', 'Private jet access', 'Personal advisor'] },
];

export const vaults = [
  { id: 1, name: 'Emergency Fund',    amount: 50000,  current: 42000, icon: '🛡️', color: '#10b981', desc: '6 months living expenses', locked: true,  unlockDate: 'Mar 2025', rate: 4.5, currency: 'USD', activity: [
      { date: '2024-12-15', desc: 'Auto-deposit', amount: 500 },
      { date: '2024-11-15', desc: 'Auto-deposit', amount: 500 },
      { date: '2024-10-20', desc: 'Interest payout', amount: 152.50 },
    ]},
  { id: 2, name: 'Dream Home Fund',   amount: 250000, current: 85420, icon: '🏡', color: '#d4af37', desc: 'Down payment savings',    locked: true,  unlockDate: 'Dec 2026', rate: 5.2, currency: 'USD', activity: [
      { date: '2024-12-10', desc: 'Auto-deposit', amount: 1200 },
      { date: '2024-11-10', desc: 'Auto-deposit', amount: 1200 },
      { date: '2024-10-15', desc: 'Bonus deposit', amount: 5000 },
    ]},
  { id: 3, name: 'Travel Adventures', amount: 30000,  current: 18200, icon: '✈️', color: '#3b82f6', desc: 'Maldives & Japan 2025',   locked: false, unlockDate: null,    rate: 3.8, currency: 'USD', activity: [
      { date: '2024-12-22', desc: 'Withdrawal', amount: -500 },
      { date: '2024-12-01', desc: 'Auto-deposit', amount: 300 },
    ]},
  { id: 4, name: 'New Car Fund',      amount: 45000,  current: 12400, icon: '🚗', color: '#f59e0b', desc: 'Tesla Model S Plaid',     locked: false, unlockDate: null,    rate: 4.1, currency: 'USD', activity: [
      { date: '2024-12-15', desc: 'Auto-deposit', amount: 400 },
      { date: '2024-11-15', desc: 'Auto-deposit', amount: 400 },
    ]},
  { id: 5, name: 'Investment Pot',    amount: 100000, current: 38000, icon: '📈', color: '#a855f7', desc: 'Future opportunities',    locked: false, unlockDate: null,    rate: 6.0, currency: 'USD', activity: [
      { date: '2024-12-20', desc: 'Auto-deposit', amount: 800 },
      { date: '2024-10-15', desc: 'Interest payout', amount: 187.30 },
    ]},
];

export const debts = [
  { id: 1, name: 'Home Mortgage',     total: 520000, paid: 185000, remaining: 335000, monthly: 2140, rate: 3.2,  icon: '🏠', color: '#3b82f6', status: 'active',    term: '30 years', startDate: 'Jan 2021', nextPayment: 'Jan 15, 2025' },
  { id: 2, name: 'Business Loan',     total: 120000, paid: 78000,  remaining: 42000,  monthly: 890,  rate: 5.8,  icon: '🏢', color: '#a855f7', status: 'active',    term: '10 years', startDate: 'Mar 2022', nextPayment: 'Jan 5, 2025' },
  { id: 3, name: 'Car Loan',          total: 48000,  paid: 32000,  remaining: 16000,  monthly: 420,  rate: 4.5,  icon: '🚗', color: '#f59e0b', status: 'active',    term: '5 years',  startDate: 'Jun 2023', nextPayment: 'Jan 22, 2025' },
  { id: 4, name: 'Education Loan',    total: 35000,  paid: 35000,  remaining: 0,      monthly: 0,    rate: 2.9,  icon: '🎓', color: '#10b981', status: 'completed', term: '7 years',  startDate: 'Sep 2018', nextPayment: 'Paid Off' },
];

export const debtOffers = [
  // ── Urgent / Emergency ──
  { name: 'Urgent Cash',       category: 'urgent',   maxAmount: 5000,   rate: '9.99%', minCredit: 600, icon: '⚡', color: '#ef4444', term: '3-12 months', desc: 'Instant approval in 5 minutes. Money in account today.', badge: 'INSTANT', processing: '5 min', features: ['No paperwork', 'Same-day funding', 'Auto-approved'] },
  { name: 'Emergency Loan',    category: 'urgent',   maxAmount: 15000,  rate: '7.49%', minCredit: 650, icon: '🚨', color: '#f97316', term: '6-24 months', desc: 'For unexpected emergencies. No questions asked.', badge: 'FAST TRACK', processing: '30 min', features: ['Skip a payment option', 'Flexible terms', '24/7 access'] },
  { name: 'Payday Advance',    category: 'urgent',   maxAmount: 2000,   rate: '11.99%', minCredit: 580, icon: '⏱️', color: '#f43f5e', term: '14-30 days', desc: 'Short-term advance until your next paycheck.', badge: 'SAME DAY', processing: '15 min', features: ['No credit check', 'Auto-repayment', 'Renewable'] },

  // ── Personal ──
  { name: 'Personal Loan',     category: 'personal', maxAmount: 50000,  rate: '6.99%', minCredit: 680, icon: '💰', color: '#3b82f6', term: '1-5 years', desc: 'No collateral required, fast approval in 24 hours.', features: ['Fixed rates', 'No prepayment penalty', 'Autopay discount'] },
  { name: 'Debt Consolidation',category: 'personal', maxAmount: 100000, rate: '5.99%', minCredit: 700, icon: '🔄', color: '#06b6d4', term: '2-7 years', desc: 'Combine multiple debts into one lower payment.', badge: 'SAVE 30%', features: ['Lower interest', 'Single payment', 'Faster payoff'] },
  { name: 'Signature Loan',    category: 'personal', maxAmount: 35000,  rate: '7.49%', minCredit: 720, icon: '✍️', color: '#8b5cf6', term: '2-5 years', desc: 'Premium unsecured loan for excellent credit.', features: ['VIP rates', 'Priority support', 'Flexible use'] },

  // ── Business ──
  { name: 'Business Line',     category: 'business', maxAmount: 150000, rate: '7.50%', minCredit: 700, icon: '📊', color: '#a855f7', term: 'Flexible', desc: 'Revolving credit line for your business.', features: ['Draw as needed', 'Pay interest only', 'Renewable annually'] },
  { name: 'Startup Loan',      category: 'business', maxAmount: 250000, rate: '8.99%', minCredit: 680, icon: '🚀', color: '#ec4899', term: '3-10 years', desc: 'Fuel your new business with growth capital.', features: ['Mentorship included', 'Flexible repayment', 'Equity-free'] },
  { name: 'Equipment Finance', category: 'business', maxAmount: 500000, rate: '5.99%', minCredit: 660, icon: '🏭', color: '#14b8a6', term: '3-7 years', desc: 'Purchase business equipment with tax benefits.', features: ['Equipment as collateral', 'Tax deductible', 'Fast approval'] },

  // ── Education ──
  { name: 'Student Loan',      category: 'education',maxAmount: 100000, rate: '4.25%', minCredit: 620, icon: '🎓', color: '#6366f1', term: '5-20 years', desc: 'Invest in education with low rates and grace period.', features: ['6-month grace', 'Income-based pay', 'Forgiveness eligible'] },
  { name: 'Professional Dev',  category: 'education',maxAmount: 25000,  rate: '5.49%', minCredit: 660, icon: '📚', color: '#4f46e5', term: '1-5 years', desc: 'Bootcamps, certifications, skill building.', features: ['Quick approval', 'Career coaching', 'Income sharing'] },

  // ── Home ──
  { name: 'Home Equity',       category: 'home',     maxAmount: 200000, rate: '4.25%', minCredit: 720, icon: '🏡', color: '#d4af37', term: '5-30 years', desc: 'Use your home equity for big expenses.', features: ['Tax deductible', 'Low rates', 'Long terms'] },
  { name: 'Home Renovation',   category: 'home',     maxAmount: 75000,  rate: '5.49%', minCredit: 680, icon: '🔨', color: '#ea580c', term: '3-15 years', desc: 'Transform your home with smart financing.', features: ['Contractor verified', 'Green energy bonus', 'Interest only start'] },

  // ── Auto ──
  { name: 'Auto Loan',         category: 'auto',     maxAmount: 75000,  rate: '4.99%', minCredit: 660, icon: '🚗', color: '#f59e0b', term: '3-7 years', desc: 'New or used vehicles, competitive rates.', features: ['Dealer network', 'Trade-in credit', 'Gap coverage'] },
  { name: 'EV Loan',           category: 'auto',     maxAmount: 80000,  rate: '3.99%', minCredit: 680, icon: '⚡', color: '#10b981', term: '3-8 years', desc: 'Go electric with lowest rates and green perks.', badge: 'GREEN RATE', features: ['Tax credit help', 'Charger included', 'Lowest rate'] },

  // ── Lifestyle ──
  { name: 'Wedding Loan',      category: 'lifestyle',maxAmount: 50000,  rate: '6.49%', minCredit: 660, icon: '💒', color: '#ec4899', term: '2-7 years', desc: 'Your perfect day, paid at your own pace.', features: ['Vendor payments', 'Flexible schedule', 'No hidden fees'] },
  { name: 'Medical Loan',      category: 'lifestyle',maxAmount: 50000,  rate: '5.99%', minCredit: 640, icon: '🏥', color: '#ef4444', term: '1-7 years', desc: 'Cover medical expenses without draining savings.', features: ['6-month grace', 'Provider network', 'Family coverage'] },
  { name: 'Travel Loan',       category: 'lifestyle',maxAmount: 25000,  rate: '6.99%', minCredit: 660, icon: '✈️', color: '#0ea5e9', term: '1-5 years', desc: 'Dream vacation today, pay when you return.', features: ['Travel insurance', 'No FX fees', 'Partner deals'] },
];

export const debtCategories = [
  { id: 'urgent',    label: 'Urgent & Emergency', icon: '⚡', color: '#ef4444' },
  { id: 'personal',  label: 'Personal',           icon: '💰', color: '#3b82f6' },
  { id: 'business',  label: 'Business',           icon: '📊', color: '#a855f7' },
  { id: 'education', label: 'Education',          icon: '🎓', color: '#6366f1' },
  { id: 'home',      label: 'Home',               icon: '🏡', color: '#d4af37' },
  { id: 'auto',      label: 'Auto',               icon: '🚗', color: '#f59e0b' },
  { id: 'lifestyle', label: 'Lifestyle',          icon: '✨', color: '#ec4899' },
];

// ── Swiss Bank Numbered Accounts ──────────────────────
export const swissAccounts = [
  {
    id: 1,
    number: 'CH-2847-9183-0024',
    nickname: 'Alpine Reserve',
    currency: 'CHF',
    flag: '🇨🇭',
    balance: 1850000,
    type: 'Numbered',
    privacy: 'Maximum',
    interest: 1.85,
    established: 'Zurich, 2018',
    encrypted: true,
    color: '#dc2626',
  },
  {
    id: 2,
    number: 'CH-7392-1057-8841',
    nickname: 'Vault Geneva',
    currency: 'EUR',
    flag: '🇪🇺',
    balance: 425000,
    type: 'Discretionary',
    privacy: 'High',
    interest: 2.15,
    established: 'Geneva, 2020',
    encrypted: true,
    color: '#3b82f6',
  },
  {
    id: 3,
    number: 'CH-5621-8847-2093',
    nickname: 'Sterling Holdings',
    currency: 'GBP',
    flag: '🇬🇧',
    balance: 320000,
    type: 'Trust',
    privacy: 'Maximum',
    interest: 2.45,
    established: 'Lugano, 2021',
    encrypted: true,
    color: '#8b5cf6',
  },
  {
    id: 4,
    number: 'CH-9148-3372-5560',
    nickname: 'Golden Eagle',
    currency: 'USD',
    flag: '🇺🇸',
    balance: 720000,
    type: 'Investment',
    privacy: 'High',
    interest: 3.25,
    established: 'Basel, 2019',
    encrypted: true,
    color: '#d4af37',
  },
];

// ── Swiss Services ────────────────────────────────────
export const swissServices = [
  { id: 1, name: 'Asset Protection',     icon: '🛡️', desc: 'Multi-jurisdiction asset shielding from creditors and litigation',     active: true,  badge: 'PREMIUM' },
  { id: 2, name: 'Tax Optimization',     icon: '📊', desc: 'Legal tax structuring with our network of tax specialists',           active: true,  badge: 'EXPERT' },
  { id: 3, name: 'Estate Planning',      icon: '🏛️', desc: 'Multi-generational wealth transfer with trust structures',            active: true,  badge: null },
  { id: 4, name: 'Precious Metals',      icon: '🏆', desc: 'Physical gold, silver, and rare metals stored in Swiss vaults',       active: true,  badge: 'VAULTED' },
  { id: 5, name: 'Art Custody',          icon: '🖼️', desc: 'Secure storage of fine art, watches, and collectibles in Geneva',     active: false, badge: 'NEW' },
  { id: 6, name: 'Private Equity',       icon: '💼', desc: 'Exclusive access to pre-IPO and private market investments',          active: true,  badge: null },
  { id: 7, name: 'Yacht & Aviation',     icon: '🛥️', desc: 'Asset financing for luxury yachts and private jets',                  active: false, badge: 'EXCLUSIVE' },
  { id: 8, name: 'Charitable Trusts',    icon: '🤝', desc: 'Establish and manage foundations with tax-efficient giving',          active: true,  badge: null },
];

// ── Precious Metals Holdings ──────────────────────────
export const preciousMetals = [
  { metal: 'Gold',     symbol: 'XAU', weight: 12500, unit: 'oz', value: 26250000, rate: 2100, change: +2.4, vault: 'Zurich', color: '#d4af37' },
  { metal: 'Silver',   symbol: 'XAG', weight: 45000, unit: 'oz', value:  1170000, rate:   26, change: -0.8, vault: 'Geneva', color: '#94a3b8' },
  { metal: 'Platinum', symbol: 'XPT', weight:  3200, unit: 'oz', value:  3072000, rate:  960, change: +1.2, vault: 'Lugano', color: '#e5e7eb' },
  { metal: 'Palladium',symbol: 'XPD', weight:   850, unit: 'oz', value:   807500, rate:  950, change: +3.5, vault: 'Basel',  color: '#06b6d4' },
];

// ── Anonymous Transfer Recipients ─────────────────────
export const stealthAddresses = [
  { id: 1, alias: 'Shadow Wallet',     address: '0xA8B...3F2c',   tier: 'Untraceable', encrypted: true,  lastUsed: '2 days ago',  trustLevel: 100, color: '#ef4444' },
  { id: 2, alias: 'Anonymous Bear',    address: '0x47C...9E1a',   tier: 'Stealth',     encrypted: true,  lastUsed: '1 week ago',  trustLevel: 95,  color: '#8b5cf6' },
  { id: 3, alias: 'Phantom Account',   address: 'CH-X-1847-X',    tier: 'Numbered',    encrypted: true,  lastUsed: '3 weeks ago', trustLevel: 100, color: '#d4af37' },
  { id: 4, alias: 'Silent Vault',      address: '0x9D2...4B8e',   tier: 'Untraceable', encrypted: true,  lastUsed: '1 month ago', trustLevel: 88,  color: '#06b6d4' },
];

// ── Privacy Tiers ─────────────────────────────────────
export const privacyTiers = [
  { tier: 'Standard',    fee: 0,    speed: 'Instant',     features: ['Encrypted transit', 'Standard logs'],                                color: '#64748b', icon: '🔓' },
  { tier: 'Private',     fee: 0.25, speed: '5-15 min',    features: ['No public ledger', 'Recipient name hidden', 'Memo encrypted'],       color: '#3b82f6', icon: '🔒' },
  { tier: 'Stealth',     fee: 0.50, speed: '15-30 min',   features: ['Mixed routing', 'Decoy transactions', 'Stealth address'],            color: '#8b5cf6', icon: '🥷' },
  { tier: 'Untraceable', fee: 1.50, speed: '30-60 min',   features: ['Zero-knowledge proof', '7-hop relay', 'Quantum-resistant', 'No metadata'], color: '#ef4444', icon: '👻' },
];

// ── Anonymous Transfer History ────────────────────────
export const anonymousTransfers = [
  { id: 'TX-A8F3B2', amount: 25000, tier: 'Untraceable', recipient: '0xA8B...3F2c', time: '2 hours ago',  status: 'completed', hops: 7, fee: 375 },
  { id: 'TX-9D2C4E', amount: 5800,  tier: 'Stealth',     recipient: 'CH-X-1847',     time: 'Yesterday',    status: 'completed', hops: 5, fee: 29 },
  { id: 'TX-7F1A8C', amount: 12000, tier: 'Private',     recipient: '0x47C...9E1a',  time: '3 days ago',   status: 'completed', hops: 3, fee: 30 },
  { id: 'TX-5B9E2D', amount: 850,   tier: 'Stealth',     recipient: '0x9D2...4B8e',  time: '1 week ago',   status: 'completed', hops: 5, fee: 4.25 },
];

// ── Digital Payment Methods ──────────────────────────────
export const digitalWallets = [
  { id: 'applepay',    name: 'Apple Pay',     balance: 4280.50,  brandColor: '#000000', accentColor: '#ffffff', connected: true,  type: 'digital', region: 'Global',     emoji: '', icon: '' },
  { id: 'googlepay',   name: 'Google Pay',    balance: 3140.00,  brandColor: '#4285F4', accentColor: '#34A853', connected: true,  type: 'digital', region: 'Global',     emoji: '', icon: '' },
  { id: 'samsungpay',  name: 'Samsung Pay',   balance: 890.00,   brandColor: '#1428A0', accentColor: '#e60012', connected: true,  type: 'digital', region: 'Global',     emoji: '', icon: '' },
  { id: 'paypal',      name: 'PayPal',        balance: 7820.40,  brandColor: '#003087', accentColor: '#009cde', connected: true,  type: 'digital', region: 'Global',     emoji: '🅿️', icon: '' },
  { id: 'venmo',       name: 'Venmo',         balance: 1240.00,  brandColor: '#3D95CE', accentColor: '#008CFF', connected: true,  type: 'digital', region: 'USA',        emoji: '💙', icon: '' },
  { id: 'cashapp',     name: 'Cash App',      balance: 2150.75,  brandColor: '#00D632', accentColor: '#00C853', connected: true,  type: 'digital', region: 'USA',        emoji: '💵', icon: '' },
];

export const regionalPayments = [
  { id: 'upi',         name: 'UPI',           balance: 84500,    currency: 'INR', brandColor: '#5F259F', accentColor: '#9C27B0', connected: true, region: 'India',      handle: 'john@okbank',     emoji: '🇮🇳' },
  { id: 'alipay',      name: 'Alipay',        balance: 24500,    currency: 'CNY', brandColor: '#1677FF', accentColor: '#00A3FF', connected: true, region: 'China',      handle: 'john*anderson',   emoji: '🇨🇳' },
  { id: 'wechat',      name: 'WeChat Pay',    balance: 12800,    currency: 'CNY', brandColor: '#07C160', accentColor: '#2DC100', connected: true, region: 'China',      handle: 'JohnAnd88',       emoji: '💬' },
  { id: 'pix',         name: 'Pix',           balance: 18200,    currency: 'BRL', brandColor: '#00B7C3', accentColor: '#32BCAD', connected: true, region: 'Brazil',     handle: 'john@email.com',  emoji: '🇧🇷' },
  { id: 'revolut',     name: 'Revolut',       balance: 3400,     currency: 'EUR', brandColor: '#0075EB', accentColor: '#06D6A0', connected: true, region: 'Europe',     handle: '@johnvault',      emoji: '🌍' },
  { id: 'wero',        name: 'Wero',          balance: 2150,     currency: 'EUR', brandColor: '#E5007D', accentColor: '#FF4FA3', connected: false,region: 'Europe',     handle: 'Not connected',   emoji: '⚡' },
  { id: 'gcash',       name: 'GCash',         balance: 28400,    currency: 'PHP', brandColor: '#007BC4', accentColor: '#00C2FF', connected: true, region: 'Philippines',handle: '0917***8847',     emoji: '🇵🇭' },
  { id: 'grabpay',     name: 'GrabPay',       balance: 9800,     currency: 'SGD', brandColor: '#00B14F', accentColor: '#1FBC4D', connected: true, region: 'SE Asia',    handle: '+65****8847',     emoji: '🛵' },
];

export const cryptoWallets = [
  { id: 'btc',   name: 'Bitcoin',  symbol: 'BTC',  balance: 2.8471,   usdValue: 191482.50, change: 5.2,  color: '#F7931A', chain: 'Bitcoin',    address: 'bc1qxy2k...8x7m9k', icon: '₿' },
  { id: 'eth',   name: 'Ethereum', symbol: 'ETH',  balance: 18.4200,  usdValue: 64089.40,  change: 3.1,  color: '#627EEA', chain: 'Ethereum',   address: '0x4f8e...a2b9',    icon: 'Ξ' },
  { id: 'usdt',  name: 'Tether',   symbol: 'USDT', balance: 45000,    usdValue: 45000.00,  change: 0.1,  color: '#26A17B', chain: 'Tron',       address: 'TQn9Y2kh...7m4L',   icon: '₮' },
  { id: 'sol',   name: 'Solana',   symbol: 'SOL',  balance: 142.5,    usdValue: 28462.50,  change: 8.4,  color: '#9945FF', chain: 'Solana',     address: '7Np41m...k9Q2a',    icon: '◎' },
  { id: 'bnb',   name: 'BNB',      symbol: 'BNB',  balance: 48.2,     usdValue: 29209.20,  change: -1.2, color: '#F3BA2F', chain: 'BNB Chain',  address: 'bnb1gr...4p8w',     icon: '⬡' },
  { id: 'xrp',   name: 'Ripple',   symbol: 'XRP',  balance: 18420,    usdValue: 9210.00,   change: 2.8,  color: '#23292F', chain: 'XRPL',       address: 'rDsbe...m9k3Q',     icon: '✕' },
  { id: 'ada',   name: 'Cardano',  symbol: 'ADA',  balance: 12450,    usdValue: 5478.00,   change: -0.8, color: '#0033AD', chain: 'Cardano',    address: 'addr1q...8x4m',     icon: '₳' },
  { id: 'usdc',  name: 'USD Coin', symbol: 'USDC', balance: 28500,    usdValue: 28500.00,  change: 0.05, color: '#2775CA', chain: 'Ethereum',   address: '0x9a3d...f4c1',    icon: '$' },
];

export const availablePaymentMethods = [
  { id: 'applepay',    name: 'Apple Pay',      category: 'Digital Wallet', color: '#000000', connected: true,  emoji: '' },
  { id: 'googlepay',   name: 'Google Pay',     category: 'Digital Wallet', color: '#4285F4', connected: true,  emoji: '' },
  { id: 'samsungpay',  name: 'Samsung Pay',    category: 'Digital Wallet', color: '#1428A0', connected: true,  emoji: '' },
  { id: 'paypal',      name: 'PayPal',         category: 'Digital Wallet', color: '#003087', connected: true,  emoji: '🅿️' },
  { id: 'venmo',       name: 'Venmo',          category: 'Digital Wallet', color: '#3D95CE', connected: true,  emoji: '💙' },
  { id: 'cashapp',     name: 'Cash App',       category: 'Digital Wallet', color: '#00D632', connected: true,  emoji: '💵' },
  { id: 'upi',         name: 'UPI',            category: 'Regional',       color: '#5F259F', connected: true,  emoji: '🇮🇳' },
  { id: 'alipay',      name: 'Alipay',         category: 'Regional',       color: '#1677FF', connected: true,  emoji: '🇨🇳' },
  { id: 'wechat',      name: 'WeChat Pay',     category: 'Regional',       color: '#07C160', connected: true,  emoji: '💬' },
  { id: 'pix',         name: 'Pix',            category: 'Regional',       color: '#00B7C3', connected: true,  emoji: '🇧🇷' },
  { id: 'gcash',       name: 'GCash',          category: 'Regional',       color: '#007BC4', connected: true,  emoji: '🇵🇭' },
  { id: 'wero',        name: 'Wero',           category: 'Regional',       color: '#E5007D', connected: false, emoji: '⚡' },
  { id: 'btc',         name: 'Bitcoin',        category: 'Crypto',         color: '#F7931A', connected: true,  emoji: '₿' },
  { id: 'eth',         name: 'Ethereum',       category: 'Crypto',         color: '#627EEA', connected: true,  emoji: 'Ξ' },
  { id: 'usdt',        name: 'Tether USDT',    category: 'Crypto',         color: '#26A17B', connected: true,  emoji: '₮' },
  { id: 'sol',         name: 'Solana',         category: 'Crypto',         color: '#9945FF', connected: true,  emoji: '◎' },
];

export const paymentCategories = [
  { id: 'digital',  label: 'Digital Wallets', icon: '📱', count: 6 },
  { id: 'regional', label: 'Regional Pay',    icon: '🌍', count: 8 },
  { id: 'crypto',   label: 'Crypto',          icon: '🪙', count: 8 },
];

// ─── Security Data ──────────────────────────────────────
export const securitySessions = [
  { id: 1, device: 'MacBook Pro 16"', location: 'Zurich, Switzerland', ip: '185.228.19.42', active: true,  current: true,  date: 'Active now', browser: 'Safari 17.2', icon: '💻' },
  { id: 2, device: 'iPhone 15 Pro',    location: 'Geneva, Switzerland', ip: '82.102.15.11',  active: true,  current: false, date: '10 mins ago', browser: 'Vault iOS App', icon: '📱' },
  { id: 3, device: 'iPad Pro M2',      location: 'Lugano, Switzerland', ip: '194.230.12.88', active: false, current: false, date: 'Yesterday', browser: 'Vault iPadOS App', icon: '📟' },
  { id: 4, device: 'iMac 24"',          location: 'Basel, Switzerland',  ip: '109.202.16.5',  active: false, current: false, date: '4 days ago', browser: 'Chrome 120.0', icon: '💻' },
];

export const trustedContacts = [
  { id: 1, name: 'Amelia Anderson', relation: 'Spouse',     phone: '+41 79 123 4567', email: 'amelia@anderson.ch', img: 'https://i.pravatar.cc/150?img=47' },
  { id: 2, name: 'Dr. Arthur Keller', relation: 'Attorney',   phone: '+41 22 987 6543', email: 'keller@keller-law.ch', img: 'https://i.pravatar.cc/150?img=68' },
  { id: 3, name: 'Lucas Dubois',     relation: 'Executor',   phone: '+41 91 555 1234', email: 'lucas@dubois-trust.ch', img: 'https://i.pravatar.cc/150?img=33' },
];

export const securityEvents = [
  { id: 1, event: 'PIN Code Updated',      status: 'success', date: 'Dec 22, 2024 · 3:45 PM',  ip: 'Zurich (185.228.19.42)',  desc: 'Card ending in 4827 security PIN successfully updated via Settings panel.' },
  { id: 2, event: 'New Login Detected',     status: 'warning', date: 'Dec 18, 2024 · 11:20 AM', ip: 'Basel (109.202.16.5)',   desc: 'New session established on iMac 24" from an unrecognized browser environment.' },
  { id: 3, event: 'API Key Generated',      status: 'success', date: 'Dec 15, 2024 · 9:15 AM',  ip: 'Zurich (185.228.19.42)',  desc: 'Read-only API access key created for third-party tax accounting integration.' },
  { id: 4, event: 'Failed Login Attempt',   status: 'danger',  date: 'Dec 12, 2024 · 10:04 PM', ip: 'London, UK (92.40.12.3)', desc: 'Unsuccessful authentication attempt using incorrect account credentials.' },
  { id: 5, event: 'Two-Factor Enabled',     status: 'success', date: 'Dec 01, 2024 · 8:12 AM',  ip: 'Zurich (185.228.19.42)',  desc: 'SMS-based 2FA successfully upgraded to hardware-token Google Authenticator.' },
];

export const securityScoreFactors = [
  { name: 'Hardware Token 2FA',     score: 100, status: 'Active',     impact: 'high',   desc: 'Provides bulletproof protection against remote account hijacking.' },
  { name: 'Biometric Access',       score: 100, status: 'Active',     impact: 'medium', desc: 'Secure fingerprint/face unlock enabled on all trusted devices.' },
  { name: 'Encrypted Recovery Key', score: 100, status: 'Backed Up',  impact: 'high',   desc: '12-word master recovery phrase verified and securely saved offline.' },
  { name: 'Simulated Stealth Mode', score: 0,   status: 'Disabled',   impact: 'medium', desc: 'Automatic decoy transaction routing currently inactive.' },
  { name: 'Nominee Assignment',     score: 100, status: '3 Assigned', impact: 'high',   desc: 'Trusted emergency executors assigned with verified contact records.' },
];