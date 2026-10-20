import type { SidePatternType, StimulusIntensityLevel } from './config.ts';

export type DisplayConnectionStatus = 'connected' | 'lagging' | 'disconnected';

export interface SideDisplayPresence {
  status: DisplayConnectionStatus;
  latencyMs: number | null;
  transport: 'webrtc' | 'websocket' | 'broadcast' | 'none';
  count: number;
}

export interface NetworkTelemetry {
  relayConnected: boolean;
  roomId: string;
  lanUrls: string[];
  appUrl: string | null;
  left: SideDisplayPresence;
  right: SideDisplayPresence;
}

export interface SynchronizedStimulusPayload {
  leftActive: boolean;
  rightActive: boolean;
  leftPattern: SidePatternType;
  rightPattern: SidePatternType;
  leftIntensity: StimulusIntensityLevel;
  rightIntensity: StimulusIntensityLevel;
  leftColor: string;
  rightColor: string;
  symbolLabel: string;
  eventId: number;
  authoritativeTimeMs: number;
}

/**
 * Low-latency side-display synchronization manager.
 * Uses WebRTC DataChannels (when P2P handshake completes) backed by a lightweight
 * local WebSocket relay (/ws-distract) and BroadcastChannel fallback.
 */
export class SideDisplayNetworkManager {
  private role: 'main' | 'left' | 'right';
  private roomId: string;
  private ws: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private peers = new Map<'left' | 'right' | 'main', RTCPeerConnection>();
  private dataChannels = new Map<'left' | 'right' | 'main', RTCDataChannel>();

  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private lastRttMs = 4;
  private disposed = false;

  private telemetry: NetworkTelemetry = {
    relayConnected: false,
    roomId: 'exhibition',
    lanUrls: [],
    appUrl: null,
    left: { status: 'disconnected', latencyMs: null, transport: 'none', count: 0 },
    right: { status: 'disconnected', latencyMs: null, transport: 'none', count: 0 },
  };

  private onStimulusCallback?: (payload: SynchronizedStimulusPayload) => void;
  private onTelemetryCallback?: (telemetry: NetworkTelemetry) => void;

  constructor(
    role: 'main' | 'left' | 'right' = 'main',
    roomId = 'exhibition',
    onStimulus?: (payload: SynchronizedStimulusPayload) => void,
    onTelemetry?: (telemetry: NetworkTelemetry) => void,
  ) {
    this.role = role;
    this.roomId = roomId;
    this.telemetry.roomId = roomId;
    this.onStimulusCallback = onStimulus;
    this.onTelemetryCallback = onTelemetry;

    if (typeof window !== 'undefined') {
      if ('BroadcastChannel' in window) {
        try {
          this.broadcastChannel = new BroadcastChannel('distract_side_display');
          this.broadcastChannel.onmessage = (ev) => {
            if (ev.data?.type === 'stimulus:update' && ev.data.stimulus) {
              this.onStimulusCallback?.(ev.data.stimulus);
            } else if (
              ev.data?.type === 'companion:heartbeat' &&
              this.role === 'main'
            ) {
              const side = ev.data.side as 'left' | 'right';
              if (
                side === 'left' &&
                this.telemetry.left.status === 'disconnected'
              ) {
                this.telemetry.left = {
                  status: 'connected',
                  latencyMs: 1,
                  transport: 'broadcast',
                  count: 1,
                };
                this.emitTelemetry();
              } else if (
                side === 'right' &&
                this.telemetry.right.status === 'disconnected'
              ) {
                this.telemetry.right = {
                  status: 'connected',
                  latencyMs: 1,
                  transport: 'broadcast',
                  count: 1,
                };
                this.emitTelemetry();
              }
            }
          };
        } catch {
          this.broadcastChannel = null;
        }
      }

      this.fetchNetworkInfo();
      this.connectWebSocket();
    }
  }

