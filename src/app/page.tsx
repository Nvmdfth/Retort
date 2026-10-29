'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useGameStore } from '@/stores/useGameStore';

function LobbyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { initSocket, createRoom, joinRoom, errorMessage, clearError } = useGameStore();

  const initialCode = (searchParams.get('code') || '').toUpperCase();
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState(initialCode);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    initSocket();
  }, [initSocket]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;

    setLoading(true);
    clearError();

    try {
      if (mode === 'create') {
        const code = await createRoom(nickname.trim());
        router.push(`/room/${code}`);
      } else {
        const cleanCode = roomCode.trim().toUpperCase();
        if (!cleanCode) {
          setLoading(false);
          return;
        }
        await joinRoom(cleanCode, nickname.trim());
        router.push(`/room/${cleanCode}`);
      }
    } catch {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-dvh flex flex-col justify-between max-w-md mx-auto w-full bg-slate-950 text-slate-100 p-6 select-none">
      <div className="space-y-6 pt-6">
        {/* Branding Header */}
        <div className="text-center space-y-2">
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="inline-block"
          >
            <span className="text-4xl sm:text-5xl font-black tracking-tight text-white">
              RE<span className="text-emerald-400">TORT</span>
            </span>
          </motion.div>
          <p className="text-xs sm:text-sm text-slate-400 font-medium">
            The no-TV-required, mobile-first punchline battle.
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setMode('join')}
            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
              mode === 'join'
                ? 'bg-emerald-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Join Room
          </button>
          <button
            type="button"
            onClick={() => setMode('create')}
            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
              mode === 'create'
                ? 'bg-emerald-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Create Room
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'join' && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                4-Letter Room Code
              </label>
              <input
                type="text"
                required
                maxLength={4}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="e.g. ABCD"
                className="w-full bg-slate-900 border-2 border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-center text-2xl font-black font-mono tracking-widest text-emerald-400 uppercase placeholder-slate-600 outline-none transition-colors"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Your Nickname
            </label>
            <input
              type="text"
              required
              maxLength={16}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Quipster"
              className="w-full bg-slate-900 border-2 border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base font-bold text-white placeholder-slate-600 outline-none transition-colors"
            />
          </div>

          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-semibold text-center">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !nickname.trim() || (mode === 'join' && roomCode.length < 4)}
            className={`w-full py-4 rounded-xl font-black text-sm uppercase tracking-wider transition-all shadow-lg ${
              loading || !nickname.trim() || (mode === 'join' && roomCode.length < 4)
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 active:scale-[0.98] shadow-emerald-500/20'
            }`}
          >
            {loading ? 'Entering Room...' : mode === 'join' ? 'Join Game' : 'Create Room'}
          </button>
        </form>
      </div>

      <div className="py-4 text-center text-[11px] text-slate-600 font-medium">
        Pure mobile multiplayer &bull; Zero app install needed
      </div>
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-slate-950" />}>
      <LobbyForm />
    </Suspense>
  );
}
