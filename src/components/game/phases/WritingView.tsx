'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/stores/useGameStore';

export const WritingView: React.FC = () => {
  const {
    gameState,
    activePromptIndex,
    setActivePromptIndex,
    drafts,
    setDraft,
    submitAnswer,
    isSubmitting,
  } = useGameStore();

  if (!gameState) return null;

  const prompts = gameState.activePrompts || [];
  const currentPrompt = prompts[activePromptIndex] || prompts[0];
  const draftText = currentPrompt ? drafts[currentPrompt.id] || '' : '';
  const remainingChars = 45 - draftText.length;
  const players = gameState.players || [];
  const submittedIds = new Set(gameState.submittedPlayerIds || []);

  const totalDone = players.filter((p) => submittedIds.has(p.id)).length;
  const isSelfDone = submittedIds.has(gameState.selfPlayerId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPrompt || !draftText.trim()) return;

    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(20);
    }

    submitAnswer(currentPrompt.id, draftText);

    // If another prompt is waiting to be answered, advance to it
    if (activePromptIndex + 1 < prompts.length) {
      setActivePromptIndex(activePromptIndex + 1);
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-between py-2 gap-4">
      {/* Prompts Tab Bar (If multiple assigned) */}
      {prompts.length > 1 && (
        <div className="flex gap-2">
          {prompts.map((p, idx) => {
            const hasDraft = !!(drafts[p.id] && drafts[p.id].trim());
            const isActive = activePromptIndex === idx;

            return (
              <button
                key={p.id}
                onClick={() => setActivePromptIndex(idx)}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all border ${
                  isActive
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-md'
                    : 'bg-slate-900 text-slate-400 border-slate-800'
                }`}
              >
                Prompt #{idx + 1} {hasDraft && !isActive && '•'}
              </button>
            );
          })}
        </div>
      )}

      {/* Active Prompt Card */}
      <div className="flex-1 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {currentPrompt ? (
            <motion.div
              key={currentPrompt.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4"
            >
              <span className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-400">
                Write Your Funniest Quip
              </span>
              <h2 className="text-lg sm:text-xl font-black text-white leading-snug">
                "{currentPrompt.text}"
              </h2>

              <form onSubmit={handleSubmit} className="space-y-3 pt-2">
                <div className="relative">
                  <textarea
                    rows={2}
                    maxLength={45}
                    value={draftText}
                    onChange={(e) => setDraft(currentPrompt.id, e.target.value)}
                    placeholder="Type your punchline here..."
                    className="w-full bg-slate-950 border-2 border-slate-700 focus:border-emerald-400 rounded-xl p-3 text-base font-semibold text-white placeholder-slate-500 outline-none resize-none transition-colors"
                  />
                  <div
                    className={`absolute bottom-2.5 right-3 text-xs font-mono font-bold ${
                      remainingChars <= 5 ? 'text-rose-400' : 'text-slate-500'
                    }`}
                  >
                    {remainingChars}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!draftText.trim() || isSubmitting}
                  className={`w-full py-3.5 rounded-xl font-black text-sm tracking-wide uppercase transition-all shadow-md ${
                    draftText.trim()
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 active:scale-[0.98]'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {isSubmitting
                    ? 'Locking in...'
                    : activePromptIndex + 1 < prompts.length
                    ? 'Submit & Next Prompt &rarr;'
                    : 'Lock In Punchline'}
                </button>
              </form>
            </motion.div>
          ) : (
            <div className="text-center text-slate-500 py-8">
              Waiting for prompts...
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Real-Time Live Lock-In Checklist */}
      <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold uppercase tracking-wider text-slate-400">
            Room Submissions
          </span>
          <span className="font-mono font-bold text-emerald-400">
            {totalDone} / {players.length} Ready
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 max-h-[85px] overflow-y-auto">
          {players.map((p) => {
            const isDone = submittedIds.has(p.id);
            return (
              <div
                key={p.id}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                  isDone
                    ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-500'
                }`}
              >
                <span>{isDone ? '✓' : '•'}</span>
                <span>{p.nickname}</span>
              </div>
            );
          })}
        </div>

        {isSelfDone && (
          <div className="text-[11px] text-center text-emerald-400/90 font-medium pt-1">
            You're all locked in! Waiting for the rest of the room...
          </div>
        )}
      </div>
    </div>
  );
};
