'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import type { HostGameState } from '@/types/game';

function HostDashboardContent() {
  const params = useParams();
  const roomCode = ((params?.code as string) || '').toUpperCase();
  const [hostState, setHostState] = useState<HostGameState | null>(null);

  useEffect(() => {
    const socket: Socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || '', {
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      socket.emit('host:subscribe', { roomCode });
    });

    socket.on('sync:host', (data: HostGameState) => {
      setHostState(data);
    });

    return () => {
      socket.disconnect();
    };
  }, [roomCode]);

  if (!hostState) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-mono">
        Connecting TV / Projector Feed for Room {roomCode}...
      </div>
    );
  }

  const { phase, currentDuel, leaderboard, players } = hostState;

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col justify-between p-8 sm:p-12 overflow-hidden select-none">
      {/* Top TV Bar */}
      <header className="flex items-center justify-between border-b border-slate-800 pb-6">
        <div className="flex items-center gap-6">
          <div className="text-3xl font-black tracking-tight text-white">
            RE<span className="text-emerald-400">TORT</span>
          </div>
          <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl">
            <span className="text-xs uppercase font-extrabold text-slate-400 tracking-wider">
              Join At
            </span>
            <span className="text-sm font-mono font-bold text-slate-200">
              retort.game
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <span className="text-xs uppercase font-extrabold text-slate-400 tracking-widest block">
              Room Code
            </span>
            <span className="text-4xl font-mono font-black text-emerald-400 tracking-widest">
              {roomCode}
            </span>
          </div>
          {phase !== 'LOBBY' && (
            <div className="bg-slate-900 border border-slate-800 px-5 py-3 rounded-2xl flex items-center gap-3">
              <span className="text-3xl font-mono font-black text-amber-400">
                {hostState.phaseTimeRemaining}s
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Main Screen Center Display */}
      <main className="flex-1 flex flex-col justify-center my-6">
        <AnimatePresence mode="wait">
          {/* LOBBY VIEW */}
          {phase === 'LOBBY' && (
            <motion.div
              key="host-lobby"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="text-center space-y-8 max-w-4xl mx-auto w-full"
            >
              <div className="space-y-3">
                <h1 className="text-5xl font-black text-white">
                  Join with your phone
                </h1>
                <p className="text-slate-400 text-lg">
                  Go to <span className="text-emerald-400 font-bold">your mobile browser</span> and enter room code <span className="font-mono font-black text-white">{roomCode}</span>
                </p>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-8">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
                  <span className="text-sm font-extrabold uppercase tracking-wider text-slate-400">
                    Players In Room
                  </span>
                  <span className="text-lg font-mono font-black text-emerald-400">
                    {players.length} Connected
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {players.map((p) => (
                    <div
                      key={p.id}
                      className="bg-slate-950 border border-slate-800 p-4 rounded-2xl flex items-center gap-3 shadow"
                    >
                      <div className="w-10 h-10 rounded-full bg-emerald-500 text-slate-950 font-black flex items-center justify-center text-base">
                        {p.nickname.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="text-left">
                        <span className="font-black text-base text-white block">
                          {p.nickname}
                        </span>
                        {p.isHost && (
                          <span className="text-[10px] font-bold uppercase text-amber-400">
                            VIP
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* WRITING VIEW */}
          {phase === 'WRITING' && (
            <motion.div
              key="host-writing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center space-y-8 max-w-2xl mx-auto"
            >
              <div className="space-y-3">
                <span className="text-xs font-black uppercase tracking-widest text-emerald-400">
                  Phase 1: Simultaneous Writing
                </span>
                <h2 className="text-4xl font-black text-white">
                  Check your phones!
                </h2>
                <p className="text-slate-400 text-base">
                  Write the funniest responses to your assigned secret prompts.
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
                <div className="text-5xl font-mono font-black text-emerald-400 mb-2">
                  {hostState.submittedCount} / {hostState.totalPlayers}
                </div>
                <div className="text-sm uppercase font-bold text-slate-400 tracking-wider">
                  Players Submitted
                </div>
              </div>
            </motion.div>
          )}

          {/* DUEL VOTING OR REVEAL VIEW */}
          {(phase === 'DUEL_VOTING' || phase === 'DUEL_REVEAL') && currentDuel && (
            <motion.div
              key="host-duel"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8 max-w-5xl mx-auto w-full"
            >
              {/* Prompt Banner */}
              <div className="text-center bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
                <span className="text-xs uppercase font-extrabold tracking-widest text-emerald-400 mb-2 block">
                  Duel {currentDuel.duelNumber} of {currentDuel.totalDuels}
                </span>
                <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight">
                  "{currentDuel.promptText}"
                </h2>
              </div>

              {/* Side-by-side big screen cards */}
              <div className="grid grid-cols-2 gap-8">
                {(['A', 'B'] as const).map((key) => {
                  const option = key === 'A' ? currentDuel.optionA : currentDuel.optionB;
                  const res = currentDuel.results;
                  const votes = res ? (key === 'A' ? res.votesA : res.votesB) : [];
                  const pct = res ? (key === 'A' ? res.pctA : res.pctB) : null;
                  const points = res ? (key === 'A' ? res.pointsA : res.pointsB) : null;

                  return (
                    <div
                      key={key}
                      className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-8 flex flex-col justify-between min-h-[260px] shadow-2xl"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-black px-3 py-1 rounded bg-slate-800 text-slate-300">
                          CARD {key}
                        </span>
                        {pct !== null && (
                          <div className="flex items-center gap-3">
                            <span className="text-xl font-mono font-black text-slate-300">
                              {pct}%
                            </span>
                            <span className="text-sm font-black text-emerald-400 bg-emerald-950 px-3 py-1 rounded-full border border-emerald-500/30">
                              +{points} PTS
                            </span>
                          </div>
                        )}
                      </div>

                      <p className="text-2xl font-black text-white my-auto">
                        "{option.text}"
                      </p>

                      {phase === 'DUEL_REVEAL' && (
                        <div className="border-t border-slate-800 pt-4 mt-4 flex items-center justify-between">
                          <span className="text-sm font-bold text-amber-300">
                            By {option.authorNickname}
                          </span>
                          <div className="flex gap-1.5">
                            {votes.map((v) => (
                              <span
                                key={v.id}
                                className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-800 text-slate-200"
                              >
                                {v.nickname}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* SCOREBOARD & INTERMISSION VIEW */}
          {(phase === 'SCOREBOARD' || phase === 'ROUND_INTERMISSION') && leaderboard && (
            <motion.div
              key="host-scoreboard"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-4xl mx-auto w-full space-y-6"
            >
              <div className="text-center space-y-2">
                <span className="text-xs uppercase font-extrabold tracking-widest text-emerald-400">
                  {phase === 'SCOREBOARD'
                    ? 'Game Over'
                    : `Round ${hostState.round} of ${hostState.totalRounds || 3} Complete`}
                </span>
                <h1 className="text-5xl font-black text-white">
                  {phase === 'SCOREBOARD' ? 'Grand Scoreboard' : 'Current Standings'}
                </h1>
                {phase === 'ROUND_INTERMISSION' && (
                  <p className="text-sm font-semibold text-emerald-300">
                    Next round starts in {hostState.phaseTimeRemaining}s &bull; Points are{' '}
                    {hostState.round === 1 ? 'DOUBLED (2x)' : 'TRIPLED (3x - Finale)'}!
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto">
                {leaderboard.map((item) => (
                  <div
                    key={item.playerId}
                    className={`flex items-center justify-between p-5 rounded-2xl border-2 ${
                      item.rank === 1
                        ? 'bg-amber-950/20 border-amber-500 text-amber-200 shadow-xl'
                        : 'bg-slate-900 border-slate-800 text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-2xl font-mono font-black w-8">
                        #{item.rank}
                      </span>
                      <span className="text-xl font-black text-white">
                        {item.nickname}
                      </span>
                    </div>
                    <span className="text-2xl font-mono font-black text-emerald-400">
                      {item.score.toLocaleString()} PTS
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* TV Footer */}
      <footer className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-800 pt-6 font-medium">
        <span>Retort Engine &bull; Zero App Install</span>
        <span>Dual-Mode Projector Sync Active</span>
      </footer>
    </div>
  );
}

export default function HostDashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <HostDashboardContent />
    </Suspense>
  );
}