  private async fetchNetworkInfo() {
    try {
      const res = await fetch('/api/network-info');
      if (res.ok) {
        const data = await res.json();
        this.telemetry.lanUrls = Array.isArray(data.lanUrls) ? data.lanUrls : [];
        this.telemetry.appUrl = data.appUrl || null;
        this.emitTelemetry();
      }
    } catch {
      // Offline or static server fallback
    }
  }

  public setRoomId(roomId: string): void {
    const clean = roomId.trim() || 'exhibition';
    if (clean === this.roomId) return;
    this.roomId = clean;
    this.telemetry.roomId = clean;
    this.reconnect();
  }

  public reconnect(): void {
    if (this.reconnectTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closePeers();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.connectWebSocket();
  }

  private connectWebSocket(): void {
    if (this.disposed || typeof window === 'undefined') return;

    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws-distract`;
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        if (this.disposed) return;
        this.telemetry.relayConnected = true;
        socket.send(
          JSON.stringify({
            type: 'join',
            role: this.role,
            roomId: this.roomId,
          }),
        );
        this.emitTelemetry();

        if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: 'ping',
                clientSentMs: performance.now(),
                lastRttMs: this.lastRttMs,
              }),
            );
          }
          // Also broadcast companion heartbeat on BroadcastChannel for same-browser tabs
          if (this.role === 'left' || this.role === 'right') {
            this.broadcastChannel?.postMessage({
              type: 'companion:heartbeat',
              side: this.role,
              timestamp: Date.now(),
            });
          }
        }, 2000);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.type === 'pong' && typeof msg.clientSentMs === 'number') {
            this.lastRttMs = Math.max(
              1,
              Math.round(performance.now() - msg.clientSentMs),
            );
          } else if (msg.type === 'state:sync' || msg.type === 'stimulus:update') {
            if (msg.stimulus) {
              this.onStimulusCallback?.(msg.stimulus);
            }
          } else if (msg.type === 'presence:update') {
            const leftOpenDc =
              this.dataChannels.get('left')?.readyState === 'open';
            const rightOpenDc =
              this.dataChannels.get('right')?.readyState === 'open';

            this.telemetry.left = {
              status: msg.left.status,
              latencyMs: msg.left.latencyMs,
              transport:
                msg.left.status === 'disconnected'
                  ? 'none'
                  : leftOpenDc
                  ? 'webrtc'
                  : 'websocket',
              count: msg.left.count,
            };
            this.telemetry.right = {
              status: msg.right.status,
              latencyMs: msg.right.latencyMs,
              transport:
                msg.right.status === 'disconnected'
                  ? 'none'
                  : rightOpenDc
                  ? 'webrtc'
                  : 'websocket',
              count: msg.right.count,
            };

            // Initiate WebRTC DataChannel from main to newly connected side displays
            if (this.role === 'main') {
              if (
                msg.left.status !== 'disconnected' &&
                !this.peers.has('left')
              ) {
                this.initiateWebRtcPeer('left');
              }
              if (
                msg.right.status !== 'disconnected' &&
                !this.peers.has('right')
              ) {
                this.initiateWebRtcPeer('right');
              }
            }
            this.emitTelemetry();
          } else if (msg.type === 'webrtc:signal') {
            this.handleWebRtcSignal(msg.fromRole, msg.payload);
          }
        } catch {
          // Ignore invalid JSON
        }
      };

      socket.onclose = () => {
        this.telemetry.relayConnected = false;
        this.emitTelemetry();
        if (!this.disposed && typeof window !== 'undefined') {
          this.reconnectTimer = window.setTimeout(
            () => this.connectWebSocket(),
            2500,
          );
        }
      };

      socket.onerror = () => {
        this.telemetry.relayConnected = false;
      };
    } catch {
      this.telemetry.relayConnected = false;
      this.emitTelemetry();
    }
  }

  private initiateWebRtcPeer(targetSide: 'left' | 'right'): void {
    if (typeof RTCPeerConnection === 'undefined') return;
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      this.peers.set(targetSide, pc);

      const dc = pc.createDataChannel('distract-p2p', { ordered: false });
      this.setupDataChannel(targetSide, dc);

      pc.onicecandidate = (ev) => {
        if (ev.candidate && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: 'webrtc:signal',
              targetRole: targetSide,
              payload: { candidate: ev.candidate },
            }),
          );
        }
      };

      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          if (this.ws?.readyState === WebSocket.OPEN && pc.localDescription) {
            this.ws.send(
              JSON.stringify({
                type: 'webrtc:signal',
                targetRole: targetSide,
                payload: { sdp: pc.localDescription },
              }),
            );
          }
        })
        .catch(() => {});
    } catch {
      // WebRTC blocked or unsupported
    }
  }

  private async handleWebRtcSignal(
    fromRole: 'main' | 'left' | 'right',
    payload: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit },
  ) {
    if (typeof RTCPeerConnection === 'undefined') return;
    try {
      let pc = this.peers.get(fromRole);
      if (!pc) {
        pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        this.peers.set(fromRole, pc);

        pc.ondatachannel = (ev) => {
          this.setupDataChannel(fromRole, ev.channel);
        };

        pc.onicecandidate = (ev) => {
          if (ev.candidate && this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(
              JSON.stringify({
                type: 'webrtc:signal',
                targetRole: fromRole,
                payload: { candidate: ev.candidate },
              }),
            );
          }
        };
      }

      if (payload.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        if (payload.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (this.ws?.readyState === WebSocket.OPEN && pc.localDescription) {
            this.ws.send(
              JSON.stringify({
                type: 'webrtc:signal',
                targetRole: fromRole,
                payload: { sdp: pc.localDescription },
              }),
            );
          }
        }
      } else if (payload.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      }
    } catch {
      // Fallback to WebSocket relay automatically
    }
  }

  private setupDataChannel(
    peerRole: 'main' | 'left' | 'right',
    dc: RTCDataChannel,
  ): void {
    this.dataChannels.set(peerRole, dc);
    dc.onopen = () => {
      if (peerRole === 'left') {
        this.telemetry.left.transport = 'webrtc';
      } else if (peerRole === 'right') {
        this.telemetry.right.transport = 'webrtc';
      }
      this.emitTelemetry();
    };
    dc.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === 'stimulus:update' && msg.stimulus) {
          this.onStimulusCallback?.(msg.stimulus);
        }
      } catch {}
    };
  }

  public broadcastStimulus(stimulus: SynchronizedStimulusPayload): void {
    const packet = JSON.stringify({
      type: 'stimulus:update',
      stimulus,
    });

    // 1. Send over open WebRTC DataChannels first (lowest latency)
    for (const dc of this.dataChannels.values()) {
      if (dc.readyState === 'open') {
        try {
          dc.send(packet);
        } catch {}
      }
    }

    // 2. Send over local WebSocket relay so any device on LAN/Phone receives it & state is saved
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(packet);
      } catch {}
    }

    // 3. Send over BroadcastChannel for same-browser tabs
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: 'stimulus:update',
          stimulus,
        });
      } catch {}
    }
  }

  public getTelemetry(): NetworkTelemetry {
    return this.telemetry;
  }

  private emitTelemetry(): void {
    this.onTelemetryCallback?.({
      ...this.telemetry,
      left: { ...this.telemetry.left },
      right: { ...this.telemetry.right },
    });
  }

  private closePeers(): void {
    for (const dc of this.dataChannels.values()) {
      try {
        dc.close();
      } catch {}
    }
    this.dataChannels.clear();
    for (const pc of this.peers.values()) {
      try {
        pc.close();
      } catch {}
    }
    this.peers.clear();
  }

  public dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.reconnectTimer);
    }
    if (this.pingTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.pingTimer);
    }
    this.closePeers();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {}
    }
  }
}
