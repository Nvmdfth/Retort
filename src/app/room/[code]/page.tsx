'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useGameStore } from '@/stores/useGameStore';
import { GameViewController } from '@/components/game/GameViewController';

function RoomContent() {
  const params = useParams();
  const router = useRouter();
  const roomCode = ((params?.code as string) || '').toUpperCase();

  const { gameState, initSocket, joinRoom, errorMessage } = useGameStore();
  const [nickname, setNickname] = useState(() =>
    typeof window !== 'undefined' ? sessionStorage.getItem('retort_nickname') || '' : ''
  );
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    initSocket();
    if (typeof window !== 'undefined') {
      const savedCode = sessionStorage.getItem('retort_room_code');
      const savedNick = sessionStorage.getItem('retort_nickname');
      if (savedCode === roomCode && savedNick && !gameState) {
        joinRoom(roomCode, savedNick).catch(() => {});
      }
    }
  }, [initSocket, roomCode, gameState, joinRoom]);

  // If already connected to this room, render the game view controller
  if (gameState && gameState.roomCode === roomCode) {
    return <GameViewController />;
  }

  const handleJoinDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || !roomCode) return;

    setIsJoining(true);
    try {
      await joinRoom(roomCode, nickname.trim());
    } catch {
      setIsJoining(false);
    }
  };

  return (
    <main className="min-h-dvh flex flex-col justify-center max-w-md mx-auto w-full bg-slate-950 text-slate-100 p-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="text-center space-y-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
            Joining Room
          </span>
          <div className="text-3xl font-black font-mono text-emerald-400">
            {roomCode}
          </div>
        </div>

        <form onSubmit={handleJoinDirect} className="space-y-4 pt-2">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Choose Nickname
            </label>
            <input
              type="text"
              required
              maxLength={16}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Quipster"
              autoFocus
              className="w-full bg-slate-950 border-2 border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base font-bold text-white placeholder-slate-600 outline-none transition-colors"
            />
          </div>

          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-semibold text-center">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={isJoining || !nickname.trim()}
            className={`w-full py-4 rounded-xl font-black text-sm uppercase tracking-wider transition-all shadow-lg ${
              isJoining || !nickname.trim()
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 active:scale-[0.98]'
            }`}
          >
            {isJoining ? 'Connecting...' : 'Join Game'}
          </button>

          <button
            type="button"
            onClick={() => router.push('/')}
            className="w-full text-xs text-slate-500 hover:text-slate-300 py-2 transition-colors"
          >
            &larr; Back to Home
          </button>
        </form>
      </div>
    </main>
  );
}

export default function RoomPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-slate-950" />}>
      <RoomContent />
    </Suspense>
  );
}
