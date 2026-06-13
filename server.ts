import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  Card,
  CardValue,
  Suit,
  Player,
  GameState,
  RoundScores,
  GamePhase,
  ClientMessage,
  ServerMessage,
  ChatMessage
} from './src/types.js';

// Resolve directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const app = express();
const server = http.createServer(app);

// Keep reference to Vite instance in development to let HMR WebSocket connections through
let viteInstance: any = null;

// Simple WS handling on the same server
const wss = new WebSocketServer({ noServer: true });

// Store active WebSockets mapped to playerId
const clients = new Map<string, { ws: WebSocket; playerId: string; roomId: string | null }>();

// All active rooms in memory
const rooms = new Map<string, GameState>();

// Chat message histories
const roomChats = new Map<string, ChatMessage[]>();

/**
 * Generate an elegant Spades 6-Ace deck
 * Cards range from 6 to Ace (6, 7, 8, 9, 10, J, Q, K, A)
 * 9 cards per suit, 4 suits, total 36 cards
 */
function createDeck(): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const values: { value: CardValue; rank: number }[] = [
    { value: '6', rank: 6 },
    { value: '7', rank: 7 },
    { value: '8', rank: 8 },
    { value: '9', rank: 9 },
    { value: '10', rank: 10 },
    { value: 'J', rank: 11 },
    { value: 'Q', rank: 12 },
    { value: 'K', rank: 13 },
    { value: 'A', rank: 14 }
  ];

  const deck: Card[] = [];
  for (const s of suits) {
    for (const v of values) {
      deck.push({
        suit: s,
        value: v.value,
        rank: v.rank
      });
    }
  }
  return deck;
}

/**
 * Shuffle cards using Fisher-Yates algorithm
 */
