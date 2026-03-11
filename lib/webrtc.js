/**
 * lib/webrtc.js — Decentralized WebRTC calling over Nostr
 *
 * Signaling is done via NIP-44 encrypted DMs — no backend server needed.
 * ICE candidates are bundled into the SDP (Vanilla ICE) for relay efficiency.
 *
 * Nostr event kinds used:
 *   21000 = call-offer      { type:'call-offer',  sdp, callId, video }
 *   21001 = call-answer     { type:'call-answer', sdp, callId }
 *   21003 = call-hangup     { type:'call-hangup', callId }
 *
 * Usage:
 *   import { createCallSession, subscribeIncomingCalls } from '@/lib/webrtc';
 *
 *   // Outgoing
 *   const call = createCallSession({ myPrivkeyHex, myPubkeyHex, peerPubkeyHex, video: false });
 *   call.onStateChange  = (s) => ...   // 'ringing'|'connecting'|'active'|'ended'|'failed'
 *   call.onRemoteStream = (stream) => ...
 *   call.onError        = (msg) => ...
 *   await call.startOutgoing();
 *
 *   // Incoming (after user taps Accept)
 *   await call.acceptIncoming(offerPayload);
 *
 *   // Controls
 *   call.setMicMuted(true);
 *   call.setCamOff(true);
 *   call.hangup();
 */

import { finalizeEvent } from 'nostr-tools';
import { hexToBytes } from './identity';
import {
  encryptDM, decryptDM,
  publishEvent,
  subscribe,
  getOpenRelays, connectRelays,
} from './nostr';

// ─── Public STUN servers (no auth, no cost) ──────────────────────────────────

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomCallId() {
  return Math.random().toString(36).slice(2, 12);
}

const KIND_MAP = {
  'call-offer':  21000,
  'call-answer': 21001,
  'call-hangup': 21003,
};

function buildSignalEvent(payload, myPrivkeyHex, peerPubkeyHex) {
  const kind = KIND_MAP[payload.type];
  if (!kind) throw new Error('Unknown call signal type: ' + payload.type);
  return finalizeEvent({
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', peerPubkeyHex]],
    content: encryptDM(JSON.stringify(payload), myPrivkeyHex, peerPubkeyHex),
  }, hexToBytes(myPrivkeyHex));
}

// ─── createCallSession ────────────────────────────────────────────────────────

