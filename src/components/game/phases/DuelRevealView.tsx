'use client';

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useGameStore } from '@/stores/useGameStore';

export const DuelRevealView: React.FC = () => {
  const { gameState } = useGameStore();
  const duel = gameState?.currentDuel;
  const results = duel?.results;
  const multiplier = gameState?.roundMultiplier || 1;

  useEffect(() => {
    if (results?.isSweepA || results?.isSweepB) {
      confetti({
        particleCount: 70,
        spread: 80,
        origin: { y: 0.6 },
        disableForReducedMotion: true,
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

  // JINX View
  if (results.isJinx) {
    return (
      <div className="flex-1 flex flex-col justify-between py-2 gap-4 text-center">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <span className="text-[10px] tracking-widest uppercase font-bold text-rose-400">
            JINX! Duplicate Punchline
          </span>
          <h2 className="text-base sm:text-lg font-black text-white mt-1">
            &ldquo;{duel.promptText}&rdquo;
          </h2>
        </div>

        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          className="bg-rose-950/40 border-2 border-rose-500 rounded-3xl p-6 space-y-3 my-auto shadow-2xl"
        >
          <div className="text-4xl">🚨 JINX 🚨</div>
          <div className="text-xl font-black text-rose-200">
            Identical Minds!
          </div>
          <p className="text-sm font-extrabold text-white">
            &ldquo;{duel.optionA.text}&rdquo;
          </p>
          <div className="text-xs text-rose-300">
            Both players typed the exact same answer. Voting was cancelled and 0 points awarded!
          </div>
        </motion.div>

        <div className="text-center text-[11px] font-mono text-slate-500">
          Next matchup in {gameState.phaseTimeRemaining}s...
        </div>
      </div>
    );
  }

  const isSweep = results.isSweepA || results.isSweepB;

  return (
    <div className="flex-1 flex flex-col justify-between py-2 gap-3.5">
      {/* Pinned Top Prompt */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center shadow-lg">
        <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400 mb-1">
          <span className="text-emerald-400">Duel {duel.duelNumber} of {duel.totalDuels}</span>
          {multiplier > 1 && (
            <span className="text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/30">
              {multiplier}x Points
            </span>
          )}
        </div>
        <h2 className="text-base sm:text-lg font-black text-white">
          &ldquo;{duel.promptText}&rdquo;
        </h2>
      </div>

      {/* Sweep Badge */}
      {isSweep ? (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-amber-500 text-slate-950 font-black text-xs py-1.5 px-4 rounded-full mx-auto uppercase tracking-wider shadow-lg flex items-center gap-1.5"
        >
          <span>🔥</span> CLEAN SWEEP BONUS (+{250 * multiplier} PTS) <span>🔥</span>
        </motion.div>
      ) : results.winnerBonus ? (
        <div className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold text-xs py-1 px-3 rounded-full mx-auto uppercase tracking-wider">
          Winner Bonus (+{results.winnerBonus} PTS)
        </div>
      ) : null}

      {/* Cards with Vote Breakdown */}
      <div className="flex-1 flex flex-col justify-center gap-3">
        {(['A', 'B'] as const).map((key) => {
          const option = key === 'A' ? duel.optionA : duel.optionB;
          const votes = key === 'A' ? results.votesA : results.votesB;
          const pct = key === 'A' ? results.pctA : results.pctB;
          const points = key === 'A' ? results.pointsA : results.pointsB;
          const isWinner = results.winnerKey === key;
          const isPenalty = key === 'A' ? results.penaltyA : results.penaltyB;

          return (
            <motion.div
              key={key}
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.25 }}
              className={`p-4 rounded-2xl border-2 flex flex-col justify-between gap-2.5 ${
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
                &ldquo;{option.text}&rdquo;
              </p>

              {/* Safety Quip Penalty Tag */}
              {isPenalty && (
                <div className="text-[10px] font-bold text-amber-300 bg-amber-950/50 border border-amber-500/30 px-2 py-0.5 rounded inline-block">
                  ⚠️ SAFETY QUIP (50% Point Deduction)
                </div>
              )}

              {/* Secret Roast (Quip Pro Quo) */}
              {option.secretRoast && (
                <div className="text-[11px] font-semibold text-sky-300 bg-sky-950/50 border border-sky-500/30 p-2 rounded-xl">
                  🎙️ <span className="font-bold">Host Roast:</span> &ldquo;{option.secretRoast}&rdquo;
                </div>
              )}

              {/* Author Reveal & Voters */}
              <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 font-medium">By:</span>
                  <span className="font-bold text-amber-300">
                    {option.authorNickname || 'Author'}
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
        Next matchup in {gameState.phaseTimeRemaining}s...
      </div>
    </div>
  );
};
