'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface SharedTimerProps {
  remaining: number;
  total?: number;
}

export const SharedTimer: React.FC<SharedTimerProps> = ({ remaining, total = 60 }) => {
  const isUrgent = remaining <= 10;
  const isCritical = remaining <= 5;

  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-end">
        <motion.span
          key={remaining}
          initial={{ scale: 1.15 }}
          animate={{ scale: 1 }}
          className={`font-mono text-sm font-black tracking-tight ${
            isCritical
              ? 'text-rose-500 animate-pulse'
              : isUrgent
              ? 'text-amber-400'
              : 'text-emerald-400'
          }`}
        >
          {remaining}s
        </motion.span>
      </div>

      <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700/60">
        <motion.div
          className={`h-full rounded-full transition-colors ${
            isCritical ? 'bg-rose-500' : isUrgent ? 'bg-amber-400' : 'bg-emerald-400'
          }`}
          style={{ width: `${Math.min(100, Math.max(0, (remaining / total) * 100))}%` }}
          transition={{ ease: 'linear', duration: 0.3 }}
        />
      </div>
    </div>
  );
};
