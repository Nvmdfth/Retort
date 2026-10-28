'use client';

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGameStore } from '@/stores/useGameStore';

export const ScoreboardView: React.FC = () => {
  const { gameState, restartGame } = useGameStore();

  useEffect(() => {
    confetti({
      particleCount: 80,
      spread: 90,
      origin: { y: 0.4 },
    });
  }, []);

  if (!gameState) return null;

  const leaderboard = gameState.leaderboard || [];
  const winner = leaderboard[0];

  return (
    <div className="flex-1 flex flex-col justify-between py-2 gap-4">
      <div className="space-y-4">
        {/* Title */}
        <div className="text-center space-y-1">
          <span className="text-[10px] font-black tracking-widest uppercase text-emerald-400">
            Final Standings
          </span>
          <h1 className="text-2xl font-black text-white">Leaderboard</h1>
        </div>

        {/* Winner Spotlight */}
        {winner && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-gradient-to-b from-amber-500/20 to-slate-900 border-2 border-amber-500/40 rounded-2xl p-5 text-center shadow-xl space-y-1"
          >
            <div className="text-3xl">👑</div>
            <div className="text-xs uppercase font-extrabold tracking-wider text-amber-300">
              Retort Champion
            </div>
            <div className="text-xl font-black text-white">{winner.nickname}</div>
            <div className="text-sm font-mono font-bold text-amber-400">
              {winner.score.toLocaleString()} PTS
            </div>
          </motion.div>
        )}

        {/* Leaderboard Table */}
        <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
          {leaderboard.map((item, idx) => (
            <motion.div
              key={item.playerId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06 }}
              className={`flex items-center justify-between p-3 rounded-xl border ${
                item.rank === 1
                  ? 'bg-amber-950/20 border-amber-500/40 text-amber-200'
                  : item.rank === 2
                  ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                  : item.rank === 3
                  ? 'bg-amber-950/10 border-amber-800/30 text-amber-300/80'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-5 text-center font-mono font-black text-sm">
                  #{item.rank}
                </span>
                <span className="font-bold text-sm text-slate-100">
                  {item.nickname}
                </span>
              </div>
              <span className="font-mono font-black text-sm text-emerald-400">
                {item.score.toLocaleString()}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Action Tray */}
      <div className="pt-2">
        {gameState.isHost ? (
          <button
            onClick={restartGame}
            className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
          >
            Play Another Round &rarr;
          </button>
        ) : (
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
            Waiting for the host to trigger a rematch...
          </div>
        )}
      </div>
    </div>
  );
};
