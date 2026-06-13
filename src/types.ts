/**
 * Shared Type Definitions for 6-Ace Spades IOS Game
 */

export type Suit = 'S' | 'H' | 'D' | 'C'; // Spades, Hearts, Diamonds, Clubs
export type CardValue = '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  value: CardValue;
  rank: number; // 6 to 14
}

export type GamePhase = 'LOBBY' | 'BIDDING' | 'SELECTING_HUKOOM' | 'PLAYING' | 'ROUND_OVER' | 'GAME_OVER';

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  seat: number; // 0, 1, 2, 3
  isReady: boolean;
}

export interface RoundScores {
  round: number;
  bidder: number; // seat index
  bid: string; // "5", "6", "7", "COAT"
  team1Tricks: number;
  team2Tricks: number;
  team1ScoreChange: number;
  team2ScoreChange: number;
  accumulatedTeam1: number;
  accumulatedTeam2: number;
}

export interface GameState {
  roomId: string;
  phase: GamePhase;
  players: (Player | null)[]; // 4 seats
  dealer: number; // seat index (0-3)
  currentBidder: number; // seat index (0-3)
  highestBid: number | 'COAT' | null;
  highestBidder: number | null; // seat index
  bids: (string | null)[]; // what each player bid: "PASS", "5", "6", "7", "COAT", or null
  hands: Card[][]; // hands for players 0, 1, 2, 3
  currentTurn: number; // seat index whose turn it is
  tricks: { card: Card; playerIndex: number }[]; // cards played in current trick (up to 4)
  leadingSuit: Suit | null;
  spadesBroken: boolean; // Keep for reverse compatibility
  hukoomSuit: Suit | null; // Selected trump suit ('S' | 'H' | 'D' | 'C')
  hukoomBroken: boolean; // Has Hukoom been cut?
  team1TricksWon: number; // collected tricks for seat 0 & 2
  team2TricksWon: number; // collected tricks for seat 1 & 3
  scoreTeam1: number;
  scoreTeam2: number;
  winnerTeam: number | null; // 1 or 2
  history: RoundScores[];
  lastTrickWinner: number | null; // who won the ultimate trick
}

export interface ChatMessage {
  id: string;
  senderName: string;
  text: string;
  seat: number;
  timestamp: number;
}

// WS messages structures
export type ClientMessageType =
  | 'JOIN_ROOM'
  | 'CHOOSE_NAME'
  | 'SUBMIT_BID'
  | 'PLAY_CARD'
  | 'SEND_CHAT'
  | 'START_GAME'
  | 'TOGGLE_READY'
  | 'RESTART_GAME'
  | 'FORCE_BOTS'
  | 'SELECT_HUKOOM'
  | 'PING';

export interface ClientMessage {
  type: ClientMessageType;
  roomId?: string;
  name?: string;
  bid?: string; // "PASS", "5", "6", "7", "COAT"
  card?: Card;
  chatText?: string;
  hukoomSuit?: Suit;
}

export type ServerMessageType =
  | 'ROOM_STATE'
  | 'CHAT_MESSAGE'
  | 'OPPONENT_EMOJI' // Quick emojis
  | 'REJECT';

export interface ServerMessage {
  type: ServerMessageType;
  state?: GameState;
  message?: string;
  error?: string;
  chat?: ChatMessage;
  emoji?: { seat: number; char: string };
  yourPlayerId?: string;
}
