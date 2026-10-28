'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useGameStore } from '@/stores/useGameStore';
import { LobbyView } from './phases/LobbyView';
import { WritingView } from './phases/WritingView';
import { DuelVotingView } from './phases/DuelVotingView';
import { DuelRevealView } from './phases/DuelRevealView';
import { ScoreboardView } from './phases/ScoreboardView';
import { SharedTimer } from './SharedTimer';

const viewVariants: Variants = {
  initial: { opacity: 0, y: 16, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: 'easeOut' } },
  exit: { opacity: 0, y: -16, scale: 0.98, transition: { duration: 0.16, ease: 'easeIn' } },
};

export const GameViewController: React.FC = () => {
  const { gameState, initSocket, errorMessage, clearError } = useGameStore();

  useEffect(() => {
    initSocket();
  }, [initSocket]);

  if (!gameState) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-400 font-mono text-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span>Connecting to room session...</span>
        </div>
      </div>
    );
  }

  return (
    <main className="relative flex flex-col min-h-dvh max-w-md mx-auto w-full bg-slate-950 text-slate-100 overflow-hidden select-none touch-manipulation px-4 py-3">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="font-mono font-black tracking-widest text-lg text-emerald-400">
            {gameState.roomCode}
          </span>
          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
            R{gameState.round}
          </span>
        </div>

        {gameState.phase !== 'LOBBY' && (
          <SharedTimer
            remaining={gameState.phaseTimeRemaining}
            total={gameState.phaseDuration}
          />
        )}
      </header>

      {/* Error Toast Banner */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onClick={clearError}
            className="my-2 p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-semibold text-center cursor-pointer"
          >
            {errorMessage} (tap to dismiss)
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dynamic Animated Phase Router */}
      <div className="flex-1 flex flex-col mt-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={gameState.phase}
            variants={viewVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex-1 flex flex-col w-full"
          >
            {(() => {
              switch (gameState.phase) {
                case 'LOBBY':
                  return <LobbyView />;
                case 'WRITING':
                  return <WritingView />;
                case 'DUEL_VOTING':
                  return <DuelVotingView />;
                case 'DUEL_REVEAL':
                  return <DuelRevealView />;
                case 'SCOREBOARD':
                  return <ScoreboardView />;
                default:
                  return null;
              }
            })()}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
};
