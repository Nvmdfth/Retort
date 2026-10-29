'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/stores/useGameStore';

export const DuelVotingView: React.FC = () => {
  const { gameState, selectedVote, castVote } = useGameStore();
  const duel = gameState?.currentDuel;

  if (!duel) {
    return (
      <div className="flex-1 flex items-center justify-center text-center text-slate-500 font-medium">
        Loading next duel...
      </div>
    );
  }

  // JINX alert
  if (duel.isJinx) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
        <motion.div
          initial={{ scale: 0.5, rotate: -10 }}
          animate={{ scale: [1, 1.2, 1], rotate: [0, 5, -5, 0] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="text-6xl"
        >
          🚨
        </motion.div>
        <div className="bg-rose-500 text-slate-950 font-black text-xs px-3 py-1 rounded-full uppercase tracking-wider">
          JINX DETECTED!
        </div>
        <h2 className="text-xl font-black text-white">
          &ldquo;{duel.promptText}&rdquo;
        </h2>
        <p className="text-xs text-rose-300 max-w-xs leading-relaxed">
          Both players submitted the exact same punchline! Voting is cancelled and both receive 0 points!
        </p>
      </div>
    );
  }

  // Author lockout: Competing authors cannot vote on their own duel
  if (!duel.canVote) {
    return (
      <div className="flex-1 flex flex-col justify-between py-4">
        {/* Duel Header */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <span className="text-[10px] tracking-widest uppercase font-bold text-amber-400">
            Duel {duel.duelNumber} of {duel.totalDuels}
          </span>
          <h2 className="text-base sm:text-lg font-black text-white mt-1">
            &ldquo;{duel.promptText}&rdquo;
          </h2>
        </div>

        {/* Lockout graphic */}
        <div className="bg-amber-950/20 border border-amber-500/30 rounded-2xl p-6 text-center space-y-3 my-auto">
          <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center text-xl font-black">
            ⚔️
          </div>
          <h3 className="text-lg font-black text-amber-200">
            You&apos;re In This Duel!
          </h3>
          <p className="text-xs text-amber-300/80 max-w-xs mx-auto leading-relaxed">
            One of the cards below is your punchline. You cannot vote in your own match.
            Watch the room decide your fate!
          </p>

          <div className="pt-2 text-xs font-mono font-bold text-slate-400">
            Votes Cast: {duel.totalVotesCast} / {duel.totalEligibleVoters}
          </div>
        </div>

        {/* Both Cards Preview */}
        <div className="space-y-2 opacity-60 pointer-events-none">
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-sm font-bold text-slate-300">
            {duel.optionA.text}
          </div>
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-sm font-bold text-slate-300">
            {duel.optionB.text}
          </div>
        </div>
      </div>
    );
  }

  const handleVote = (choice: 'A' | 'B') => {
    if (selectedVote || !duel.id) return;
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(25);
    }
    castVote(duel.id, choice);
  };

  return (
    <div className="flex-1 flex flex-col justify-between py-2 gap-4">
      {/* Pinned Top Prompt */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg text-center">
        <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400 mb-1">
          <span className="text-emerald-400">Duel {duel.duelNumber} of {duel.totalDuels}</span>
          <span className="font-mono">{duel.totalVotesCast}/{duel.totalEligibleVoters} Voted</span>
        </div>
        <h2 className="text-lg sm:text-xl font-black text-white leading-snug">
          &ldquo;{duel.promptText}&rdquo;
        </h2>
      </div>

      {/* Thumb-Zone Answer Cards (Vertical Split on Mobile) */}
      <div className="flex-1 flex flex-col justify-end gap-3.5 pb-2">
        {(['A', 'B'] as const).map((key) => {
          const option = key === 'A' ? duel.optionA : duel.optionB;
          const effectiveVote = selectedVote || duel.myVote || null;
          const isSelected = effectiveVote === key;
          const isOtherSelected = effectiveVote !== null && !isSelected;

          return (
            <motion.button
              key={key}
              whileTap={{ scale: 0.96 }}
              animate={{
                scale: isSelected ? 1.02 : isOtherSelected ? 0.96 : 1,
                opacity: isOtherSelected ? 0.4 : 1,
              }}
              transition={{ type: 'spring', stiffness: 450, damping: 25 }}
              onClick={() => handleVote(key)}
              disabled={effectiveVote !== null}
              className={`relative w-full min-h-[145px] flex flex-col justify-between p-5 rounded-2xl border-2 text-left transition-all ${
                isSelected
                  ? 'bg-emerald-950/50 border-emerald-400 shadow-xl shadow-emerald-500/20'
                  : 'bg-slate-900 border-slate-700 hover:border-slate-600 active:border-emerald-500'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className={`text-[11px] font-black px-2.5 py-0.5 rounded ${
                  isSelected ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                }`}>
                  CARD {key}
                </span>

                {isSelected && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="text-xs font-black text-emerald-400 tracking-wider flex items-center gap-1"
                  >
                    VOTED ✓
                  </motion.span>
                )}
              </div>

              <p className="text-base sm:text-lg font-black text-slate-100 my-auto leading-snug">
                {option.text}
              </p>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};
