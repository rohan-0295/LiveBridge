// src/DoctorConnect.jsx
// WebRTC peer-to-peer video call between victim and doctor.
// Uses the Socket.IO server as a signalling channel (room keyed by emergency_id).
// Works on both the victim side (App.jsx Step 3) and the hospital/doctor side.

import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Phone, Loader } from 'lucide-react';

const T = {
  bg0: '#080808', bg1: '#111111', bg2: '#1a1a1a',
  border: '#242424', text1: '#e8e8e8', text2: '#888888', text3: '#444444',
  red: '#ef4444', redDim: '#7f1d1d',
  green: '#22c55e', greenDim: '#166534',
  blue: '#3b82f6', blueDim: '#1e3a5f',
  font: "'Syne', sans-serif",
  body: "'DM Sans', sans-serif",
};

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// ── Props ──────────────────────────────────────────────────────────────────
// emergencyId  — used as the WebRTC room id
// role         — 'victim' | 'doctor'
// onClose      — called when user hangs up
export default function DoctorConnect({ emergencyId, role = 'victim', onClose }) {
  const [callState,   setCallState]   = useState('idle');   // idle | connecting | connected | ended
  const [videoOn,     setVideoOn]     = useState(true);
  const [micOn,       setMicOn]       = useState(true);
  const [statusMsg,   setStatusMsg]   = useState('');

  const socketRef    = useRef(null);
  const pcRef        = useRef(null);   // RTCPeerConnection
  const localStream  = useRef(null);
  const localVideo   = useRef(null);
  const remoteVideo  = useRef(null);

  const roomId = `emergency_${emergencyId}`;

  // ── Clean up everything ────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    localStream.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
    socketRef.current?.emit('webrtc_leave', { room_id: roomId });
    socketRef.current?.disconnect();
    pcRef.current   = null;
    localStream.current = null;
  }, [roomId]);

  // ── Hang up ────────────────────────────────────────────────────────────
  const hangUp = useCallback(() => {
    cleanup();
    setCallState('ended');
    onClose?.();
  }, [cleanup, onClose]);

  // ── Start call ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!emergencyId) return;

    let isMounted = true;

    async function start() {
      setCallState('connecting');
      setStatusMsg('Requesting camera & mic...');

      // 1. Get local media
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        setStatusMsg('Camera / mic permission denied.');
        setCallState('idle');
        return;
      }
      if (!isMounted) { stream.getTracks().forEach(t => t.stop()); return; }
      localStream.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;

      // 2. Connect socket
      const socket = io('http://localhost:8000');
      socketRef.current = socket;

      // 3. Create PeerConnection
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      // Add local tracks
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // When we get remote tracks → show in remote video
      pc.ontrack = (e) => {
        if (remoteVideo.current && e.streams[0]) {
          remoteVideo.current.srcObject = e.streams[0];
          setCallState('connected');
          setStatusMsg('');
        }
      };

      // ICE candidates → send via socket
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('webrtc_ice_candidate', { room_id: roomId, candidate: e.candidate });
        }
      };

      pc.onconnectionstatechange = () => {
        if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
          if (isMounted) hangUp();
        }
      };

      // 4. Join room
      socket.emit('webrtc_join', { room_id: roomId, role });
      setStatusMsg('Waiting for ' + (role === 'victim' ? 'doctor' : 'patient') + '...');

      // ── Signalling ──────────────────────────────────────────────────
      socket.on('webrtc_peer_joined', async () => {
        // First peer to see the other creates the offer
        if (role === 'victim') {
          setStatusMsg('Doctor connected. Starting call...');
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc_offer', { room_id: roomId, sdp: offer });
        }
      });

      socket.on('webrtc_offer', async ({ sdp }) => {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc_answer', { room_id: roomId, sdp: answer });
      });

      socket.on('webrtc_answer', async ({ sdp }) => {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      });

      socket.on('webrtc_ice_candidate', async ({ candidate }) => {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      });

      socket.on('webrtc_peer_left', () => {
        if (isMounted) {
          setStatusMsg('Call ended by the other party.');
          setTimeout(hangUp, 2000);
        }
      });
    }

    start();

    return () => {
      isMounted = false;
      cleanup();
    };
  }, [emergencyId]); // eslint-disable-line

  // ── Toggle video ───────────────────────────────────────────────────────
  function toggleVideo() {
    localStream.current?.getVideoTracks().forEach(t => { t.enabled = !videoOn; });
    setVideoOn(v => !v);
  }

  function toggleMic() {
    localStream.current?.getAudioTracks().forEach(t => { t.enabled = !micOn; });
    setMicOn(m => !m);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,.92)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: T.body,
    }}>
      {/* Remote video — full background */}
      <video
        ref={remoteVideo}
        autoPlay playsInline
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          opacity: callState === 'connected' ? 1 : 0,
          transition: 'opacity .5s',
        }}
      />

      {/* Status overlay */}
      {callState !== 'connected' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 16,
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: T.blueDim, border: `2px solid ${T.blue}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {callState === 'connecting'
              ? <Loader size={32} color={T.blue} style={{ animation: 'lb-spin 1s linear infinite' }} />
              : <Phone size={32} color={T.blue} />
            }
          </div>
          <p style={{ fontFamily: T.font, fontWeight: 700, fontSize: 16, color: T.text1, margin: 0 }}>
            {callState === 'ended' ? 'Call Ended' : 'Connecting to Doctor'}
          </p>
          {statusMsg && (
            <p style={{ fontSize: 12, color: T.text2, margin: 0 }}>{statusMsg}</p>
          )}
        </div>
      )}

      {/* Local video PiP */}
      <video
        ref={localVideo}
        autoPlay playsInline muted
        style={{
          position: 'absolute', bottom: 100, right: 20,
          width: 100, height: 140,
          borderRadius: 12, objectFit: 'cover',
          border: `2px solid ${T.border}`,
          background: T.bg1,
          opacity: videoOn ? 1 : 0.3,
        }}
      />

      {/* Controls */}
      <div style={{
        position: 'absolute', bottom: 32,
        display: 'flex', gap: 16, alignItems: 'center',
      }}>
        {/* Toggle mic */}
        <button onClick={toggleMic} style={{
          width: 52, height: 52, borderRadius: '50%',
          background: micOn ? T.bg2 : T.redDim,
          border: `1px solid ${micOn ? T.border : T.red}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: micOn ? T.text2 : T.red,
        }}>
          {micOn ? <Mic size={20} /> : <MicOff size={20} />}
        </button>

        {/* Hang up */}
        <button onClick={hangUp} style={{
          width: 64, height: 64, borderRadius: '50%',
          background: T.red, border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: '#fff',
          boxShadow: '0 0 20px rgba(239,68,68,.4)',
        }}>
          <PhoneOff size={26} />
        </button>

        {/* Toggle video */}
        <button onClick={toggleVideo} style={{
          width: 52, height: 52, borderRadius: '50%',
          background: videoOn ? T.bg2 : T.redDim,
          border: `1px solid ${videoOn ? T.border : T.red}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: videoOn ? T.text2 : T.red,
        }}>
          {videoOn ? <Video size={20} /> : <VideoOff size={20} />}
        </button>
      </div>

      {/* Room info badge */}
      <div style={{
        position: 'absolute', top: 20, left: 20,
        background: 'rgba(0,0,0,.6)', border: `1px solid ${T.border}`,
        borderRadius: 8, padding: '6px 12px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: callState === 'connected' ? T.green : T.amber, display: 'inline-block' }} />
        <span style={{ fontSize: 11, color: T.text2, fontFamily: T.font, fontWeight: 700 }}>
          SOS #{emergencyId} · {role === 'victim' ? 'PATIENT' : 'DOCTOR'}
        </span>
      </div>
    </div>
  );
}