export function createCallSession({
  myPrivkeyHex,
  myPubkeyHex,
  peerPubkeyHex,
  video = false,
}) {
  let pc          = null;
  let localStream = null;
  let callId      = null;
  let state       = 'idle';
  let unsubSignal = null;
  let hangupSent  = false;
  let iceResolveFn = null;

  const session = {
    onStateChange:  null,  // (state: string) => void
    onRemoteStream: null,  // (MediaStream) => void
    onError:        null,  // (message: string) => void
    callId:      () => callId,
    localStream: () => localStream,
    isVideo:     () => video,
    getState:    () => state,
  };

  // ── state helpers ──
  function setState(s) {
    if (state === s) return;
    state = s;
    session.onStateChange?.(s);
  }

  function fail(reason) {
    console.error('[webrtc]', reason);
    session.onError?.(reason);
    setState('failed');
    cleanup();
  }

  function cleanup() {
    unsubSignal?.();
    unsubSignal = null;
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  }

  // ── publish a signal over Nostr ──
  async function sendSignal(payload) {
    if (getOpenRelays().size === 0) await connectRelays();
    try {
      const ev = buildSignalEvent(payload, myPrivkeyHex, peerPubkeyHex);
      await publishEvent(ev);
    } catch (e) {
      console.warn('[webrtc] sendSignal failed', e);
    }
  }

  // ── subscribe for signals from peer ──
  async function subscribeSignals(onSignal) {
    if (getOpenRelays().size === 0) await connectRelays();
    const since = Math.floor(Date.now() / 1000) - 5;
    unsubSignal = subscribe(
      [{ kinds: [21000, 21001, 21003], authors: [peerPubkeyHex], '#p': [myPubkeyHex], since }],
      ev => {
        try {
          const payload = JSON.parse(decryptDM(ev.content, myPrivkeyHex, peerPubkeyHex));
          onSignal(payload, ev);
        } catch {}
      }
    );
  }

  // ── build RTCPeerConnection ──
  function buildPC() {
    const p = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });

    if (localStream) localStream.getTracks().forEach(t => p.addTrack(t, localStream));

    const rs = new MediaStream();
    p.ontrack = e => {
      (e.streams[0]?.getTracks() ?? [e.track]).forEach(t => rs.addTrack(t));
      session.onRemoteStream?.(rs);
    };

    p.onconnectionstatechange = () => {
      const cs = p.connectionState;
      if (cs === 'connected')    setState('active');
      if (cs === 'failed')       fail('WebRTC connection failed. Peers may be behind strict NAT.');
      if (cs === 'disconnected') setState('connecting');
      if (cs === 'closed')       { if (state !== 'ended') setState('ended'); cleanup(); }
    };

    p.onicegatheringstatechange = () => {
      if (p.iceGatheringState === 'complete') iceResolveFn?.();
    };

    return p;
  }

  // ── wait for ICE gathering, max 4 s ──
  function waitForIce() {
    return new Promise(resolve => {
      iceResolveFn = resolve;
      // If already complete (unlikely but possible in LAN), resolve immediately
      if (pc?.iceGatheringState === 'complete') resolve();
      setTimeout(resolve, 4000);
    });
  }

  // ─────────────────────── OUTGOING CALL ───────────────────────────────────────

  session.startOutgoing = async () => {
    callId = randomCallId();
    setState('ringing');

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    } catch {
      return fail('Microphone' + (video ? '/camera' : '') + ' permission denied.');
    }

    pc = buildPC();

    await subscribeSignals(async (payload) => {
      if (payload.callId !== callId) return;
      if (payload.type === 'call-answer') {
        try {
          await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
          setState('connecting');
        } catch (e) { fail('Bad answer SDP: ' + e.message); }
      }
      if (payload.type === 'call-hangup') { setState('ended'); cleanup(); }
    });

    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: video });
      await pc.setLocalDescription(offer);
      await waitForIce();
      await sendSignal({ type: 'call-offer', callId, sdp: pc.localDescription.sdp, video });
    } catch (e) { fail('Failed to create offer: ' + e.message); }
  };

  // ─────────────────────── INCOMING CALL ───────────────────────────────────────

  session.acceptIncoming = async (offerPayload) => {
    callId = offerPayload.callId;
    video  = offerPayload.video ?? false;
    setState('connecting');

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    } catch {
      return fail('Microphone' + (video ? '/camera' : '') + ' permission denied.');
    }

    pc = buildPC();

    await subscribeSignals(async (payload) => {
      if (payload.callId !== callId) return;
      if (payload.type === 'call-hangup') { setState('ended'); cleanup(); }
    });

    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offerPayload.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIce();
      await sendSignal({ type: 'call-answer', callId, sdp: pc.localDescription.sdp });
    } catch (e) { fail('Failed to create answer: ' + e.message); }
  };

  // ─────────────────────── CONTROLS ────────────────────────────────────────────

  session.hangup = async () => {
    if (hangupSent) return;
    hangupSent = true;
    if (callId) await sendSignal({ type: 'call-hangup', callId });
    setState('ended');
    cleanup();
  };

  session.setMicMuted = (muted) => {
    localStream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
  };

  session.setCamOff = (off) => {
    localStream?.getVideoTracks().forEach(t => { t.enabled = !off; });
  };

  return session;
}

// ─── subscribeIncomingCalls ────────────────────────────────────────────────────

/**
 * Listen for incoming call-offer events addressed to myPubkeyHex.
 * onIncoming(offerPayload, fromPubkeyHex) fires for each new offer.
 * Returns cleanup function.
 */
export function subscribeIncomingCalls(myPubkeyHex, myPrivkeyHex, onIncoming) {
  const since = Math.floor(Date.now() / 1000) - 10;
  return subscribe(
    [{ kinds: [21000], '#p': [myPubkeyHex], since }],
    ev => {
      try {
        const payload = JSON.parse(decryptDM(ev.content, myPrivkeyHex, ev.pubkey));
        if (payload.type === 'call-offer') onIncoming(payload, ev.pubkey);
      } catch {}
    }
  );
}
