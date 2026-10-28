'use client';

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGameStore } from '@/stores/useGameStore';

export const ScoreboardView: React.FC = () => {
  const { gameState, restartGame } = useGameStore();

  const isGameOver = Boolean(gameState?.isGameOver);

  useEffect(() => {
    if (isGameOver) {
      confetti({
        particleCount: 80,
        spread: 90,
        origin: { y: 0.4 },
      });
    }
  }, [isGameOver]);

  if (!gameState) return null;

  const leaderboard = gameState.leaderboard || [];
  const leader = leaderboard[0];

  return (
    <div className="flex-1 flex flex-col justify-between py-2 gap-4">
      <div className="space-y-4">
        {/* Title */}
        <div className="text-center space-y-1">
          <span className="text-[10px] font-black tracking-widest uppercase text-emerald-400">
            {isGameOver
              ? 'Final Standings'
              : `Round ${gameState.round} of ${gameState.totalRounds || 3} Complete`}
          </span>
          <h1 className="text-2xl font-black text-white">
            {isGameOver ? 'Leaderboard' : 'Round Standings'}
          </h1>
        </div>

        {/* Leader / Winner Spotlight */}
        {leader && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`border-2 rounded-2xl p-5 text-center shadow-xl space-y-1 ${
              isGameOver
                ? 'bg-gradient-to-b from-amber-500/20 to-slate-900 border-amber-500/40'
                : 'bg-gradient-to-b from-emerald-500/20 to-slate-900 border-emerald-500/40'
            }`}
          >
            <div className="text-3xl">{isGameOver ? '👑' : '🥇'}</div>
            <div className="text-xs uppercase font-extrabold tracking-wider text-amber-300">
              {isGameOver ? 'Retort Champion' : 'Current Round Leader'}
            </div>
            <div className="text-xl font-black text-white">{leader.nickname}</div>
            <div className="text-sm font-mono font-bold text-amber-400">
              {leader.score.toLocaleString()} PTS
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
        {isGameOver ? (
          gameState.isHost ? (
            <button
              onClick={restartGame}
              className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
            >
              Play Another Game →
            </button>
          ) : (
            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
              Waiting for the host to trigger a rematch...
            </div>
          )
        ) : (
          <div className="p-4 rounded-xl bg-slate-900/90 border border-emerald-500/30 text-center space-y-1">
            <div className="flex items-center justify-center gap-2 text-xs font-bold text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              Round {gameState.round + 1} starting soon...
            </div>
            <p className="text-[11px] text-slate-400 font-medium">
              {gameState.round === 1
                ? 'Round 2 quips score DOUBLE points (2x)!'
                : 'Round 3 finale quips score TRIPLE points (3x)!'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
