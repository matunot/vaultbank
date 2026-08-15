const fs = require('fs');
const path = 'client/src/components/DashboardSection.tsx';
let c = fs.readFileSync(path, 'utf8');

// 1. Add useAccountData import
c = c.replace(
  "import { useAppStore } from '../store';",
  "import { useAppStore } from '../store';\nimport { useAccountData } from '../hooks/useAccountData';"
);

// 2. Add useAccountData call and income computation after useAppStore
c = c.replace(
  '  const store = useAppStore();',
  "  const store = useAppStore();\n  const { balance, account, loading } = useAccountData();\n  const income = store.transactions.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);"
);

// 3. Fix HeroBalance props - extract total from BalanceData
c = c.replace(
  '<Section delay={0.1}><HeroBalance /></Section>',
  `<Section delay={0.1}>
        <HeroBalance
          balance={balance?.total ?? 0}
          accountNumber={account?.accountNumber}
          loading={loading}
          income={income}
        />
      </Section>`
);

fs.writeFileSync(path, c);
console.log('File updated successfully');
console.log('---');
// Print relevant lines
const lines = c.split('\n');
lines.forEach((line, i) => {
  if (line.includes('useAccountData') || line.includes('HeroBalance') || line.includes('balance') || line.includes('income')) {
    console.log(`${i+1}: ${line}`);
  }
});