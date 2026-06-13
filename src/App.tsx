import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Shield,
  Crown,
  MessageSquare,
  Send,
  User,
  Bot,
  Play,
  Check,
  Loader2,
  Volume2,
  VolumeX,
  Wifi,
  Settings,
  Info,
  LogOut,
  Zap,
  RefreshCw,
  Trophy,
  ArrowRight,
  Share2,
  Copy
} from 'lucide-react';
import { Card, Suit, GameState, Player, ChatMessage, ClientMessage, ServerMessage } from './types';

// Let's generate a cool default name
const ADJECTIVES = ['iOS', 'Apple', 'Spade', 'Siri', 'Swift', 'Apex', 'Pro', 'Neptune', 'Cosmic'];
const NOUNS = ['Ninja', 'Master', 'Ace', 'Dealer', 'Slinger', 'Player', 'VIP', 'Wizard'];
const getRandomName = () => {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const randNum = Math.floor(100 + Math.random() * 900);
  return `${adj}_${noun}_${randNum}`;
};

export default function App() {
  const [playerName, setPlayerName] = useState(() => {
    return localStorage.getItem('spades_player_name') || getRandomName();
  });
  const [roomIdInput, setRoomIdInput] = useState('');
  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  
  // Game state
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<string>('');
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showScoreHistory, setShowScoreHistory] = useState(false);
  const [lastPromptMsg, setLastPromptMsg] = useState<string | null>(null);
  const [cardsExpanded, setCardsExpanded] = useState(true);
  const [chatCollapsedMobile, setChatCollapsedMobile] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const cardsContainerRef = useRef<HTMLElement | null>(null);

  // Floating emoji reactions maps (seat index => emoji character)
  const [floatingEmojis, setFloatingEmojis] = useState<Record<number, { char: string; id: number }>>({});
  const emojiIdCounter = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Sync player name changes to localStorage
  useEffect(() => {
    localStorage.setItem('spades_player_name', playerName);
  }, [playerName]);

  // Connect websocket when entering a room or on initial mount for lobby state
  const connectToWebsocket = (targetRoomId?: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    setErrorMessage(null);
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      // Join room once connected
      const joinMsg: ClientMessage = {
        type: 'JOIN_ROOM',
        roomId: targetRoomId || undefined,
        name: playerName
      };
      socket.send(JSON.stringify(joinMsg));
    };

    socket.onmessage = (event) => {
      try {
        const serverMsg: ServerMessage = JSON.parse(event.data);
        
        if (serverMsg.type === 'ROOM_STATE' && serverMsg.state) {
          setGameState(serverMsg.state);
          setRoomId(serverMsg.state.roomId);
          setJoined(true);
          if (serverMsg.yourPlayerId) {
            setPlayerId(serverMsg.yourPlayerId);
          }
          // Push to Address Bar for convenient sharing and refreshing
          const newUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${serverMsg.state.roomId}`;
          if (window.location.search !== `?room=${serverMsg.state.roomId}`) {
            window.history.pushState({ path: newUrl }, '', newUrl);
          }
        } else if (serverMsg.type === 'CHAT_MESSAGE' && serverMsg.chat) {
          const chat = serverMsg.chat;
          // Check if it represents a floating emoji
          if (chat.text.startsWith('[EMOJI]:') && chat.seat !== -1) {
            const char = chat.text.replace('[EMOJI]:', '').trim();
            emojiIdCounter.current += 1;
            setFloatingEmojis(prev => ({
              ...prev,
              [chat.seat]: { char, id: emojiIdCounter.current }
            }));
            
            // Play reaction beep
            playTone(400, 0.1, 'sine');
          } else {
            setChatLog(prev => [...prev, chat].slice(-40));
            // Standard notification beep for dealer
            if (chat.senderName === 'Dealer') {
              playTone(280, 0.15, 'triangle');
            }
          }
        } else if (serverMsg.type === 'REJECT') {
          setErrorMessage(serverMsg.error || 'Connection rejected by host.');
          setJoined(false);
        }
      } catch (err) {
        console.error('Error handling server payload:', err);
      }
    };

    socket.onerror = (e) => {
      console.error('WS Error:', e);
      setErrorMessage('Server connection error. Please try again.');
    };

    socket.onclose = () => {
      setConnected(false);
    };
  };

  // Check URL parameters for direct room joining
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room') || params.get('code');
    if (roomParam) {
      const cleanParam = roomParam.trim().toUpperCase();
      setRoomIdInput(cleanParam);
      connectToWebsocket(cleanParam);
    }
  }, []);

  // Sound generator using Web Audio API for immersive mechanical sounds
  const playTone = (frequency: number, duration: number, type: 'sine' | 'square' | 'sawtooth' | 'triangle' = 'sine') => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
      // smooth fade out
      gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + duration);
    } catch (e) {
      // Ignored
    }
  };

  // Auto scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog]);

  // Handle playing card
  const playCard = (card: Card) => {
    if (!wsRef.current || !gameState) return;
    
    // Play local audio cue
    playTone(330, 0.1, 'triangle');
    
    wsRef.current.send(JSON.stringify({
      type: 'PLAY_CARD',
      card
    }));
  };

  // Submit Bid
  const submitBid = (bid: string) => {
    if (!wsRef.current) return;
    playTone(440, 0.15, 'sine');
    wsRef.current.send(JSON.stringify({
      type: 'SUBMIT_BID',
      bid
    }));
  };

  // Select Hukoom (Trump Suit)
  const selectHukoom = (suit: Suit) => {
    if (!wsRef.current) return;
    playTone(660, 0.1, 'sine');
    wsRef.current.send(JSON.stringify({
      type: 'SELECT_HUKOOM',
      hukoomSuit: suit
    }));
  };

  // Ready toggling
  const toggleReady = () => {
    if (!wsRef.current) return;
    playTone(520, 0.1, 'sine');
    wsRef.current.send(JSON.stringify({ type: 'TOGGLE_READY' }));
  };

  // Add Bots to populate
  const forceBots = () => {
    if (!wsRef.current) return;
    playTone(440, 0.12, 'square');
    wsRef.current.send(JSON.stringify({ type: 'FORCE_BOTS' }));
  };

  // Start game
  const startGame = () => {
    if (!wsRef.current) return;
    playTone(600, 0.25, 'sine');
    wsRef.current.send(JSON.stringify({ type: 'START_GAME' }));
  };

  // Send a custom chat message
  const sendChatMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || !wsRef.current) return;
    
    wsRef.current.send(JSON.stringify({
      type: 'SEND_CHAT',
      chatText: chatInput
    }));
    setChatInput('');
  };

  // Trigger floating emoji reaction
  const triggerEmojiReaction = (emoji: string) => {
    if (!wsRef.current) return;
    wsRef.current.send(JSON.stringify({
      type: 'SEND_CHAT',
      chatText: `[EMOJI]:${emoji}`
    }));
  };

  // Restart Round or Game
  const triggerRestart = () => {
    if (!wsRef.current) return;
    playTone(450, 0.2, 'sawtooth');
    wsRef.current.send(JSON.stringify({ type: 'RESTART_GAME' }));
  };

  // Leave Room
  const leaveRoom = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setJoined(false);
    setGameState(null);
    setRoomId(null);
    setChatLog([]);
    // Remove query parameter
    const cleanUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
    window.history.pushState({ path: cleanUrl }, '', cleanUrl);
  };

  const copyInviteLink = () => {
    if (!roomId) return;
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopiedLink(true);
      playTone(520, 0.1, 'sine');
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const copyRoomCode = () => {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId).then(() => {
      setCopiedCode(true);
      playTone(520, 0.1, 'sine');
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  // Keep connection alive with a simple ping every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'PING' }));
      }
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Determine user seat index
  // Each client connection identifies itself by checking which seat has ID matching the assigned playerId
  let mySeatIndex = 0;
  if (gameState) {
    let seatFoundIndex = gameState.players.findIndex(p => p && p.id === playerId);
    if (seatFoundIndex !== -1) {
      mySeatIndex = seatFoundIndex;
    } else {
      // fallback to name matching if playerId isn't fully synced yet
      seatFoundIndex = gameState.players.findIndex(p => p && !p.isBot && p.name === playerName);
      if (seatFoundIndex !== -1) {
        mySeatIndex = seatFoundIndex;
      }
    }
  }

  // Automatically open cards when our turn comes
  useEffect(() => {
    if (gameState && mySeatIndex !== -1 && (gameState.currentTurn === mySeatIndex || (gameState.phase === 'SELECTING_HUKOOM' && gameState.currentTurn === mySeatIndex))) {
      setCardsExpanded(true);
      setTimeout(() => {
        cardsContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 250);
    }
  }, [gameState?.currentTurn, gameState?.phase, mySeatIndex]);

  // Cards display helpers
  const getSuitSymbol = (s: Suit) => {
    switch (s) {
      case 'S': return '♠';
      case 'H': return '♥';
      case 'D': return '♦';
      case 'C': return '♣';
    }
  };

  const getSuitColor = (s: Suit) => {
    return (s === 'H' || s === 'D') ? 'text-red-500' : 'text-slate-900';
  };

  const getSuitBgColor = (s: Suit) => {
    return s === 'S' ? 'bg-[#1e1b4b]/10 hover:bg-[#1e1b4b]/20' : '';
  };

  // Find partner seat (userSeat + 2 % 4)
  const myPartnerSeat = (mySeatIndex + 2) % 4;

  // Render player rotation configuration
  // The bottom seat index is ALWAYS user seat index.
  // Left is (mySeatIndex + 1) % 4.
  // Top is (mySeatIndex + 2) % 4 (Our teammate!).
  // Right is (mySeatIndex + 3) % 4.
  const seatsOrder = [
    { label: 'Bottom (You)', index: mySeatIndex },
    { label: 'Left', index: (mySeatIndex + 1) % 4 },
    { label: 'Top (Teammate)', index: (mySeatIndex + 2) % 4 },
    { label: 'Right', index: (mySeatIndex + 3) % 4 }
  ];

  const getRelativePositionClass = (relIndex: number) => {
    // Return CSS placement class relative to standard layout wrapper
    // relIndex is absolute seat index (0-3) mapped to layout (0=bottom, 1=left, 2=top, 3=right)
    const orderInLayout = (relIndex - mySeatIndex + 4) % 4;
    switch (orderInLayout) {
      case 0: return 'absolute bottom-1 md:bottom-[-10px] left-1/2 -translate-x-1/2 z-30';
      case 1: return 'absolute left-1.5 md:left-[-45px] top-1/2 -translate-y-1/2 z-20';
      case 2: return 'absolute top-1 md:top-[-30px] left-1/2 -translate-x-1/2 z-20';
      case 3: return 'absolute right-1.5 md:right-[-45px] top-1/2 -translate-y-1/2 z-20';
    }
  };

  const getTrickCardPositionClass = (absolutePlayerSeat: number) => {
    const orderInLayout = (absolutePlayerSeat - mySeatIndex + 4) % 4;
    switch (orderInLayout) {
      case 0: // Bottom player's card
        return 'bottom-2 md:bottom-4 left-1/2 -translate-x-1/2 rotate-[-2deg] z-20 shadow-xl border-emerald-500 border-2 scale-105';
      case 1: // Left player's card
        return 'left-2 md:left-4 top-1/2 -translate-y-1/2 rotate-[-15deg] z-10 shadow-lg';
      case 2: // Top partner's card
        return 'top-2 md:top-4 left-1/2 -translate-x-1/2 rotate-[5deg] z-10 shadow-lg';
      case 3: // Right player's card
        return 'right-2 md:right-4 top-1/2 -translate-y-1/2 rotate-[12deg] z-10 shadow-lg';
    }
  };

  // Filter playable cards logic for user hand selection
  const isCardPlayable = (card: Card) => {
    if (!gameState || gameState.phase !== 'PLAYING' || gameState.currentTurn !== mySeatIndex) {
      return false;
    }
    const myHand = gameState.hands[mySeatIndex] || [];
    
    // If we're following a trick
    if (gameState.tricks.length > 0) {
      const leadingSuit = gameState.leadingSuit!;
      const hasLeading = myHand.some(c => c.suit === leadingSuit);
      if (hasLeading) {
        return card.suit === leadingSuit;
      }
      return true; // Can play anything (including trump) if we lack leading suit
    } else {
      // We are leading the trick
      const trump = gameState.highestBid === 'COAT' ? null : (gameState.hukoomSuit || 'S');
      if (trump) {
        const trumpBroken = gameState.hukoomBroken !== undefined ? gameState.hukoomBroken : gameState.spadesBroken;
        if (card.suit === trump && !trumpBroken) {
          // Can only lead trump if we have nothing else in hand
          const hasOther = myHand.some(c => c.suit !== trump);
          return !hasOther;
        }
      }
      return true;
    }
  };

  // Start Quick/Random Matchmaking
  const handleQuickMatch = () => {
    connectToWebsocket();
  };

  // Join Room by Code
  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = roomIdInput.trim().toUpperCase();
    if (cleanId) {
      connectToWebsocket(cleanId);
    }
  };

  return (
    <div id="spades-root" className="w-full min-h-screen bg-[#070b0e] text-white flex flex-col items-center justify-center p-0 md:p-4 font-sans select-none overflow-x-hidden relative">
      
      {/* Background Atmosphere Lights */}
      <div className="absolute inset-0 pointer-events-none opacity-20 overflow-hidden">
        <div className="absolute top-[-10%] left-[-15%] w-[60%] h-[60%] bg-emerald-600 rounded-full blur-[140px]"></div>
        <div className="absolute bottom-[-10%] right-[-15%] w-[60%] h-[60%] bg-blue-600 rounded-full blur-[140px]"></div>
      </div>

      {/* Main Glassmorphic Terminal Container */}
      <div className="w-full max-w-6xl bg-black/60 backdrop-blur-xl border border-white/10 rounded-none md:rounded-[36px] shadow-[0_24px_60px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col aspect-none md:aspect-[4/3] min-h-[100vh] md:min-h-[760px] relative z-10">
        
        {/* --- FRONT END LOBBY CHOOSE SCREEN --- */}
        {!joined ? (
          <div className="flex-1 flex flex-col md:flex-row items-center justify-center p-6 md:p-12 gap-8 relative">
            
            {/* Left Column: Splash Presentation */}
            <div className="flex-1 space-y-6 max-w-lg">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-full text-emerald-400 text-xs font-semibold tracking-wider uppercase">
                <Sparkles className="w-3.5 h-3.5" />
                iOS Immersive Design
              </div>
              <h1 className="text-4xl md:text-5xl font-serif font-black italic tracking-tight leading-none">
                iOS Coat <span className="text-emerald-400 not-italic">6-Ace</span>
              </h1>
              <p className="text-white/60 text-sm md:text-base leading-relaxed">
                Experience high-stakes Coat with 9-card dealt tables starting from number 6 to Ace. Match live, coordinate bids, and lead partners to reach 52 score victory!
              </p>

              {/* Live Rule quick outline */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
                <p className="text-xs font-bold text-white/40 uppercase tracking-widest flex items-center gap-2">
                  <Shield className="w-3 h-3 text-emerald-400" /> Key Mechanics
                </p>
                <ul className="text-xs space-y-1.5 text-white/80 list-disc list-inside">
                  <li>36-card deck: cards 6, 7, 8 to Ace (9 tricks available per round)</li>
                  <li>Bid starts at 5. Bidding team gets success added to their score.</li>
                  <li>Failed bid adds DOUBLE bid points to opposite team as a penalty!</li>
                  <li><strong>🔥 COAT</strong> bid: Contract to win all 9 tricks for instant 52pt victory!</li>
                </ul>
              </div>
            </div>

            {/* Right Column: Connection Setup Area */}
            <div className="w-full max-w-md bg-white/[0.03] border border-white/10 rounded-[32px] p-8 space-y-6 shadow-xl relative backdrop-blur-md">
              <div className="absolute top-[-10px] right-6 bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black text-[9px] uppercase tracking-widest px-3 py-1 rounded-full shadow-lg">
                Multiplayer Active
              </div>

              {/* Player profile edit */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-white/40 uppercase tracking-widest">Your Nickname</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-sm">👤</span>
                  <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-10 pr-4 text-white text-sm font-semibold focus:outline-none focus:border-emerald-500 focus:bg-white/10 transition-all placeholder:text-white/20"
                    placeholder="Enter nickname..."
                  />
                  <button 
                    onClick={() => { setPlayerName(getRandomName()); playTone(440, 0.08, 'sine'); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 bg-white/5 hover:bg-white/15 rounded-lg text-xs"
                    title="Generate Random Name"
                  >
                    🎲
                  </button>
                </div>
              </div>

              {/* Matchmaking trigger */}
              <div className="space-y-3 pt-2">
                <button
                  onClick={() => { handleQuickMatch(); playTone(540, 0.15, 'sine'); }}
                  className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-black text-sm uppercase tracking-wider rounded-2xl shadow-[0_10px_30px_rgba(16,185,129,0.3)] hover:shadow-[0_10px_35px_rgba(16,185,129,0.55)] transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <Zap className="w-4 h-4 fill-slate-950" />
                  Quick Match (Find Game)
                </button>
                
                <div className="flex items-center gap-3 my-4">
                  <hr className="flex-1 border-white/10" />
                  <span className="text-xs text-white/30 font-bold uppercase tracking-widest">or Join Custom Code</span>
                  <hr className="flex-1 border-white/10" />
                </div>

                {/* Custom room join code */}
                <form onSubmit={handleJoinByCode} className="flex gap-2">
                  <input
                    type="text"
                    value={roomIdInput}
                    onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-center text-sm font-mono tracking-widest uppercase focus:outline-none focus:border-emerald-500"
                    placeholder="ROOMX"
                    maxLength={10}
                  />
                  <button
                    type="submit"
                    className="px-5 bg-white/10 hover:bg-white/15 rounded-xl text-white font-bold text-xs uppercase tracking-wider transition-colors flex items-center gap-1.5"
                  >
                    Join <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>

              {errorMessage && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-400 text-center">
                  ⚠️ {errorMessage}
                </div>
              )}

              <div className="text-center text-xs text-white/30 italic">
                * Features automated fallback to intelligent bots to bypass queues.
              </div>
            </div>

          </div>
        ) : (
          
          /* --- ACTIVE ROOM CONTENT --- */
          <div className="flex-1 flex flex-col overflow-hidden relative">

            {/* Top Header Scoreboard */}
            <header className="relative z-20 flex flex-col md:flex-row items-center justify-between px-6 md:px-10 py-4 bg-black/50 border-b border-white/10 gap-4">
              
              {/* Scores Column */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-2">
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-emerald-400 font-extrabold">Team 1 (Seats 1 & 3)</p>
                    <p className="text-amber-500 text-lg font-mono font-bold leading-none mt-1">
                      {gameState ? gameState.scoreTeam1 : 0} <span className="text-xs text-white/30 font-semibold">/ 52</span>
                    </p>
                  </div>
                  {(gameState?.winnerTeam === 1) && <Trophy className="w-4 h-4 text-yellow-400 ml-1 fill-yellow-400 animate-bounce" />}
                </div>

                <div className="h-8 w-px bg-white/10"></div>

                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-2">
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-red-400 font-extrabold">Team 2 (Seats 2 & 4)</p>
                    <p className="text-sky-400 text-lg font-mono font-bold leading-none mt-1">
                      {gameState ? gameState.scoreTeam2 : 0} <span className="text-xs text-white/30 font-semibold">/ 52</span>
                    </p>
                  </div>
                  {(gameState?.winnerTeam === 2) && <Trophy className="w-4 h-4 text-yellow-400 ml-1 fill-yellow-400 animate-bounce" />}
                </div>
              </div>

              {/* Bid Focus Tracker */}
              <div className="flex flex-col items-center">
                <div className="text-[10px] text-white/50 uppercase tracking-[0.2em] mb-1 italic">Active Contract</div>
                <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 px-6 py-1 rounded-full text-xs font-black tracking-wider flex items-center gap-1.5">
                  <Crown className="w-3.5 h-3.5 fill-emerald-400/20" />
                  {gameState && gameState.highestBid 
                    ? `${gameState.highestBid === 'COAT' ? '🔥 COAT' : `${gameState.highestBid} TRICKS`} (${gameState.players[gameState.highestBidder!]?.name})`
                    : 'Uncontracted'}
                </div>
              </div>

              {/* Identity & Room metadata */}
              <div className="flex items-center gap-3">
                <button 
                  onClick={copyInviteLink}
                  className="text-right hidden md:block bg-white/5 hover:bg-emerald-500/10 border border-transparent hover:border-emerald-500/30 px-3 py-1 rounded-xl transition-all group"
                  title="Click to copy Direct Web Invite Link"
                >
                  <p className="text-[9px] text-white/40 group-hover:text-emerald-400 uppercase tracking-widest font-black transition-colors">
                    {copiedLink ? 'Copied Link!' : 'Room Code'}
                  </p>
                  <p className="text-sm font-mono font-bold text-white group-hover:text-orange-400 transition-colors flex items-center justify-end gap-1.5">
                    {roomId}
                    <Share2 className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100 transition-opacity" />
                  </p>
                </button>

                <div className="h-8 w-px bg-white/10 hidden md:block"></div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setSoundEnabled(!soundEnabled); playTone(500, 0.1, 'sine'); }}
                    className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white/60 hover:text-white"
                    title={soundEnabled ? 'Mute Sounds' : 'Unmute Sounds'}
                  >
                    {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-red-400" />}
                  </button>

                  <button
                    onClick={() => setShowScoreHistory(!showScoreHistory)}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs flex items-center gap-1 transition-colors text-white/80 hover:text-white"
                  >
                    Logs
                  </button>

                  <button
                    onClick={() => setRulesExpanded(!rulesExpanded)}
                    className="p-2 hover:bg-white/10 rounded-xl transition-colors text-white/60 hover:text-white"
                    title="Rules"
                  >
                    <Info className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => { leaveRoom(); playTone(300, 0.15, 'sawtooth'); }}
                    className="p-2 bg-red-950/40 hover:bg-red-900 border border-red-500/30 rounded-xl transition-colors text-red-400"
                    title="Exit Lobby"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </header>

            {/* Rules Modal Drawer overlay */}
            {rulesExpanded && (
              <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 z-50">
                <div className="bg-[#10141a] border border-white/20 rounded-[30px] p-6 max-w-lg w-full space-y-4">
                  <h3 className="text-xl font-serif italic font-bold">Rules & Mechanics (Coat 6-Ace)</h3>
                  <div className="text-sm text-white/80 space-y-3 leading-relaxed font-mono">
                    <p>• <strong>The Deck</strong> starts from number 6 upwards (6, 7, 8, 9, 10, J, Q, K, A). That maps to 9 cards per division, fully distributing 36 cards to 4 players.</p>
                    <p>• <strong>Partnerships</strong>: Seats 1 and 3 are Team 1 (your partner is seat 3 if you are in seat 1), Seats 2 and 4 are Team 2.</p>
                    <p>• <strong>Bidding</strong> starts from 5. If players pass, a redeal takes place. If a contract is set, that team must collect at least their bid Tricks.</p>
                    <p>• <strong>Points Scoring</strong>: Making the bid awards those exact points added to total. Failing the bid awards <strong>DOUBLE</strong> the bid value as points to the opposing team!</p>
                    <p>• <strong>COAT</strong>: A contract selecting all 9 tricks. Succeed and your team secures an immediate 52pt victory! Fail & the opposing team takes the 52 pt victory!</p>
                    <p>• <strong>Trump</strong>: Spades are always trump. Standard legal plays apply (must follow led suit, cannot lead spades unless spades are broken or no alternate cards exist).</p>
                  </div>
                  <button
                    onClick={() => { setRulesExpanded(false); playTone(450, 0.08, 'sine'); }}
                    className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all"
                  >
                    Close & Return to Table
                  </button>
                </div>
              </div>
            )}

            {/* Score History drawer */}
            {showScoreHistory && (
              <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-6 z-50">
                <div className="bg-[#10141a] border border-white/20 rounded-[30px] p-6 max-w-xl w-full max-h-[80%] flex flex-col space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-amber-500" /> Match Score History
                    </h3>
                    <button
                      onClick={() => setShowScoreHistory(false)}
                      className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-xs"
                    >
                      Close X
                    </button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto border border-white/10 rounded-xl bg-black/40">
                    <table className="w-full text-xs text-left font-mono">
                      <thead className="bg-white/5 text-white/50 border-b border-white/10">
                        <tr>
                          <th className="p-3">Round</th>
                          <th className="p-3">Bidder</th>
                          <th className="p-3">Bid</th>
                          <th className="p-3">Team 1 Tricks</th>
                          <th className="p-3">Team 2 Tricks</th>
                          <th className="p-3">Team 1 Score</th>
                          <th className="p-3">Team 2 Score</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {gameState && gameState.history.length > 0 ? (
                          gameState.history.map((h, i) => (
                            <tr key={i} className="hover:bg-white/[0.02]">
                              <td className="p-3 font-bold">#{h.round}</td>
                              <td className="p-3">{gameState.players[h.bidder]?.name || `Seat ${h.bidder + 1}`}</td>
                              <td className="p-3 font-semibold">{h.bid}</td>
                              <td className="p-3 text-emerald-400 font-bold">{h.team1Tricks}</td>
                              <td className="p-3 text-sky-400 font-bold">{h.team2Tricks}</td>
                              <td className="p-3 text-emerald-400">+{h.team1ScoreChange} ({h.accumulatedTeam1})</td>
                              <td className="p-3 text-sky-400">+{h.team2ScoreChange} ({h.accumulatedTeam2})</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-white/30 italic">No rounds completed yet. Play some tricks!</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-emerald-500/10 rounded-lg p-3 text-xs text-emerald-400 border border-emerald-500/20 text-center">
                    Objective: Win enough rounds to declare 52 score victory!
                  </div>
                </div>
              </div>
            )}

            {/* Main Center Playground layout section */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">

              {/* Game Table container (Left pane) */}
              <div className="flex-1 min-h-[380px] md:min-h-[460px] relative flex items-center justify-center p-4">

                {/* --- LOBBY WAITING SCREEN --- */}
                {gameState && gameState.phase === 'LOBBY' && (
                  <div className="absolute inset-x-4 inset-y-12 bg-black/75 backdrop-blur-sm z-40 rounded-[32px] border border-white/15 p-6 flex flex-col items-center justify-center text-center">
                    <Crown className="w-12 h-12 text-amber-500 fill-amber-500/20 mb-3 animate-pulse" />
                    <h2 className="text-2xl font-serif italic mb-1">Game Lobby Matchmaking</h2>
                    <p className="text-white/40 text-xs mb-6 uppercase tracking-widest">Awaiting partners (Need 4 seats filled)</p>

                    {/* Share & Invite Section */}
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-6 max-w-xl w-full flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="text-left w-full sm:w-auto">
                        <span className="text-[10px] text-emerald-400 font-extrabold uppercase tracking-widest leading-none">Invite Live Friends</span>
                        <div className="font-mono text-sm font-bold text-white tracking-widest mt-1">
                          Room Code: <span className="text-orange-400 font-extrabold select-all">{roomId}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto">
                        <button 
                          onClick={copyRoomCode}
                          className="flex-1 sm:flex-initial px-3.5 py-2.5 bg-white/10 hover:bg-white/15 border border-white/5 rounded-xl text-xs font-bold font-mono text-white/95 flex items-center justify-center gap-1.5 transition-all"
                          title="Copy Code"
                        >
                          {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-white/60" />}
                          {copiedCode ? 'Copied!' : 'Copy Code'}
                        </button>
                        <button 
                          onClick={copyInviteLink}
                          className="flex-1 sm:flex-initial px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/15 transition-all"
                          title="Copy direct invite link for friends to easily click and join"
                        >
                          {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                          {copiedLink ? 'Link Copied!' : 'Copy Invite Link'}
                        </button>
                      </div>
                    </div>
                    
                    {/* Seats checklist */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl w-full mb-8">
                      {gameState.players.map((p, index) => (
                        <div 
                          key={index} 
                          className={`border rounded-2xl p-4 flex flex-col items-center text-center transition-all ${
                            p 
                              ? p.id === playerId || (p.name === playerName && !p.isBot)
                                ? 'bg-emerald-500/10 border-emerald-500/40' 
                                : 'bg-white/5 border-white/10'
                              : 'bg-black/40 border-dashed border-white/10 p-5'
                          }`}
                        >
                          <span className="text-[10px] text-white/30 tracking-widest uppercase mb-1">Seat {index + 1}</span>
                          {p ? (
                            <>
                              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-gray-700 to-gray-800 flex items-center justify-center font-bold text-xs border border-white/20 mb-2">
                                {p.isBot ? '🤖' : '👤'}
                              </div>
                              <span className="text-xs font-bold truncate max-w-full text-white">{p.name}</span>
                              <span className={`text-[9px] mt-1.5 px-2 py-0.5 rounded-full ${p.isReady ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                                {p.isReady ? 'Ready' : 'Waiting'}
                              </span>
                            </>
                          ) : (
                            <>
                              <div className="w-8 h-8 rounded-full border border-dashed border-white/20 flex items-center justify-center mb-2 text-xs">
                                ⌛
                              </div>
                              <span className="text-xs text-white/30 italic">Empty ...</span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-3 justify-center">
                      {/* Active Player toggle ready */}
                      <button
                        onClick={toggleReady}
                        className={`px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-wide transition-all ${
                          gameState.players[mySeatIndex]?.isReady
                            ? 'bg-amber-500 text-slate-950 font-bold'
                            : 'bg-emerald-500 text-slate-950 font-bold shadow-lg shadow-emerald-500/20'
                        }`}
                      >
                        {gameState.players[mySeatIndex]?.isReady ? '🟡 Wait, Not Ready' : '🟢 I\'m Ready To Play!'}
                      </button>

                      {/* Fill empty seats with bots immediately inside lobby */}
                      <button
                        onClick={forceBots}
                        className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-xs uppercase font-extrabold text-white/80"
                      >
                        🤖 Fill with Bots
                      </button>

                      {/* Start Game force triggers */}
                      <button
                        onClick={startGame}
                        className="px-8 py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs uppercase tracking-widest rounded-2xl transition-all"
                      >
                        ⚡ Start Game Instantly
                      </button>
                    </div>
                  </div>
                )}

                {/* --- OVER-SCREEN BIDDING CHOICE SELECTOR --- */}
                {gameState && gameState.phase === 'BIDDING' && gameState.currentBidder === mySeatIndex && (
                  <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center z-45 p-6 animate-fade-in">
                    <div className="bg-[#161b22] border border-white/20 rounded-[40px] p-8 max-w-md w-full flex flex-col items-center shadow-2xl relative text-center">
                      <div className="absolute -top-6 bg-emerald-500 text-slate-950 font-black px-4 py-1 rounded-full text-[10px] uppercase tracking-widest shadow-md">
                        Your Turn to Bid
                      </div>

                      <h2 className="text-2xl font-serif italic mb-1 tracking-tight">Select Contract Bid</h2>
                      <p className="text-white/40 text-xs mb-6 uppercase tracking-widest">Objective: Reach 52 Score</p>
                      
                      <div className="grid grid-cols-2 gap-3 w-full mb-3">
                        {/* Minimum bid is 5 */}
                        {[5, 6, 7, 8].map((num) => {
                          const valStr = num.toString();
                          // Bids must exceed current highest bid if already set
                          let isSelectable = true;
                          if (gameState.highestBid !== null && gameState.highestBid !== 'COAT') {
                            isSelectable = num > (gameState.highestBid as number);
                          } else if (gameState.highestBid === 'COAT') {
                            isSelectable = false;
                          }

                          return (
                            <button
                              key={num}
                              disabled={!isSelectable}
                              onClick={() => { submitBid(valStr); }}
                              className={`rounded-2xl p-3 flex flex-col items-center justify-center border transition-all ${
                                isSelectable 
                                  ? 'bg-white/5 border-white/10 hover:bg-emerald-500 hover:text-slate-950 hover:border-emerald-500 cursor-pointer' 
                                  : 'bg-white/[0.01] border-white/5 text-white/20 cursor-not-allowed line-through'
                              }`}
                            >
                              <span className="text-xl font-black">{num}</span>
                              <span className="text-[8px] uppercase font-bold tracking-tight opacity-60">Tricks</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* COAT selection */}
                      <button
                        onClick={() => { submitBid('COAT'); }}
                        className="w-full mb-4 rounded-xl py-3.5 bg-gradient-to-r from-amber-500 to-orange-600 border border-amber-500/20 flex flex-col items-center justify-center text-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.2)] hover:shadow-[0_0_25px_rgba(245,158,11,0.4)] transition-all cursor-pointer font-bold duration-200 hover:scale-[1.02]"
                      >
                        <span className="text-xl font-black italic tracking-tighter flex items-center gap-1">
                          🔥 COAT BID
                        </span>
                        <span className="text-[9px] uppercase font-black tracking-widest opacity-80 mt-0.5">
                          Win all 9 tricks solo (No Trump)
                        </span>
                      </button>

                      {/* Pass choice */}
                      <button
                        onClick={() => { submitBid('PASS'); }}
                        className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white font-extrabold text-xs uppercase tracking-wider transition-colors"
                      >
                        Pass Turn
                      </button>

                      <p className="mt-5 text-[10px] text-white/30 italic">
                        * Under-bidding success deducts or defaults. Failure adds DOUBLE POINTS to opposite team.
                      </p>
                    </div>
                  </div>
                )}

                {/* --- OVER-SCREEN HUKOOM CHOICE SELECTOR --- */}
                {gameState && gameState.phase === 'SELECTING_HUKOOM' && gameState.currentTurn === mySeatIndex && (
                  <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center z-45 p-6 animate-fade-in">
                    <div className="bg-[#161b22] border border-white/20 rounded-[40px] p-8 max-w-sm w-full flex flex-col items-center shadow-2xl relative text-center">
                      <div className="absolute -top-6 bg-emerald-500 text-slate-950 font-black px-4 py-1 rounded-full text-[10px] uppercase tracking-widest shadow-md">
                        Your Hukoom Choice
                      </div>

                      <h2 className="text-2xl font-serif italic mb-1 tracking-tight">Select Hukoom (Trump)</h2>
                      <p className="text-white/40 text-xs mb-6 uppercase tracking-widest">Select Trump Suit for this round</p>
                      
                      <div className="grid grid-cols-2 gap-4 w-full">
                        {/* Spades */}
                        <button
                          onClick={() => selectHukoom('S')}
                          className="rounded-2xl p-5 bg-white/5 border border-white/10 hover:bg-slate-800 hover:border-emerald-500 text-white transition-all transform hover:scale-105 cursor-pointer flex flex-col items-center justify-center"
                        >
                          <span className="text-5xl leading-none select-none">♠</span>
                          <span className="text-xs uppercase font-extrabold tracking-wider mt-2">Spades</span>
                        </button>

                        {/* Hearts */}
                        <button
                          onClick={() => selectHukoom('H')}
                          className="rounded-2xl p-5 bg-white/5 border border-white/10 hover:bg-slate-800 hover:border-emerald-500 text-red-500 transition-all transform hover:scale-105 cursor-pointer flex flex-col items-center justify-center"
                        >
                          <span className="text-5xl leading-none select-none">♥</span>
                          <span className="text-xs uppercase font-extrabold tracking-wider mt-2">Hearts</span>
                        </button>

                        {/* Diamonds */}
                        <button
                          onClick={() => selectHukoom('D')}
                          className="rounded-2xl p-5 bg-white/5 border border-white/10 hover:bg-slate-800 hover:border-emerald-500 text-blue-400 transition-all transform hover:scale-105 cursor-pointer flex flex-col items-center justify-center"
                        >
                          <span className="text-5xl leading-none select-none">♦</span>
                          <span className="text-xs uppercase font-extrabold tracking-wider mt-2">Diamonds</span>
                        </button>

                        {/* Clubs */}
                        <button
                          onClick={() => selectHukoom('C')}
                          className="rounded-2xl p-5 bg-white/5 border border-white/10 hover:bg-slate-800 hover:border-emerald-500 text-emerald-400 transition-all transform hover:scale-105 cursor-pointer flex flex-col items-center justify-center"
                        >
                          <span className="text-5xl leading-none select-none">♣</span>
                          <span className="text-xs uppercase font-extrabold tracking-wider mt-2">Clubs</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* --- GAME OVER OR MATCH OVER SCREEN --- */}
                {gameState && gameState.phase === 'GAME_OVER' && (
                  <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-45 p-6 animate-fade-in">
                    <div className="bg-[#121822] border border-white/20 rounded-[40px] p-10 max-w-md w-full flex flex-col items-center shadow-2xl text-center">
                      <Trophy className="w-16 h-16 text-yellow-400 fill-yellow-400/20 mb-4 animate-bounce" />
                      <h2 className="text-3xl font-serif italic mb-1 text-yellow-400">Match Completed</h2>
                      <p className="text-white/50 text-xs uppercase tracking-widest mb-6">Objective Reached: 52 Points Match</p>
                      
                      <div className="bg-white/5 border border-white/15 rounded-2xl p-4 w-full mb-8">
                        <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold">Winning Team</p>
                        <p className="text-2xl font-extrabold text-emerald-400 mt-1">
                          Team {gameState.winnerTeam}
                        </p>
                        <p className="text-xs text-white/70 mt-2 font-mono">
                          Final Score: Team 1 [{gameState.scoreTeam1}] | Team 2 [{gameState.scoreTeam2}]
                        </p>
                      </div>

                      <button
                        onClick={triggerRestart}
                        className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-sm uppercase tracking-wider rounded-2xl shadow-lg transition-transform active:scale-[0.98]"
                      >
                        Play Again (Restart Game)
                      </button>
                    </div>
                  </div>
                )}

                {/* Round Over state but not Match Over */}
                {gameState && gameState.phase === 'ROUND_OVER' && (
                  <div className="absolute inset-0 bg-black/75 backdrop-blur-sm z-45 p-6 flex items-center justify-center animate-fade-in">
                    <div className="bg-[#161b22] border border-white/20 rounded-[40px] p-8 max-w-sm w-full flex flex-col items-center shadow-2xl text-center">
                      <Check className="w-12 h-12 text-emerald-400 mb-3" />
                      <h2 className="text-2xl font-serif italic mb-1">Round Completed</h2>
                      <p className="text-white/40 text-xs uppercase tracking-widest mb-4">Trick collections complete</p>

                      <div className="space-y-2 w-full text-sm font-mono mb-6">
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-emerald-400">Team 1 Score:</span>
                          <span className="font-bold">{gameState.scoreTeam1}</span>
                        </div>
                        <div className="flex justify-between border-b border-white/5 pb-1">
                          <span className="text-sky-400">Team 2 Score:</span>
                          <span className="font-bold">{gameState.scoreTeam2}</span>
                        </div>
                      </div>

                      <button
                        onClick={triggerRestart}
                        className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl shadow-lg transition-all"
                      >
                        Deal Next Hand
                      </button>
                    </div>
                  </div>
                )}

                {/* THE IMAGINATIVE CARD TABLE */}
                <div className="w-full max-w-[760px] aspect-[4/3] md:aspect-[16/9] min-h-[290px] sm:min-h-[340px] md:min-h-[400px] rounded-[48px] md:rounded-[180px] bg-[#14261f] border-[6px] md:border-[8px] border-[#20342c] shadow-[0_0_50px_rgba(0,0,0,0.7),inset_0_0_80px_rgba(0,0,0,0.6)] relative flex items-center justify-center">
                  
                  {/* Velvet Texture Overlay */}
                  <div className="absolute inset-0 opacity-10 pointer-events-none rounded-[48px] md:rounded-[180px]" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '8px 8px' }}></div>
                  <div className="absolute inset-1 border border-dashed border-white/10 rounded-[44px] md:rounded-[172px] pointer-events-none"></div>

                  {/* Player Avatars positioning (Seat indexes mapped relatively) */}
                  {gameState && gameState.players.map((p, absoluteSeatIndex) => {
                    if (!p) return null;
                    const positionClass = getRelativePositionClass(absoluteSeatIndex);
                    const isMyTurn = gameState.currentTurn === absoluteSeatIndex;
                    const isDealer = gameState.dealer === absoluteSeatIndex;
                    const bidsMade = gameState.bids[absoluteSeatIndex];

                    const isYou = absoluteSeatIndex === mySeatIndex;
                    const isPartner = absoluteSeatIndex === myPartnerSeat;

                    // Hand counts
                    const handSize = gameState.hands[absoluteSeatIndex]?.length || 0;

                    // Compute if player is packed (partner of COAT bidder)
                    const isPacked = gameState.highestBid === 'COAT' && gameState.highestBidder !== null && absoluteSeatIndex === (gameState.highestBidder + 2) % 4;

                    return (
                      <div key={absoluteSeatIndex} className={positionClass}>
                        <div className="flex flex-col items-center relative">
                          
                          {/* Floating Emoji Reaction Display Container */}
                          {floatingEmojis[absoluteSeatIndex] && (
                            <div key={floatingEmojis[absoluteSeatIndex].id} className="absolute -top-12 bg-white/95 text-slate-950 px-2.5 py-1 rounded-2xl shadow-2xl border border-white font-bold text-base z-50 animate-bounce">
                              {floatingEmojis[absoluteSeatIndex].char}
                              <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-white"></div>
                            </div>
                          )}

                          {/* Avatar round badge */}
                          <div className={`w-14 h-14 rounded-full p-0.5 transition-all ${
                            isPacked
                              ? 'border-2 border-rose-500/20 bg-slate-950/20 opacity-50 grayscale'
                              : isMyTurn 
                                ? 'border-2 border-emerald-500 bg-emerald-950/40 shadow-[0_0_15px_rgba(16,185,129,0.5)]' 
                                : 'border-2 border-white/20 bg-slate-900/60'
                          }`}>
                            <div className={`w-full h-full rounded-full flex items-center justify-center relative font-bold text-xs relative ${
                              isYou 
                                ? 'bg-gradient-to-tr from-indigo-500 to-emerald-500' 
                                : isPartner 
                                  ? 'bg-gradient-to-tr from-emerald-600 to-teal-600'
                                  : 'bg-gradient-to-tr from-rose-500 to-amber-500'
                            }`}>
                              {p.isBot ? '🤖' : '👤'}
                              
                              {/* Packed state padlock absolute over badge */}
                              {isPacked && (
                                <span className="absolute text-[11px] bottom-0 right-0" title="Packed teammate">🤐</span>
                              )}

                              {/* Dealer Badge overlay */}
                              {isDealer && !isPacked && (
                                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-amber-500 border border-slate-900 text-slate-950 font-black text-[9px] rounded-full flex items-center justify-center shadow" title="Dealer">
                                  D
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Profile Data labels */}
                          <div className="mt-1 bg-black/60 px-3 py-1 rounded-full border border-white/10 flex flex-col items-center text-center shadow max-w-[120px]">
                            <p className="text-[10px] font-bold truncate max-w-full text-white leading-none">
                              {p.name} {isYou ? '(You)' : ''}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {isPacked ? (
                                <span className="text-[8px] text-rose-400 font-extrabold uppercase tracking-wide">
                                  🤐 Packed
                                </span>
                              ) : (
                                <>
                                  {/* Hand count cards icon */}
                                  {gameState.phase === 'PLAYING' && (
                                    <span className="text-[8px] text-white/50 font-semibold font-mono">
                                      🃏 {handSize}
                                    </span>
                                  )}
                                  
                                  {/* Bid Status */}
                                  {bidsMade && (
                                    <span className="text-[8px] text-yellow-400 font-extrabold uppercase">
                                      Bid:{bidsMade}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {/* Active processing light */}
                          {isMyTurn && !isPacked && (
                            <p className="text-[8px] text-emerald-400 font-bold tracking-widest mt-0.5 animate-pulse uppercase">
                              Thinking...
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* TRICK CENTER: VISUAL PLAYED CARDS DEPOT */}
                  <div className="relative w-36 h-36 md:w-56 md:h-56 rounded-full bg-black/20 border border-white/5 flex items-center justify-center">
                    
                    {gameState && gameState.tricks.map((play, i) => {
                      const posClass = getTrickCardPositionClass(play.playerIndex);
                      
                      return (
                        <div 
                          key={i} 
                          className={`absolute w-12 h-18 md:w-18 md:h-26 bg-white rounded-lg md:rounded-xl shadow-2xl flex flex-col justify-between p-1.5 md:p-2 text-slate-950 transition-all transform animate-pop-in ${posClass}`}
                        >
                          {/* Corner Mini design */}
                          <div className="flex justify-between items-center leading-none">
                            <span className="text-xs md:text-sm font-black font-mono leading-none">{play.card.value}</span>
                            <span className={`text-xs md:text-base leading-none ${getSuitColor(play.card.suit)}`}>
                              {getSuitSymbol(play.card.suit)}
                            </span>
                          </div>

                          {/* Giant center suit icon */}
                          <div className={`text-center text-lg md:text-2xl leading-none font-sans flex items-center justify-center my-0.5 md:my-1 ${getSuitColor(play.card.suit)}`}>
                            {getSuitSymbol(play.card.suit)}
                          </div>

                          {/* Bottom corner mirror */}
                          <div className="flex justify-between items-center leading-none rotate-180">
                            <span className="text-xs md:text-sm font-black font-mono leading-none">{play.card.value}</span>
                            <span className={`text-xs md:text-base leading-none ${getSuitColor(play.card.suit)}`}>
                              {getSuitSymbol(play.card.suit)}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {/* Leading suit pointer display inside center */}
                    {gameState && gameState.leadingSuit && (
                      <div className="absolute bg-[#1c3a2f]/80 border border-white/10 rounded-full px-2 py-0.5 md:px-3 md:py-1 text-[8px] md:text-[10px] text-white/80 font-bold uppercase tracking-wide flex items-center gap-1 z-30">
                        <span>Led:</span>
                        <span className={getSuitColor(gameState.leadingSuit)}>
                          {getSuitSymbol(gameState.leadingSuit)}{' '}
                          {gameState.leadingSuit === (gameState.hukoomSuit || 'S') ? ' (Hukoom/Trump)' : ''}
                        </span>
                      </div>
                    )}

                    {/* Default centered branding if no tricks being played */}
                    {(!gameState || gameState.tricks.length === 0) && (
                      <div className="flex flex-col items-center justify-center text-center pointer-events-none select-none">
                        <span className="text-xl font-bold font-serif italic text-white/30">Coat</span>
                        <span className="text-[8px] uppercase tracking-widest text-white/35 mt-1">Goal: 52 Points</span>
                        {gameState && gameState.hukoomSuit && (
                          <div className="mt-2 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full text-[9px] text-emerald-400 font-extrabold uppercase tracking-widest">
                            Hukoom: {getSuitSymbol(gameState.hukoomSuit)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                </div>

              </div>

              {/* Connected Chats & Game logs pane (Right pane / mobile expandable drawer) */}
              <div className={`w-full lg:w-72 bg-black/40 border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col overflow-hidden relative transition-all duration-300 ${
                chatCollapsedMobile ? 'h-12 lg:h-auto' : 'h-64 sm:h-72 lg:h-auto'
              }`}>
                
                <div 
                  onClick={() => {
                    setChatCollapsedMobile(!chatCollapsedMobile);
                    playTone(480, 0.08, 'sine');
                  }}
                  className="p-3 bg-white/5 border-b border-white/10 flex items-center justify-between cursor-pointer lg:cursor-default select-none"
                >
                  <span className="text-xs font-bold text-white/60 tracking-wider uppercase flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" /> Room Messages & Actions
                  </span>
                  
                  {/* Status lights indicator with mobile indicators */}
                  <div className="flex items-center gap-2">
                    <span className="lg:hidden text-[9px] font-black uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-full">
                      {chatCollapsedMobile ? 'Show 💬' : 'Hide 🙈'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                      <span className="text-[10px] text-emerald-400 font-extrabold uppercase select-none">Multiplayer</span>
                    </div>
                  </div>
                </div>

                {/* Quick Emoji Reaction Launcher */}
                <div className="px-3 py-2 bg-white/[0.02] border-b border-white/5 flex justify-between gap-1">
                  {['😂', '👍', '🔥', '🤔', '👑', '🤬', '🃏'].map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => triggerEmojiReaction(emoji)}
                      className="flex-1 py-1 hover:bg-white/10 rounded-lg text-sm transition-colors cursor-pointer"
                      title={`Send ${emoji} reaction`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>

                {/* Chat and Dealer LOGS feed */}
                <div className="flex-1 p-3 overflow-y-auto space-y-2 font-mono scrollbar-thin">
                  {chatLog.map((chat) => (
                    <div 
                      key={chat.id} 
                      className={`text-[11px] leading-relaxed rounded-lg p-2 ${
                        chat.seat === -1 
                          ? 'bg-amber-500/5 text-amber-300 border-l-2 border-amber-500' 
                          : chat.seat === mySeatIndex
                            ? 'bg-emerald-500/5 border-l-2 border-emerald-500 text-emerald-300'
                            : 'bg-white/5 border-l-2 border-white/20 text-white/80'
                      }`}
                    >
                      <span className="font-extrabold text-[10px] uppercase opacity-70">
                        {chat.senderName}:
                      </span>{' '}
                      {chat.text}
                    </div>
                  ))}
                  <div ref={chatEndRef}></div>
                </div>

                {/* Message Send Form */}
                <form onSubmit={sendChatMessage} className="p-2 bg-black/60 border-t border-white/10 flex gap-1">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Send phrase..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    className="p-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl transition-transform active:scale-95"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>

              </div>

            </div>

            {/* Bottom active Hand tray sector (Displays player's 9 cards) */}
            <footer ref={cardsContainerRef as any} className="relative bg-black/70 border-t border-white/10 py-4 px-6 flex flex-col items-center">
              
              <div className="w-full flex flex-wrap justify-between items-center mb-3 gap-2">
                <span className="text-[10px] uppercase tracking-widest text-white/50 font-bold flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-emerald-400" />
                  {gameState && gameState.currentTurn === mySeatIndex 
                    ? 'Your Turn! Select card to play.'
                    : 'Awaiting other plays...'}
                </span>

                {/* VIEW BUTTON to toggle hand display as requested */}
                <button
                  id="view-hand-toggle-btn"
                  onClick={() => {
                    setCardsExpanded(!cardsExpanded);
                    playTone(450, 0.08, 'sine');
                  }}
                  className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest transition-all ${
                    cardsExpanded 
                      ? 'bg-amber-500/15 border border-amber-500/40 text-amber-400 hover:bg-amber-500/25' 
                      : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/20'
                  }`}
                >
                  {cardsExpanded ? 'Hide Hand 🙈' : 'View Hand 🎴'}
                </button>

                <div className="flex gap-2">
                  <div className="bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 px-3 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider">
                    Our Target tricks won: {gameState ? (mySeatIndex === 0 || mySeatIndex === 2 ? gameState.team1TricksWon : gameState.team2TricksWon) : 0}
                  </div>
                  <div className="bg-white/5 border border-white/15 text-white/50 px-3 py-0.5 rounded-full text-[9px] font-mono">
                    Cards: {gameState ? gameState.hands[mySeatIndex]?.length : 0} / 9
                  </div>
                </div>
              </div>

              {/* Fanned cards wrapper - toggled by cardsExpanded */}
              <div className={`transition-all duration-300 w-full flex items-center justify-center p-2 relative ${
                cardsExpanded ? 'max-h-[350px] opacity-100 min-h-[170px] overflow-visible' : 'max-h-0 opacity-0 min-h-0 overflow-hidden'
              }`}>
                
                {gameState && gameState.highestBid === 'COAT' && gameState.highestBidder !== null && mySeatIndex === (gameState.highestBidder + 2) % 4 ? (
                  <div className="flex flex-col items-center justify-center text-center p-8 bg-red-500/5 border border-red-500/20 rounded-3xl max-w-md shadow-inner animate-fade-in my-2">
                    <span className="text-3xl mb-1.5 select-none animate-bounce">🤐</span>
                    <h3 className="text-sm font-serif italic text-red-400">You are Packed!</h3>
                    <p className="text-[11px] text-white/60 mt-1.5 leading-relaxed">
                      Your teammate <strong>{gameState.players[gameState.highestBidder!].name}</strong> has called a <strong>COAT</strong>! You are packed for this round while they must conquer all 9 tricks solo. Sit back and cheer them on!
                    </p>
                  </div>
                ) : gameState && gameState.hands[mySeatIndex] && gameState.hands[mySeatIndex].length > 0 ? (
                  <div className="flex flex-wrap items-center justify-center -space-x-5 xs:-space-x-6 sm:-space-x-8 md:-space-x-10 max-w-full px-2 overflow-visible">
                    {gameState.hands[mySeatIndex].map((card, i) => {
                      const playable = isCardPlayable(card);
                      const symbol = getSuitSymbol(card.suit);
                      const suitColor = getSuitColor(card.suit);

                      return (
                        <button
                          key={i}
                          disabled={!playable}
                          onClick={() => {
                            playCard(card);
                          }}
                          className={`w-[66px] xs:w-[76px] sm:w-[96px] md:w-28 h-[100px] xs:h-[114px] sm:h-[144px] md:h-40 bg-white rounded-xl md:rounded-2xl flex flex-col justify-between p-1.5 sm:p-3 border-2 transition-all transform shadow-md sm:shadow-lg hover:shadow-2xl hover:scale-110 cursor-pointer ${
                            playable 
                              ? 'border-emerald-500 hover:-translate-y-8 z-10 translate-y-0 scale-100 opacity-100 hover:z-30 cursor-pointer' 
                              : 'border-slate-300 opacity-80 translate-y-0.5 cursor-not-allowed text-slate-800'
                          }`}
                          style={{
                            // Create elegant fan curvature based on card layout count
                            transform: `rotate(${(i - (gameState.hands[mySeatIndex].length - 1) / 2) * 3}deg)`
                          }}
                        >
                          {/* Top-left corners */}
                          <div className="flex justify-between items-center leading-none w-full">
                            <span className="text-xs xs:text-sm sm:text-base md:text-xl font-black font-mono leading-none text-slate-950">{card.value}</span>
                            <span className={`text-xs xs:text-sm sm:text-base md:text-xl leading-none ${suitColor}`}>{symbol}</span>
                          </div>

                          {/* Giant center visual detail */}
                          <div className="text-center font-bold">
                            <span className={`text-xl xs:text-2xl sm:text-3xl md:text-4xl leading-none select-none ${suitColor}`}>
                              {symbol}
                            </span>
                            
                            {/* Minor indication if card is Trump */}
                            {gameState && card.suit === (gameState.hukoomSuit || 'S') && (
                              <div className="text-[5px] xs:text-[6px] sm:text-[7px] md:text-[8px] text-indigo-800 font-extrabold uppercase mt-0.5 sm:mt-1 tracking-wider">
                                TRUMP
                              </div>
                            )}
                          </div>

                          {/* Bottom-right mirror */}
                          <div className="flex justify-between items-center leading-none rotate-180 w-full">
                            <span className="text-xs xs:text-sm sm:text-base md:text-xl font-black font-mono leading-none text-slate-950">{card.value}</span>
                            <span className={`text-xs xs:text-sm sm:text-base md:text-xl leading-none ${suitColor}`}>{symbol}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-white/30 text-xs italic p-10 text-center">
                    {gameState && gameState.phase === 'BIDDING' 
                      ? 'Waiting for bidding round to conclude to reveal cards...'
                      : 'No hand dealt yet. Start the match!'}
                  </div>
                )}

              </div>

            </footer>

          </div>
        )}

      </div>

      {/* Embedded style tweaks for specific CSS anims */}
      <style>{`
        @keyframes pop-in {
          0% { transform: scale(0.8) translateY(10px); opacity: 0; }
          100% { transform: scale(1.0) translateY(0); opacity: 1; }
        }
        .animate-pop-in {
          animation: pop-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

    </div>
  );
}
