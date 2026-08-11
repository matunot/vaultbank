import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { marketTicker } from '../data';
import RichIcon from './RichIcon';

export default function MarketTicker() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1 }}
      className="w-full overflow-hidden py-3 border-y border-white/5 bg-white/[0.02]"
    >
      <div className="flex animate-[ticker_30s_linear_infinite]">
        {[...marketTicker, ...marketTicker].map((stock, i) => (
          <div key={i} className="flex items-center gap-3 px-6 border-r border-white/5 whitespace-nowrap">
            <RichIcon
              icon={<span className="text-[9px] font-bold">{stock.symbol.slice(0, 2)}</span>}
              variant={stock.change >= 0 ? 'emerald' : 'ruby'}
              size="sm"
            />
            <span className="text-sm font-bold text-white">{stock.symbol}</span>
            <span className="text-sm text-white/60">${stock.price.toLocaleString()}</span>
            <span className={`flex items-center gap-0.5 text-xs font-semibold ${stock.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {stock.change >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {Math.abs(stock.change)}%
            </span>
          </div>
        ))}
      </div>
      
      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </motion.div>
  );
}
