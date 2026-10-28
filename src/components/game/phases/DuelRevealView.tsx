'use client';

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGameStore } from '@/stores/useGameStore';

export const DuelRevealView: React.FC = () => {
  const { gameState } = useGameStore();
  const duel = gameState?.currentDuel;
  const results = duel?.results;

  useEffect(() => {
    if (results?.isSweepA || results?.isSweepB) {
      confetti({
        particleCount: 60,
        spread: 70,
        origin: { y: 0.6 },
      });
    }
  }, [results]);

  if (!duel || !results) {
    return (
      <div className="flex-1 flex items-center justify-center text-center text-slate-500 font-medium">
        Tallying the votes...
      </div>
    );
  }

  const isSweep = results.isSweepA || results.isSweepB;

  return (
    <div className="flex-1 flex flex-col justify-between py-2 gap-3.5">
      {/* Pinned Top Prompt */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center shadow-lg">
        <span className="text-[10px] tracking-widest uppercase font-bold text-slate-400">
          Duel Results
        </span>
        <h2 className="text-base sm:text-lg font-black text-white mt-1">
          "{duel.promptText}"
        </h2>
      </div>

      {/* Sweep Badge */}
      {isSweep && (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-amber-500 text-slate-950 font-black text-xs py-1.5 px-4 rounded-full mx-auto uppercase tracking-wider shadow-lg flex items-center gap-1.5"
        >
          <span>🔥</span> CLEAN SWEEP BONUS (+250 PTS) <span>🔥</span>
        </motion.div>
      )}

      {/* Cards with Vote Breakdown */}
      <div className="flex-1 flex flex-col justify-center gap-3">
        {(['A', 'B'] as const).map((key) => {
          const option = key === 'A' ? duel.optionA : duel.optionB;
          const votes = key === 'A' ? results.votesA : results.votesB;
          const pct = key === 'A' ? results.pctA : results.pctB;
          const points = key === 'A' ? results.pointsA : results.pointsB;
          const isWinner = pct > (key === 'A' ? results.pctB : results.pctA);

          return (
            <motion.div
              key={key}
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.25 }}
              className={`p-4 rounded-2xl border-2 flex flex-col justify-between gap-3 ${
                isWinner
                  ? 'bg-emerald-950/40 border-emerald-500 shadow-xl shadow-emerald-500/10'
                  : 'bg-slate-900/90 border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  CARD {key}
                </span>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-slate-400">
                    {pct}%
                  </span>
                  <span className="text-xs font-black text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded-full border border-emerald-500/30">
                    +{points} pts
                  </span>
                </div>
              </div>

              {/* Punchline text */}
              <p className="text-base font-extrabold text-white">
                "{option.text}"
              </p>

              {/* Author Reveal */}
              <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 font-medium">By:</span>
                  <span className="font-bold text-amber-300">
                    {option.authorNickname || 'Secret Author'}
                  </span>
                </div>

                {/* Voters chips */}
                <div className="flex items-center gap-1">
                  {votes.length === 0 ? (
                    <span className="text-[10px] text-slate-600">No votes</span>
                  ) : (
                    votes.map((v) => (
                      <span
                        key={v.id}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-200 border border-slate-700"
                      >
                        {v.nickname}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="text-center text-[11px] font-mono text-slate-500">
        Next duel starting in {gameState.phaseTimeRemaining}s...
      </div>
    </div>
  );
};
