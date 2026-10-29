'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/stores/useGameStore';

export const LobbyView: React.FC = () => {
  const { gameState, startGame } = useGameStore();
  const [copied, setCopied] = useState(false);

  if (!gameState) return null;

  const players = gameState.players || [];
  const isHost = gameState.isHost;
  const canStart = players.length >= 3;

  const copyInvite = async () => {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/?code=${gameState.roomCode}`;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      } else {
        // Fallback for non-secure contexts (LAN IP / HTTP)
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) {
          setCopied(true);
        } else {
          throw new Error('execCommand copy returned false');
        }
      }
    } catch {
      window.prompt('Copy room invite link:', url);
      setCopied(true);
    }

    setTimeout(() => setCopied(false), 2500);
  };

  const shareInvite = async () => {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/?code=${gameState.roomCode}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join Retort Room ${gameState.roomCode}`,
          text: `Join our Retort punchline party game! Room Code: ${gameState.roomCode}`,
          url,
        });
        return;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    // Fallback to copy if native share cancelled or unavailable
    await copyInvite();
  };

  return (
    <div className="flex-1 flex flex-col justify-between py-2 gap-4">
      <div className="space-y-4">
        {/* Room Banner */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 text-center shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
            Room Code
          </p>
          <div className="text-4xl font-black tracking-wider text-emerald-400 font-mono mb-3">
            {gameState.roomCode}
          </div>

          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={copyInvite}
              className={`cursor-pointer select-none active:scale-95 text-xs font-bold px-3.5 py-2 rounded-xl transition-all border shadow-sm ${
                copied
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
            >
              {copied ? 'Copied to Clipboard! ✓' : '📋 Copy Invite Link'}
            </button>

            {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
              <button
                type="button"
                onClick={shareInvite}
                className="cursor-pointer select-none active:scale-95 text-xs font-bold px-3.5 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-all"
              >
                📲 Share
              </button>
            )}
          </div>
        </div>

        {/* Connected Roster */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Players In Lobby
            </span>
            <span className="text-xs font-mono font-bold text-emerald-400">
              {players.length} Joined
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-1">
            {players.map((p, idx) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`flex items-center justify-between p-3 rounded-xl border ${
                  p.id === gameState.selfPlayerId
                    ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-100'
                    : 'bg-slate-900 border-slate-800 text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center font-black text-slate-950 text-sm shadow">
                    {p.nickname.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <span className="font-bold text-sm block leading-tight">
                      {p.nickname}
                    </span>
                    {p.id === gameState.selfPlayerId && (
                      <span className="text-[10px] text-emerald-400 font-medium">
                        (You)
                      </span>
                    )}
                  </div>
                </div>

                {p.isHost && (
                  <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/30">
                    VIP Host
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Tray */}
      <div className="space-y-3 pt-2">
        {isHost ? (
          <button
            type="button"
            onClick={startGame}
            disabled={!canStart}
            className={`w-full py-4 rounded-xl font-black text-base tracking-wide uppercase transition-all shadow-lg ${
              canStart
                ? 'cursor-pointer bg-emerald-500 hover:bg-emerald-400 text-slate-950 active:scale-[0.98] shadow-emerald-500/20'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
            }`}
          >
            {canStart ? 'Start Game' : 'Waiting For Players (Min 3)'}
          </button>
        ) : (
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
            Waiting for the host to start the match...
          </div>
        )}

        <div className="text-center">
          <a
            href={`/room/${gameState.roomCode}/host`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-medium text-slate-400 hover:text-slate-200 underline underline-offset-4"
          >
            Open Projector / TV View →
          </a>
        </div>
      </div>
    </div>
  );
};
