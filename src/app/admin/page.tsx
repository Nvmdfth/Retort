'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import type { AdminRoomSummary, ClientToServerEvents, ServerToClientEvents } from '@/types/game';

type AdminSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export default function AdminDashboardPage() {
  const [secret, setSecret] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<AdminRoomSummary[]>([]);
  const [socket, setSocket] = useState<AdminSocket | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Initialize admin socket
  useEffect(() => {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || '';
    const s: AdminSocket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    s.on('connect_error', (err) => {
      console.warn('[Admin socket connection error]', err.message);
    });

    s.on('admin:sync:rooms', (updatedRooms) => {
      setRooms(updatedRooms);
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket) {
      setAuthError('Connection initializing, please retry in a moment...');
      return;
    }
    setAuthError(null);
    setIsBusy(true);

    const timer = setTimeout(() => {
      setIsBusy(false);
      setAuthError('Authentication timed out. Ensure the server is reachable.');
    }, 5000);

    socket.emit('admin:auth', { secret }, (res) => {
      clearTimeout(timer);
      setIsBusy(false);
      if (res?.ok) {
        setIsAuthenticated(true);
        setStatusMessage('Authenticated as Administrator.');
      } else {
        setAuthError(res?.error || 'Invalid admin credentials');
      }
    });
  };

  const handleRefresh = useCallback(() => {
    if (!socket || !isAuthenticated) return;
    socket.emit('admin:rooms:list', (list) => {
      setRooms(list);
      setStatusMessage(`Synced ${list.length} room(s) at ${new Date().toLocaleTimeString()}`);
    });
  }, [socket, isAuthenticated]);

  const handleTerminateRoom = (roomCode: string) => {
    if (!socket) return;
    if (!window.confirm(`Are you sure you want to terminate and remove room ${roomCode}? Active players will be disconnected.`)) {
      return;
    }

    socket.emit('admin:room:terminate', { roomCode }, (res) => {
      if (res.ok) {
        setStatusMessage(`Room ${roomCode} successfully terminated.`);
      } else {
        setStatusMessage(`Failed to terminate room ${roomCode}.`);
      }
    });
  };

  const handleAdvancePhase = (roomCode: string) => {
    if (!socket) return;
    socket.emit('admin:room:advance', { roomCode }, (res) => {
      if (res.ok) {
        setStatusMessage(`Room ${roomCode} phase advanced.`);
      } else {
        setStatusMessage(`Failed to advance room ${roomCode}.`);
      }
    });
  };

  const totalPlayers = rooms.reduce((acc, r) => acc + r.playerCount, 0);

  if (!isAuthenticated) {
    return (
      <main className="min-h-dvh bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
          <div className="text-center space-y-1">
            <span className="text-[10px] uppercase font-black tracking-widest text-emerald-400">
              Retort Ops
            </span>
            <h1 className="text-2xl font-black text-white">Admin Command Center</h1>
            <p className="text-xs text-slate-400">
              Silent real-time game telemetry & room administration
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase mb-1">
                Admin Secret Key
              </label>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Enter admin password"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                required
              />
            </div>

            {authError && (
              <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 text-xs font-semibold text-center">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={isBusy}
              className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl transition-all disabled:opacity-50"
            >
              {isBusy ? 'Authenticating...' : 'Authorize Access →'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 p-4 md:p-8 space-y-6">
      {/* Admin Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              Silent Observer Active
            </span>
            <span className="text-xs text-slate-500 font-mono">devpi:9847</span>
          </div>
          <h1 className="text-2xl font-black text-white mt-1">
            Game Supervision & Room Management
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-bold text-slate-200 transition-all flex items-center gap-2"
          >
            <span>🔄</span> Refresh Rooms
          </button>
          <button
            onClick={() => {
              setIsAuthenticated(false);
              setSecret('');
            }}
            className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 rounded-xl text-xs font-bold transition-all"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Global Status Banner */}
      {statusMessage && (
        <div className="p-3 bg-slate-900 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs font-medium flex items-center justify-between">
          <span>{statusMessage}</span>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-slate-500 hover:text-slate-300 text-sm ml-2"
          >
            &times;
          </button>
        </div>
      )}

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            Active Rooms
          </div>
          <div className="text-2xl font-black text-white mt-1 font-mono">
            {rooms.length}
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            Connected Players
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-1 font-mono">
            {totalPlayers}
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            In Duels / Voting
          </div>
          <div className="text-2xl font-black text-amber-400 mt-1 font-mono">
            {rooms.filter((r) => r.phase === 'DUEL_VOTING' || r.phase === 'DUEL_REVEAL').length}
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            Observation Mode
          </div>
          <div className="text-xs font-bold text-slate-300 mt-2">
            Zero Player Notification
          </div>
        </div>
      </div>

      {/* Active Rooms List */}
      <div className="space-y-4">
        <h2 className="text-lg font-black text-white flex items-center gap-2">
          <span>Active Game Sessions</span>
          <span className="text-xs font-mono font-normal text-slate-400">
            ({rooms.length})
          </span>
        </h2>

        {rooms.length === 0 ? (
          <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-2xl p-12 text-center space-y-2">
            <div className="text-3xl">🎮</div>
            <div className="text-sm font-bold text-slate-300">No Active Game Rooms</div>
            <p className="text-xs text-slate-500">
              When players create rooms at <code className="text-emerald-400 font-mono">/</code>, they will appear here live.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AnimatePresence>
              {rooms.map((room) => (
                <motion.div
                  key={room.roomCode}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl"
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl font-black font-mono tracking-widest text-emerald-400">
                        {room.roomCode}
                      </span>
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border ${
                          room.phase === 'LOBBY'
                            ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                            : room.phase === 'WRITING'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                            : room.phase === 'DUEL_VOTING'
                            ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                            : room.phase === 'DUEL_REVEAL'
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                            : room.phase === 'ROUND_INTERMISSION'
                            ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        }`}
                      >
                        {room.phase}
                      </span>
                    </div>

                    <div className="text-right">
                      <div className="text-xs font-bold text-slate-300">
                        Round {room.round} of {room.totalRounds || 3}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500">
                        Uptime: {Math.floor(room.uptimeSeconds / 60)}m {room.uptimeSeconds % 60}s
                      </div>
                    </div>
                  </div>

                  {/* Active Prompt & Duel Preview (if in duel) */}
                  {room.activeDuel && (
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                      <div className="text-[10px] uppercase font-bold text-slate-500 flex justify-between">
                        <span>Active Duel #{room.activeDuel.duelNumber}/{room.activeDuel.totalDuels}</span>
                        <span>Votes: {room.activeDuel.votesCast} / {room.activeDuel.totalEligible}</span>
                      </div>
                      <div className="text-xs font-semibold text-slate-200">
                        &ldquo;{room.activePrompt}&rdquo;
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                          <span className="text-[9px] uppercase font-bold text-slate-400 block">
                            A ({room.activeDuel.authorA}):
                          </span>
                          <span className="font-medium text-slate-100">
                            {room.activeDuel.textA}
                          </span>
                        </div>
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                          <span className="text-[9px] uppercase font-bold text-slate-400 block">
                            B ({room.activeDuel.authorB}):
                          </span>
                          <span className="font-medium text-slate-100">
                            {room.activeDuel.textB}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Player Roster */}
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Players ({room.playerCount})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {room.activePlayers.map((player) => (
                        <div
                          key={player.id}
                          className={`text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1.5 ${
                            player.isConnected
                              ? 'bg-slate-950 border-slate-800 text-slate-200'
                              : 'bg-rose-950/20 border-rose-900 text-rose-400 line-through'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              player.isConnected ? 'bg-emerald-400' : 'bg-rose-500'
                            }`}
                          />
                          <span className="font-bold">{player.nickname}</span>
                          {player.isHost && <span className="text-[10px]" title="Room Host">👑</span>}
                          <span className="text-[10px] font-mono text-emerald-400 font-semibold">
                            {player.score.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actions Tray */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                    <button
                      onClick={() => handleAdvancePhase(room.roomCode)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg transition-all"
                      title="Force advance countdown timer"
                    >
                      ⏩ Advance Phase
                    </button>
                    <button
                      onClick={() => handleTerminateRoom(room.roomCode)}
                      className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-black uppercase tracking-wider rounded-lg transition-all"
                      title="Terminate active room session"
                    >
                      🛑 Terminate Room
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