function shuffle(deck: Card[]): Card[] {
  const cards = [...deck];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/**
 * Find or create an empty lobby or join an existing active room
 */
function getOrCreateRoom(preferredRoomId?: string): GameState {
  if (preferredRoomId && rooms.has(preferredRoomId)) {
    return rooms.get(preferredRoomId)!;
  }

  const roomId = preferredRoomId || `coat_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  
  if (rooms.has(roomId)) {
    return rooms.get(roomId)!;
  }

  const newRoom: GameState = {
    roomId,
    phase: 'LOBBY',
    players: [null, null, null, null],
    dealer: 0,
    currentBidder: 0,
    highestBid: null,
    highestBidder: null,
    bids: [null, null, null, null],
    hands: [[], [], [], []],
    currentTurn: 0,
    tricks: [],
    leadingSuit: null,
    spadesBroken: false,
    hukoomSuit: null,
    hukoomBroken: false,
    team1TricksWon: 0,
    team2TricksWon: 0,
    scoreTeam1: 0,
    scoreTeam2: 0,
    winnerTeam: null,
    history: [],
    lastTrickWinner: null
  };

  rooms.set(roomId, newRoom);
  roomChats.set(roomId, []);
  return newRoom;
}

/**
 * Broadcast room state to all players connected in that room
 */
function broadcastState(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const [pId, clientMeta] of clients.entries()) {
    if (clientMeta.roomId === roomId && clientMeta.ws.readyState === WebSocket.OPEN) {
      const msg: ServerMessage = {
        type: 'ROOM_STATE',
        state: room,
        yourPlayerId: pId
      };
      clientMeta.ws.send(JSON.stringify(msg));
    }
  }
}

/**
 * Broadcast custom chat messages or emoji reaction
 */
function broadcastMessage(roomId: string, message: ServerMessage) {
  const payload = JSON.stringify(message);

  for (const [_, clientMeta] of clients.entries()) {
    if (clientMeta.roomId === roomId && clientMeta.ws.readyState === WebSocket.OPEN) {
      clientMeta.ws.send(payload);
    }
  }
}

/**
 * Generate bot names
 */
const BOT_NAMES = ['AstroBot', 'CardMasterPro', 'Siri_Coat', 'DeepSpade', 'DeltaCards', 'AlphaBid', 'GigaTricks'];

function getRandomBotName(): string {
  return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
}

/**
 * Adds bot players to any unoccupied seats in the room
 */
function fillRoomWithBots(room: GameState) {
  for (let i = 0; i < 4; i++) {
    if (!room.players[i]) {
      const existingNames = room.players.filter(p => p !== null).map(p => p!.name);
      let name = getRandomBotName();
      while (existingNames.includes(name)) {
        name = getRandomBotName();
      }

      room.players[i] = {
        id: `bot_${Math.random().toString(36).substring(2, 9)}`,
        name,
        isBot: true,
        seat: i,
        isReady: true
      };
    }
  }
}

/**
 * Deal standard 6-Ace cards (9 each) to 4 players
 */
function dealCards(room: GameState) {
  const deck = shuffle(createDeck());
  
  // Sort hands by suit and then rank for good UI visibility
  const sortHand = (hand: Card[]) => {
    const suitOrder: Record<Suit, number> = { 'S': 4, 'H': 3, 'C': 2, 'D': 1 };
    return hand.sort((a, b) => {
      if (a.suit !== b.suit) {
        return suitOrder[b.suit] - suitOrder[a.suit];
      }
      return b.rank - a.rank;
    });
  };

  room.hands[0] = sortHand(deck.slice(0, 9));
  room.hands[1] = sortHand(deck.slice(9, 18));
  room.hands[2] = sortHand(deck.slice(18, 27));
  room.hands[3] = sortHand(deck.slice(27, 36));

  room.spadesBroken = false;
  room.hukoomSuit = null;
  room.hukoomBroken = false;
  room.leadingSuit = null;
  room.tricks = [];
  room.team1TricksWon = 0;
  room.team2TricksWon = 0;
}

/**
 * Determines the next dealer (shuffler) based on which team has fewer points
 */
function advanceDealer(room: GameState) {
  let nextDealer = (room.dealer + 1) % 4;
  if (room.scoreTeam1 !== room.scoreTeam2) {
    if (room.scoreTeam1 < room.scoreTeam2) {
      // Team 1 is less in points, so shuffler/dealer must belong to Team 1 (Seat 0 or 2)
      if (nextDealer !== 0 && nextDealer !== 2) {
        nextDealer = (nextDealer + 1) % 4;
      }
    } else {
      // Team 2 is less in points, so shuffler/dealer must belong to Team 2 (Seat 1 or 3)
      if (nextDealer !== 1 && nextDealer !== 3) {
        nextDealer = (nextDealer + 1) % 4;
      }
    }
  }
  room.dealer = nextDealer;
}

/**
 * Helper to check if a player is packed standard rule
 */
function isPlayerPacked(room: GameState, seat: number): boolean {
  if (room.highestBid === 'COAT' && room.highestBidder !== null) {
    const partnerSeat = (room.highestBidder + 2) % 4;
    return seat === partnerSeat;
  }
  return false;
}

/**
 * Helper to calculate the next active player, skipping the packed teammate
 */
function getNextTurn(room: GameState, currentTurn: number): number {
  let next = (currentTurn + 1) % 4;
  while (isPlayerPacked(room, next)) {
    next = (next + 1) % 4;
  }
  return next;
}

/**
 * Starts a new bidding round
 */
function startNewRound(room: GameState) {
  room.phase = 'BIDDING';
  room.highestBid = null;
  room.highestBidder = null;
  room.bids = [null, null, null, null];
  room.tricks = [];
  room.leadingSuit = null;

  // Bidding starts next to serving player
  room.currentBidder = (room.dealer + 1) % 4;
  dealCards(room);
  
  broadcastState(room.roomId);

  // Trigger bot action if a bot is current bidder
  triggerBotBiddingIfActive(room);
}

/**
 * Handle a submitted bid
 */
function handleBidSubmit(room: GameState, seat: number, bidStr: string) {
  if (room.phase !== 'BIDDING' || room.currentBidder !== seat) {
    return;
  }

  // Record user bid
  room.bids[seat] = bidStr;

  // Check bidding constraints
  if (bidStr !== 'PASS') {
    let bidValue: number | 'COAT' = 0;
    if (bidStr === 'COAT') {
      bidValue = 'COAT';
    } else {
      bidValue = parseInt(bidStr, 10);
    }

    // Check if new bid is valid
    let isHighestValue = false;
    if (room.highestBid === null) {
      isHighestValue = true;
    } else if (room.highestBid === 'COAT') {
      isHighestValue = false; // Nothing is higher than COAT
    } else if (bidValue === 'COAT') {
      isHighestValue = true; // COAT is higher than everything
    } else {
      // If highestBid is numeric, the new numeric bid must be strictly greater
      let curHighestNum = typeof room.highestBid === 'number' ? room.highestBid : 0;
      if (bidValue > curHighestNum) {
        isHighestValue = true;
      }
    }

    if (isHighestValue) {
      room.highestBid = bidValue;
      room.highestBidder = seat;
    } else {
      // If tried to submit an equal or lower bid, turn it into a PASS to maintain flow safely
      bidStr = 'PASS';
      room.bids[seat] = 'PASS';
    }
  }

  // System broadcast text
  const bidderName = room.players[seat]?.name || `Player ${seat + 1}`;
  pushSystemChatMessage(room.roomId, `${bidderName} bid ${bidStr === 'COAT' ? '🔥 COAT' : bidStr}`);

  // Advance current bidder
  room.currentBidder = (room.currentBidder + 1) % 4;

  // Check if someone selected COAT (which terminates bidding early) or if all 4 seats have bid
  const isCoatBid = room.highestBid === 'COAT';
  const bidsCount = room.bids.filter(b => b !== null).length;

  if (isCoatBid || bidsCount === 4) {
    if (room.highestBidder === null) {
      // Everyone passed! Redeal cards.
      pushSystemChatMessage(room.roomId, "Everyone passed! Cards are redealt.");
      advanceDealer(room);
      startNewRound(room);
      return;
    }

    // Bidding finalized. Team with highestBidder has contract!
    const contractHolder = room.players[room.highestBidder]!.name;

    if (room.highestBid === 'COAT') {
      const partnerSeat = (room.highestBidder + 2) % 4;
      const partnerName = room.players[partnerSeat]?.name || `Seat ${partnerSeat + 1}`;

      pushSystemChatMessage(
        room.roomId,
        `🔥 COAT BID ACTIVE! ${contractHolder} bids COAT. Their partner ${partnerName} is now PACKED 🤐!`
      );
      pushSystemChatMessage(
        room.roomId,
        `🚫 NO TRUMP: There is no trump (Hukoom) for this COAT round. ${contractHolder} must win all 9 tricks alone!`
      );

      // Bypass SELECTING_HUKOOM phase, go directly to PLAYING
      room.phase = 'PLAYING';
      room.hukoomSuit = null;
      room.hukoomBroken = false;
      room.spadesBroken = false;

      // Set turn directly to the COAT bidder so they draw/lead cards first one by one
      room.currentTurn = room.highestBidder;
    } else {
      // Standard numeric bid
      const bidType = `${room.highestBid} Tricks`;
      pushSystemChatMessage(
        room.roomId,
        `Bidding finished! ${contractHolder} won with bid: ${bidType}.`
      );

      // Transition to SELECTING_HUKOOM phase
      room.phase = 'SELECTING_HUKOOM';
      room.currentTurn = room.highestBidder;
      room.leadingSuit = null;
      room.tricks = [];
      pushSystemChatMessage(
        room.roomId,
        `📢 ${contractHolder} must choose the Hukoom (Trump) suit for this round!`
      );
    }
  }

  broadcastState(room.roomId);

  // Trigger bot action if playing phase or next bidder
  if (room.phase === 'BIDDING') {
    triggerBotBiddingIfActive(room);
  } else if (room.phase === 'SELECTING_HUKOOM') {
    triggerBotHukoomSelectionIfActive(room);
  } else if (room.phase === 'PLAYING') {
    triggerBotPlayingIfActive(room);
  }
}

/**
 * BOT Bidding AI Logic
 */
function triggerBotBiddingIfActive(room: GameState) {
  const currentSeat = room.currentBidder;
  const player = room.players[currentSeat];
  if (!player || !player.isBot || room.phase !== 'BIDDING') {
    return;
  }

  // Artificial thinking delay
  setTimeout(() => {
    // Check again to satisfy safety
    if (room.phase !== 'BIDDING' || room.currentBidder !== currentSeat) return;

    const hand = room.hands[currentSeat];
    // Find strongest suit to estimate potential Hukoom strength
    const suitCounts = (['S', 'H', 'D', 'C'] as Suit[]).map(suit => hand.filter(c => c.suit === suit).length);
    const maxSuitCount = Math.max(...suitCounts);
    const highCards = hand.filter(c => c.value === 'A' || c.value === 'K');

    // Bot bidding strategy
    // Since cards are 6-Ace, 9 per suit, a player has 9 cards.
    // Quality cards: potential Hukoom suit, Aces, Kings.
    let strength = maxSuitCount * 1.2 + highCards.length * 0.8;
    
    // Check if teammates are strong
    let targetBidStr = 'PASS';
    
    let curHighest = 0;
    if (room.highestBid !== null) {
      curHighest = room.highestBid === 'COAT' ? 10 : room.highestBid;
    }

    if (strength >= 8.5 && curHighest < 10) {
      // Monster hand. Can choose COAT!
      targetBidStr = 'COAT';
    } else if (strength >= 6.5 && curHighest < 8) {
      targetBidStr = '8';
    } else if (strength >= 5.5 && curHighest < 7) {
      targetBidStr = '7';
    } else if (strength >= 4.2 && curHighest < 6) {
      targetBidStr = '6';
    } else if (strength >= 3.0 && curHighest < 5) {
      targetBidStr = '5';
    } else {
      targetBidStr = 'PASS';
    }

    // Bid must be higher than current highest bid to be accepted, or PASS
    if (targetBidStr !== 'PASS') {
      let bVal = targetBidStr === 'COAT' ? 10 : parseInt(targetBidStr, 10);
      if (bVal <= curHighest) {
        targetBidStr = 'PASS';
      }
    }

    handleBidSubmit(room, currentSeat, targetBidStr);
  }, 1200);
}

/**
 * BOT Hukoom Selection Logic
 */
function triggerBotHukoomSelectionIfActive(room: GameState) {
  const currentSeat = room.currentTurn;
  const player = room.players[currentSeat];
  if (!player || !player.isBot || room.phase !== 'SELECTING_HUKOOM') {
    return;
  }

  setTimeout(() => {
    if (room.phase !== 'SELECTING_HUKOOM' || room.currentTurn !== currentSeat) return;

    const hand = room.hands[currentSeat];
    const suitCounts: Record<Suit, number> = { 'S': 0, 'H': 0, 'D': 0, 'C': 0 };
    for (const card of hand) {
      suitCounts[card.suit]++;
    }

    // Pick suit with maximum count
    let bestSuit: Suit = 'S';
    let maxCount = -1;
    for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) {
      if (suitCounts[suit] > maxCount) {
        maxCount = suitCounts[suit];
        bestSuit = suit;
      }
    }

    handleHukoomSelect(room, currentSeat, bestSuit);
  }, 1200);
}

/**
 * Handle chosen Hukoom Suit
 */
function handleHukoomSelect(room: GameState, seat: number, suit: Suit) {
  if (room.phase !== 'SELECTING_HUKOOM' || room.currentTurn !== seat) {
    return;
  }

  room.hukoomSuit = suit;
  room.hukoomBroken = false;
  room.spadesBroken = false;

  const suitNameMap: Record<Suit, string> = { 'S': '♠ Spades', 'H': '♥ Hearts', 'D': '♦ Diamonds', 'C': '♣ Clubs' };
  pushSystemChatMessage(room.roomId, `📢 HUKOOM (Trump) set to: ${suitNameMap[suit]} by ${room.players[seat]?.name || 'Player'}`);

  // Transition to PLAYING phase
  room.phase = 'PLAYING';
  room.currentTurn = (room.dealer + 1) % 4; // Leading starts next to the dealer
  room.leadingSuit = null;
  room.tricks = [];

  broadcastState(room.roomId);

  // Trigger bot playing if active
  triggerBotPlayingIfActive(room);
}

/**
 * Play a card from hand
 */
function handlePlayCard(room: GameState, seat: number, card: Card) {
  if (room.phase !== 'PLAYING' || room.currentTurn !== seat) {
    return;
  }

  const handIndex = room.hands[seat].findIndex(
    c => c.suit === card.suit && c.value === card.value
  );

  if (handIndex === -1) {
    return; // This card is not in player's hand!
  }

  // Validate play requirements
  const playerHand = room.hands[seat];
  let isPlayValid = true;

  if (room.tricks.length > 0) {
    // Following trick
    const leadingSuit = room.leadingSuit!;
    const hasLeadingSuit = playerHand.some(c => c.suit === leadingSuit);
    
    if (hasLeadingSuit && card.suit !== leadingSuit) {
      isPlayValid = false; // Must follow leading suit if available!
    }
  } else {
    // Leading trick
    // Check if player plays Hukoom (Trump) when Hukoom is not broken and player has other suits
    const trump = room.highestBid === 'COAT' ? null : (room.hukoomSuit || 'S');
    if (trump && card.suit === trump && !room.hukoomBroken) {
      const hasOtherSuits = playerHand.some(c => c.suit !== trump);
      if (hasOtherSuits) {
        isPlayValid = false; // Trump is not broken yet!
      }
    }
  }

  if (!isPlayValid) {
    // Warn client (normally client UI handles validation, but we reject cleanly)
    return;
  }

  // Valid card! Remove card from hand
  playerHand.splice(handIndex, 1);

  // Play card
  room.tricks.push({ card, playerIndex: seat });

  // Update spades/Hukoom broken if Trump was used
  const trump = room.highestBid === 'COAT' ? null : (room.hukoomSuit || 'S');
  if (trump && card.suit === trump && room.leadingSuit !== trump) {
    room.hukoomBroken = true;
    room.spadesBroken = true;
  }

  // Set leading suit if first card
  if (room.tricks.length === 1) {
    room.leadingSuit = card.suit;
  }

  // Advance turn
  room.currentTurn = getNextTurn(room, room.currentTurn);

  // If trick is full (4 cards, or 3 cards if teammate is packed), schedule trick winner evaluation
  const targetTrickSize = room.highestBid === 'COAT' ? 3 : 4;
  if (room.tricks.length === targetTrickSize) {
    // Set active turn to -1 to pause interactions during suspense
    const activeTrick = [...room.tricks];
    const leadingSuit = room.leadingSuit!;
    room.currentTurn = -1; // Block plays temporarily for aesthetic delay

    broadcastState(room.roomId);

    setTimeout(() => {
      resolveCompletedTrick(room, activeTrick, leadingSuit);
    }, 2000); // 2 second delay to let players see what cards were played!
  } else {
    broadcastState(room.roomId);
    triggerBotPlayingIfActive(room);
  }
}

/**
 * Handles trick resolution after all 4 cards have been played
 */
function resolveCompletedTrick(room: GameState, trickCards: { card: Card; playerIndex: number }[], leading: Suit) {
  // Determine winner using chosen Hukoom Suit
  let winningCard = trickCards[0];
  const trump = room.highestBid === 'COAT' ? null : (room.hukoomSuit || 'S');

  for (let i = 1; i < trickCards.length; i++) {
    const candidate = trickCards[i];
    // If candidate card is Trump (Hukoom)
    if (trump && candidate.card.suit === trump) {
      if (winningCard.card.suit !== trump) {
        winningCard = candidate; // Trump beats non-trump
      } else if (candidate.card.rank > winningCard.card.rank) {
        winningCard = candidate; // High Trump beats low Trump
      }
    } else if (candidate.card.suit === leading && (!trump || winningCard.card.suit !== trump)) {
      // If no Trump is played, candidate must follow suit and exceed high card of leading suit
      if (winningCard.card.suit !== leading || candidate.card.rank > winningCard.card.rank) {
        winningCard = candidate;
      }
    }
  }

  const winnerSeat = winningCard.playerIndex;
  room.lastTrickWinner = winnerSeat;

  // Log Team scoring
  const teamNum = (winnerSeat === 0 || winnerSeat === 2) ? 1 : 2;
  if (teamNum === 1) {
    room.team1TricksWon++;
  } else {
    room.team2TricksWon++;
  }

  // Print system log
  const winnerName = room.players[winnerSeat]?.name || `Player ${winnerSeat + 1}`;
  pushSystemChatMessage(room.roomId, `Trick won by ${winnerName} (${winningCard.card.value}${cardSuitSymbol(winningCard.card.suit)})`);

  // Clear current trick
  room.tricks = [];
  room.leadingSuit = null;

  // Early COAT failure condition: Check if an opponent won the trick
  if (room.highestBid === 'COAT' && room.highestBidder !== null) {
    const bidderSeat = room.highestBidder;
    const bidderTeam = (bidderSeat === 0 || bidderSeat === 2) ? 1 : 2;
    if (teamNum !== bidderTeam) {
      resolveRoundScores(room, true);
      return;
    }
  }

  // Check if round is over (hands empty)
  const handSample = room.hands[0].length;
  if (handSample === 0) {
    // All 9 tricks played! Calculate Score transitions
    resolveRoundScores(room);
  } else {
    // Continue playing
    room.currentTurn = winnerSeat;
    broadcastState(room.roomId);
    triggerBotPlayingIfActive(room);
  }
}

function cardSuitSymbol(suit: Suit): string {
  switch (suit) {
    case 'S': return '♠';
    case 'H': return '♥';
    case 'D': return '♦';
    case 'C': return '♣';
  }
}

/**
 * Handle score counting when 9 tricks are completed or early COAT ended
 */
function resolveRoundScores(room: GameState, earlyOpponentWin = false) {
  const bidderSeat = room.highestBidder!;
  const bidderTeam = (bidderSeat === 0 || bidderSeat === 2) ? 1 : 2;
  const bidStr = room.bids[bidderSeat]!;

  const t1Tricks = room.team1TricksWon;
  const t2Tricks = room.team2TricksWon;

  let t1Change = 0;
  let t2Change = 0;

  if (bidStr === 'COAT') {
    // Must win ALL 9 tricks
    if (earlyOpponentWin) {
      if (bidderTeam === 1) {
        t2Change = 52;
        pushSystemChatMessage(room.roomId, `💀 COAT OVER! Opponent won a trick! Team 2 gets 52 points and wins!`);
      } else {
        t1Change = 52;
        pushSystemChatMessage(room.roomId, `💀 COAT OVER! Opponent won a trick! Team 1 gets 52 points and wins!`);
      }
    } else {
      if (bidderTeam === 1) {
        if (t1Tricks === 9) {
          t1Change = 52; // COAT won! Immediate game win
          pushSystemChatMessage(room.roomId, `🏆 AMAZING! Team 1 won COAT and scores 52 points!`);
        } else {
          t2Change = 52; // Failed COAT. Opponents get 52
          pushSystemChatMessage(room.roomId, `💀 FAILED COAT! Team 2 gets 52 points as penalty!`);
        }
      } else {
        if (t2Tricks === 9) {
          t2Change = 52;
          pushSystemChatMessage(room.roomId, `🏆 AMAZING! Team 2 won COAT and scores 52 points!`);
        } else {
          t1Change = 52;
          pushSystemChatMessage(room.roomId, `💀 FAILED COAT! Team 1 gets 52 points as penalty!`);
        }
      }
    }
  } else {
    // Standard numerical bids 5, 6, 7
    const bidVal = parseInt(bidStr, 10);
    if (bidderTeam === 1) {
      const success = t1Tricks >= bidVal;
      if (success) {
        t1Change = bidVal;
        pushSystemChatMessage(room.roomId, `✅ Team 1 completed their bid of ${bidVal} and gets +${bidVal} points!`);
      } else {
        t2Change = bidVal * 2; // Double opponent points
        pushSystemChatMessage(room.roomId, `❌ Team 1 failed their bid of ${bidVal}! Opposite Team 2 gets +${bidVal * 2} points!`);
      }
    } else {
      const success = t2Tricks >= bidVal;
      if (success) {
        t2Change = bidVal;
        pushSystemChatMessage(room.roomId, `✅ Team 2 completed their bid of ${bidVal} and gets +${bidVal} points!`);
      } else {
        t1Change = bidVal * 2;
        pushSystemChatMessage(room.roomId, `❌ Team 2 failed their bid of ${bidVal}! Opposite Team 1 gets +${bidVal * 2} points!`);
      }
    }
  }

  // Update actual scores
  room.scoreTeam1 += t1Change;
  room.scoreTeam2 += t2Change;

  const roundNum = room.history.length + 1;
  const historyItem: RoundScores = {
    round: roundNum,
    bidder: bidderSeat,
    bid: bidStr,
    team1Tricks: t1Tricks,
    team2Tricks: t2Tricks,
    team1ScoreChange: t1Change,
    team2ScoreChange: t2Change,
    accumulatedTeam1: room.scoreTeam1,
    accumulatedTeam2: room.scoreTeam2
  };
  room.history.push(historyItem);

  // Check game victory condition (52 points)
  if (room.scoreTeam1 >= 52 || room.scoreTeam2 >= 52) {
    room.phase = 'GAME_OVER';
    if (room.scoreTeam1 >= 52 && room.scoreTeam2 >= 52) {
      // Tie breaker: higher score wins, else bidder team wins, else Team 1 wins
      if (room.scoreTeam1 > room.scoreTeam2) {
        room.winnerTeam = 1;
      } else if (room.scoreTeam2 > room.scoreTeam1) {
        room.winnerTeam = 2;
      } else {
        room.winnerTeam = bidderTeam; // bidder gets priority in absolute tied situations
      }
    } else if (room.scoreTeam1 >= 52) {
      room.winnerTeam = 1;
    } else {
      room.winnerTeam = 2;
    }

    pushSystemChatMessage(
      room.roomId,
      `🏆 GAME OVER! TEAM ${room.winnerTeam} WINS THE COAT MATCH WITH ${room.winnerTeam === 1 ? room.scoreTeam1 : room.scoreTeam2} POINTS!`
    );
  } else {
    // Proceed to next round! Dealer shifts
    room.phase = 'ROUND_OVER';
    pushSystemChatMessage(room.roomId, `Round ${roundNum} finished. Scores are Team 1: ${room.scoreTeam1} | Team 2: ${room.scoreTeam2}`);
  }

  broadcastState(room.roomId);
}

/**
 * BOT Playing AI Logic
 */
function triggerBotPlayingIfActive(room: GameState) {
  const currentSeat = room.currentTurn;
  const player = room.players[currentSeat];
  if (!player || !player.isBot || room.phase !== 'PLAYING') {
    return;
  }

  // Delay of 1.2s to make it look realistic
  setTimeout(() => {
    // Satisfy safety
    if (room.phase !== 'PLAYING' || room.currentTurn !== currentSeat) return;

    const hand = room.hands[currentSeat];
    let playableCards = [...hand];
    const trump = room.highestBid === 'COAT' ? null : (room.hukoomSuit || 'S');

    // Follow the suit constraints
    if (room.tricks.length > 0) {
      const leadingSuit = room.leadingSuit!;
      const matching = hand.filter(c => c.suit === leadingSuit);
      if (matching.length > 0) {
        playableCards = matching;
      }
    } else {
      // Leading. Trump can only lead if broken, or we only have trump.
      if (trump && !room.hukoomBroken) {
        const nonTrump = hand.filter(c => c.suit !== trump);
        if (nonTrump.length > 0) {
          playableCards = nonTrump;
        }
      }
    }

    // AI selection logic
    let cardToPlay = playableCards[0];

    // Let's implement smart selection
    if (room.tricks.length > 0) {
      // Following standard play
      const leadingSuit = room.leadingSuit!;
      // Find current highest card in trick to know what to beat
      let highestInTrick = room.tricks[0];
      for (const t of room.tricks) {
        if (trump && t.card.suit === trump) {
          if (highestInTrick.card.suit !== trump || t.card.rank > highestInTrick.card.rank) {
            highestInTrick = t;
          }
        } else if (t.card.suit === leadingSuit && (!trump || highestInTrick.card.suit !== trump)) {
          if (highestInTrick.card.suit !== leadingSuit || t.card.rank > highestInTrick.card.rank) {
            highestInTrick = t;
          }
        }
      }

      // Partner seat is seat + 2 % 4 (Index partner)
      const partnerSeat = (currentSeat + 2) % 4;
      const isPartnerWinning = highestInTrick.playerIndex === partnerSeat;

      if (isPartnerWinning) {
        // Partner is winning! Play lowest card of those playable
        cardToPlay = playableCards.reduce((min, c) => (c.rank < min.rank ? c : min), playableCards[0]);
      } else {
        // Try to win the trick if possible
        // Find if we have cards that can beat highestInTrick
        const winningOptions = playableCards.filter(c => {
          if (trump && c.suit === trump && highestInTrick.card.suit !== trump) return true;
          if (c.suit === leadingSuit && highestInTrick.card.suit === leadingSuit && c.rank > highestInTrick.card.rank) return true;
          return false;
        });

        if (winningOptions.length > 0) {
          // Play the lowest winning card (don't waste a huge trump if a small one works)
          cardToPlay = winningOptions.reduce((min, c) => (c.rank < min.rank ? c : min), winningOptions[0]);
        } else {
          // Can't win anyway. Dump our lowest card to conserve high cards
          cardToPlay = playableCards.reduce((min, c) => (c.rank < min.rank ? c : min), playableCards[0]);
        }
      }
    } else {
      // Bot is leading! Play a high power card to win, or lead a non-trump safely
      const acesAndKings = playableCards.filter(c => c.value === 'A' || c.value === 'K');
      if (acesAndKings.length > 0) {
        cardToPlay = acesAndKings[0];
      } else {
        // Play lowest card
        cardToPlay = playableCards.reduce((min, c) => (c.rank < min.rank ? c : min), playableCards[0]);
      }
    }

    if (cardToPlay) {
      handlePlayCard(room, currentSeat, cardToPlay);
    }
  }, 1200);
}

function pushSystemChatMessage(roomId: string, text: string) {
  const systemMsg: ChatMessage = {
    id: `chat_sys_${Date.now()}_${Math.random()}`,
    senderName: 'Dealer',
    text,
    seat: -1,
    timestamp: Date.now()
  };

  const chats = roomChats.get(roomId) || [];
  chats.push(systemMsg);
  roomChats.set(roomId, chats.slice(-50)); // limit history

  broadcastMessage(roomId, {
    type: 'CHAT_MESSAGE',
    chat: systemMsg
  });
}

/**
 * Handle custom WebSocket connection
 */
wss.on('connection', (ws: WebSocket, req) => {
  const playerId = `usr_${Math.random().toString(36).substring(2, 9)}`;
  clients.set(playerId, { ws, playerId, roomId: null });

  ws.on('message', (rawData) => {
    try {
      const msg: ClientMessage = JSON.parse(rawData.toString());
      const clientMeta = clients.get(playerId);
      if (!clientMeta) return;

      if (msg.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
        return;
      }

      if (msg.type === 'JOIN_ROOM') {
        const room = getOrCreateRoom(msg.roomId);
        const roomId = room.roomId;

        clientMeta.roomId = roomId;

        // Try to place player in an unoccupied seat
        let playerSeat = -1;
        
        // Check if player is already in this room
        const existingSeat = room.players.findIndex(p => p && p.id === playerId);
        if (existingSeat !== -1) {
          playerSeat = existingSeat;
        } else {
          // Look for empty seat first
          for (let i = 0; i < 4; i++) {
            if (!room.players[i]) {
              playerSeat = i;
              break;
            }
          }
          // If no truly empty seat, look for a bot seat to replace
          if (playerSeat === -1) {
            for (let i = 0; i < 4; i++) {
              if (room.players[i] && room.players[i]!.isBot) {
                playerSeat = i;
                break;
              }
            }
          }
        }

        if (playerSeat === -1) {
          // Room full! Reject
          ws.send(JSON.stringify({ type: 'REJECT', error: 'This room is already busy or full!' }));
          return;
        }

        // Add player to the room seat, replacing what was there if empty or bot
        if (!room.players[playerSeat] || room.players[playerSeat]!.isBot) {
          const replacedBot = room.players[playerSeat] && room.players[playerSeat]!.isBot ? room.players[playerSeat]!.name : null;
          room.players[playerSeat] = {
            id: playerId,
            name: msg.name || `Player_${playerSeat + 1}`,
            isBot: false,
            seat: playerSeat,
            isReady: false
          };
          if (replacedBot) {
            pushSystemChatMessage(roomId, `${room.players[playerSeat]!.name} joined and replaced bot ${replacedBot} in Seat ${playerSeat + 1}!`);
          } else {
            pushSystemChatMessage(roomId, `${room.players[playerSeat]!.name} joined the room in Seat ${playerSeat + 1}!`);
          }
        } else {
          pushSystemChatMessage(roomId, `${room.players[playerSeat]!.name} re-connected to Seat ${playerSeat + 1}!`);
        }

        broadcastState(roomId);
        return;
      }

      // Rest of messages require valid room matching
      const roomId = clientMeta.roomId;
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      const playerSeatIndex = room.players.findIndex(p => p && p.id === playerId);
      if (playerSeatIndex === -1) return;

      const activePlayer = room.players[playerSeatIndex]!;

      switch (msg.type) {
        case 'CHOOSE_NAME': {
          if (msg.name) {
            const oldName = activePlayer.name;
            activePlayer.name = msg.name;
            pushSystemChatMessage(roomId, `${oldName} changed their name to ${msg.name}`);
            broadcastState(roomId);
          }
          break;
        }

        case 'TOGGLE_READY': {
          activePlayer.isReady = !activePlayer.isReady;
          pushSystemChatMessage(roomId, `${activePlayer.name} is ${activePlayer.isReady ? 'READY 🟢' : 'NOT READY 🔴'}`);
          broadcastState(roomId);
          break;
        }

        case 'FORCE_BOTS': {
          fillRoomWithBots(room);
          pushSystemChatMessage(roomId, `Room has been filled with professional bots!`);
          broadcastState(roomId);
          break;
        }

        case 'START_GAME': {
          // Fill remaining seats with bots to auto-start if forced, otherwise ensure 4 players ready
          fillRoomWithBots(room);
          room.dealer = 0;
          room.scoreTeam1 = 0;
          room.scoreTeam2 = 0;
          room.history = [];
          room.winnerTeam = null;

          pushSystemChatMessage(roomId, `🎮 Game started! Let's play Coat! Objective: 52 points.`);
          startNewRound(room);
          break;
        }

        case 'SUBMIT_BID': {
          if (msg.bid) {
            handleBidSubmit(room, playerSeatIndex, msg.bid);
          }
          break;
        }

        case 'SELECT_HUKOOM': {
          if (msg.hukoomSuit) {
            handleHukoomSelect(room, playerSeatIndex, msg.hukoomSuit);
          }
          break;
        }

        case 'PLAY_CARD': {
          if (msg.card) {
            handlePlayCard(room, playerSeatIndex, msg.card);
          }
          break;
        }

        case 'SEND_CHAT': {
          if (msg.chatText) {
            const chatObj: ChatMessage = {
              id: `chat_${Date.now()}_${Math.random()}`,
              senderName: activePlayer.name,
              text: msg.chatText,
              seat: playerSeatIndex,
              timestamp: Date.now()
            };
            const chatCache = roomChats.get(roomId) || [];
            chatCache.push(chatObj);
            roomChats.set(roomId, chatCache.slice(-50));

            broadcastMessage(roomId, {
              type: 'CHAT_MESSAGE',
              chat: chatObj
            });
          }
          break;
        }

        case 'RESTART_GAME': {
          if (room.phase === 'GAME_OVER' || room.phase === 'ROUND_OVER') {
            if (room.phase === 'ROUND_OVER') {
              advanceDealer(room);
              startNewRound(room);
            } else {
              // Complete reset
              room.scoreTeam1 = 0;
              room.scoreTeam2 = 0;
              room.history = [];
              room.winnerTeam = null;
              startNewRound(room);
            }
          }
          break;
        }
      }
    } catch (e) {
      console.error('Error processing WS packet: ', e);
    }
  });

  ws.on('close', () => {
    // Locate disconnected user
    const clientMeta = clients.get(playerId);
    if (clientMeta) {
      const roomId = clientMeta.roomId;
      if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
          const seat = room.players.findIndex(p => p && p.id === playerId);
          if (seat !== -1) {
            const name = room.players[seat]!.name;
            // Instead of deleting, mark as bot or let other join, standard: replace leaving player with a bot so the game continues smoothly!
            room.players[seat] = {
              id: `bot_${Math.random().toString(36).substring(2, 9)}`,
              name: `${name}_Bot`,
              isBot: true,
              seat,
              isReady: true
            };
            pushSystemChatMessage(roomId, `${name} disconnected. Replaced with active bot player.`);
            
            // If it was their turn, trigger appropriate action
            if (room.phase === 'BIDDING' && room.currentBidder === seat) {
              triggerBotBiddingIfActive(room);
            } else if (room.phase === 'PLAYING' && room.currentTurn === seat) {
              triggerBotPlayingIfActive(room);
            }
            
            broadcastState(roomId);
          }
        }
      }
      clients.delete(playerId);
    }
  });
});

// Bind HTTP upgrade manually
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (viteInstance) {
    // Let Vite HMR web socket handle its own upgrade request in development mode!
  } else {
    socket.destroy();
  }
});

// Configure Vite integration or Build servers
async function run() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    viteInstance = vite;
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });

    console.log('Vite development middleware configured successfully.');
  } else {
    // Serve production build
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist/index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Express custom Coat matchmaker server listening on port ${PORT}`);
  });
}

run().catch(err => {
  console.error("Failed to bootstrap server structure:", err);
});
