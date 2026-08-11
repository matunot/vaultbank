import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRightLeft, TrendingUp } from 'lucide-react';
import { currencies } from '../data';
import RichIcon from './RichIcon';

export default function CurrencyConverter() {
  const [amount, setAmount] = useState('1000');
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('EUR');
  
  const fromRate = currencies.find(c => c.code === from)?.rate || 1;
  const toRate = currencies.find(c => c.code === to)?.rate || 1;
  const converted = (parseFloat(amount || '0') / fromRate) * toRate;
  const rate = toRate / fromRate;

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.3 }}
      className="glass-panel rounded-3xl p-6 lg:p-7 relative overflow-hidden"
    >
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl" />

      <div className="relative z-10 flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display text-2xl text-white">FX Converter</h3>
          <p className="text-xs text-white/40 mt-1 tracking-wider">LIVE EXCHANGE RATES</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-btn border border-emerald-500/20">
          <RichIcon icon={<TrendingUp size={12} />} variant="emerald" size="sm" pulse />
          <span className="text-[10px] font-semibold text-emerald-400">USD Strong</span>
        </div>
      </div>

      <div className="relative z-10 space-y-4">
        <div>
          <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">AMOUNT</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-400 font-display text-xl">$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full glass-input rounded-xl pl-10 pr-4 py-3 text-lg font-display text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-[1fr,auto,1fr] gap-3 items-end">
          <div>
            <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">FROM</label>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white cursor-pointer"
            >
              {currencies.map(c => (
                <option key={c.code} value={c.code} className="bg-[#0d0d14]">
                  {c.flag} {c.code}
                </option>
              ))}
            </select>
          </div>

          <motion.button
            whileHover={{ rotate: 180, scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={swap}
            className="mb-0.5 animate-pulse"
          >
            <RichIcon icon={<ArrowRightLeft size={16} />} variant="gold" size="md" glow />
          </motion.button>

          <div>
            <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">TO</label>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white cursor-pointer"
            >
              {currencies.map(c => (
                <option key={c.code} value={c.code} className="bg-[#0d0d14]">
                  {c.flag} {c.code}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="glass holo-card rounded-2xl p-4">
          <div className="text-[10px] text-amber-400/60 tracking-wider mb-1">CONVERTED AMOUNT</div>
          <div className="font-display text-3xl text-gold">
            {currencies.find(c => c.code === to)?.flag} {converted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-white/40 mt-1">
            1 {from} = {rate.toFixed(4)} {to}
          </div>
        </div>
      </div>

      <div className="relative z-10 mt-4 pt-4 border-t border-white/5">
        <div className="text-[10px] text-white/40 tracking-wider mb-2 font-semibold">POPULAR RATES</div>
        <div className="flex flex-wrap gap-2">
          {['EUR', 'GBP', 'JPY', 'CHF'].map(code => {
            const c = currencies.find(x => x.code === code);
            const r = (c?.rate || 1);
            return (
              <button
                key={code}
                onClick={() => setTo(code)}
                className="px-3 py-1.5 rounded-lg glass-btn text-xs text-white/60 hover:text-white transition-colors"
              >
                {c?.flag} {code} {(1/r).toFixed(2)}
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
