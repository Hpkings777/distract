import express from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import os from 'os';
import path from 'path';

const PORT = 3000;

interface ClientMeta {
  ws: WebSocket;
  role: 'main' | 'left' | 'right';
  roomId: string;
  latencyMs: number;
  lastSeenMs: number;
}

interface RoomState {
  roomId: string;
  stimulus: {
    leftActive: boolean;
    rightActive: boolean;
    leftPattern: string;
    rightPattern: string;
    leftIntensity: number;
    rightIntensity: number;
    leftColor: string;
    rightColor: string;
    symbolLabel: string;
    eventId: number;
    authoritativeTimeMs: number;
  };
}

const rooms = new Map<string, RoomState>();
const clients = new Set<ClientMeta>();

function getOrCreateRoom(roomId: string): RoomState {
  let r = rooms.get(roomId);
  if (!r) {
    r = {
      roomId,
      stimulus: {
        leftActive: false,
        rightActive: false,
        leftPattern: 'chevron',
        rightPattern: 'rings',
        leftIntensity: 0.8,
        rightIntensity: 0.8,
        leftColor: '#f59e0b',
        rightColor: '#06b6d4',
        symbolLabel: 'STANDBY',
        eventId: 0,
        authoritativeTimeMs: Date.now(),
      },
    };
    rooms.set(roomId, r);
  }
  return r;
}

function getLanAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const results: string[] = [];
  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(`http://${net.address}:${PORT}`);
      }
    }
  }
  return results;
}

function broadcastRoomPresence(roomId: string) {
  const roomClients = Array.from(clients).filter((c) => c.roomId === roomId);
  const now = Date.now();

  const leftClients = roomClients.filter((c) => c.role === 'left');
  const rightClients = roomClients.filter((c) => c.role === 'right');

  const computeStatus = (list: ClientMeta[]) => {
    if (list.length === 0) {
      return { status: 'disconnected', latencyMs: null, count: 0 };
    }
    const best = list[0];
    const age = now - best.lastSeenMs;
    const isLagging = best.latencyMs > 180 || age > 6000;
    return {
      status: isLagging ? 'lagging' : 'connected',
      latencyMs: best.latencyMs,
      count: list.length,
    };
  };

  const payload = JSON.stringify({
    type: 'presence:update',
    roomId,
    serverTimeMs: now,
    left: computeStatus(leftClients),
    right: computeStatus(rightClients),
  });

  for (const c of roomClients) {
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(payload);
    }
  }
}

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);

  // API endpoint returning detected LAN IP addresses & server clock for QR / multi-device setup
  app.get('/api/network-info', (_req, res) => {
    res.json({
      lanUrls: getLanAddresses(),
      appUrl: process.env.APP_URL || null,
      serverTimeMs: Date.now(),
    });
  });

  // Attach WebSocket server on /ws-distract
  const wss = new WebSocketServer({ server: httpServer, path: '/ws-distract' });

  wss.on('connection', (ws) => {
    const meta: ClientMeta = {
      ws,
      role: 'main',
      roomId: 'exhibition',
      latencyMs: 4,
      lastSeenMs: Date.now(),
    };
    clients.add(meta);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        meta.lastSeenMs = Date.now();

        if (msg.type === 'join') {
          meta.role =
            msg.role === 'left' || msg.role === 'right' ? msg.role : 'main';
          meta.roomId = String(msg.roomId || 'exhibition').slice(0, 40);
          const room = getOrCreateRoom(meta.roomId);

          // Send initial authoritative state sync
          ws.send(
            JSON.stringify({
              type: 'state:sync',
              roomId: meta.roomId,
              serverTimeMs: Date.now(),
              stimulus: room.stimulus,
            }),
          );
          broadcastRoomPresence(meta.roomId);
        } else if (msg.type === 'ping') {
          if (typeof msg.lastRttMs === 'number') {
            meta.latencyMs = Math.max(1, Math.round(msg.lastRttMs));
          }
          ws.send(
            JSON.stringify({
              type: 'pong',
              clientSentMs: msg.clientSentMs,
              serverTimeMs: Date.now(),
            }),
          );
          broadcastRoomPresence(meta.roomId);
        } else if (msg.type === 'stimulus:update') {
          const room = getOrCreateRoom(meta.roomId);
          room.stimulus = {
            ...room.stimulus,
            ...msg.stimulus,
            authoritativeTimeMs: Date.now(),
          };

          const broadcastMsg = JSON.stringify({
            type: 'stimulus:update',
            roomId: meta.roomId,
            serverTimeMs: Date.now(),
            stimulus: room.stimulus,
          });

          for (const c of clients) {
            if (
              c.roomId === meta.roomId &&
              c !== meta &&
              c.ws.readyState === WebSocket.OPEN
            ) {
              c.ws.send(broadcastMsg);
            }
          }
        } else if (
          msg.type === 'webrtc:signal' &&
          msg.targetRole &&
          msg.payload
        ) {
          // Relay WebRTC signaling messages between main simulator and side displays
          const signalMsg = JSON.stringify({
            type: 'webrtc:signal',
            fromRole: meta.role,
            targetRole: msg.targetRole,
            payload: msg.payload,
          });
          for (const c of clients) {
            if (
              c.roomId === meta.roomId &&
              c.role === msg.targetRole &&
              c.ws.readyState === WebSocket.OPEN
            ) {
              c.ws.send(signalMsg);
            }
          }
        }
      } catch {
        // Ignore malformed packets
      }
    });

    ws.on('close', () => {
      clients.delete(meta);
      broadcastRoomPresence(meta.roomId);
    });

    ws.on('error', () => {
      clients.delete(meta);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`DISTRACT Simulator Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
