import type { Socket } from 'socket.io';
import type { AdminRoomSummary, ClientToServerEvents, ServerToClientEvents } from '../types/game';
import { isSecretValid, getClientIp, type AuthLockout } from './security';

export interface AdminContext {
  adminSecret: string;
  lockout: AuthLockout;
  hasRoom: (code: string) => boolean;
  getSummaries: () => AdminRoomSummary[];
  terminateRoom: (code: string) => void;
  advanceRoom: (code: string) => void;
}

/** Admin dashboard events. Everything except admin:auth requires membership of the admin room. */
export function registerAdminHandlers(
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
  ctx: AdminContext
) {
  // Admin authentication
  socket.on('admin:auth', (data, callback) => {
    try {
      const clientIp = getClientIp(socket);
      const remainingSec = ctx.lockout.lockedSeconds(clientIp);
      if (remainingSec > 0) {
        callback?.({ ok: false, error: `Too many failed attempts. Locked out for ${remainingSec}s.` });
        return;
      }

      const secret = typeof data?.secret === 'string' ? data.secret.trim() : '';
      const ok = isSecretValid(secret, ctx.adminSecret);
      console.log(`[admin:auth] ip=${clientIp} socket=${socket.id} attempt=${ok ? 'SUCCESS' : 'FAILED'}`);
      if (ok) {
        ctx.lockout.clear(clientIp);
        socket.join('admin:dashboard');
        callback?.({ ok: true });
        socket.emit('admin:sync:rooms', ctx.getSummaries());
      } else {
        ctx.lockout.fail(clientIp);
        callback?.({ ok: false, error: 'Invalid admin credentials' });
      }
    } catch (err) {
      console.error('[admin:auth error]', err);
      callback?.({ ok: false, error: 'Admin authentication error' });
    }
  });

  // Admin list active rooms (enforces authenticated admin session)
  socket.on('admin:rooms:list', (callback) => {
    try {
      if (!socket.rooms.has('admin:dashboard')) {
        callback?.([]);
        return;
      }
      callback?.(ctx.getSummaries());
    } catch {
      callback?.([]);
    }
  });

  // Admin terminate game room (enforces authenticated admin session)
  socket.on('admin:room:terminate', (data, callback) => {
    try {
      if (!socket.rooms.has('admin:dashboard')) {
        callback?.({ ok: false });
        return;
      }
      const roomCode = typeof data?.roomCode === 'string' ? data.roomCode.toUpperCase().trim() : '';
      if (!roomCode || !ctx.hasRoom(roomCode)) {
        callback?.({ ok: false });
        return;
      }
        ctx.terminateRoom(roomCode);
      callback?.({ ok: true });
    } catch (err) {
      console.error('[admin:room:terminate error]', err);
      callback?.({ ok: false });
    }
  });

  // Admin force advance phase (enforces authenticated admin session)
  socket.on('admin:room:advance', (data, callback) => {
    try {
      if (!socket.rooms.has('admin:dashboard')) {
        callback?.({ ok: false });
        return;
      }
      const roomCode = typeof data?.roomCode === 'string' ? data.roomCode.toUpperCase().trim() : '';
      if (!roomCode || !ctx.hasRoom(roomCode)) {
        callback?.({ ok: false });
        return;
      }
      ctx.advanceRoom(roomCode);
      callback?.({ ok: true });
    } catch (err) {
      console.error('[admin:room:advance error]', err);
      callback?.({ ok: false });
    }
  });
}
