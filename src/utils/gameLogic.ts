import { Card, Suit, GameState, Player, ChatMessage, RoundScores } from '../types';

/**
 * Generate an elegant Spades 6-Ace deck
 * Cards range from 6 to Ace (6, 7, 8, 9, 10, J, Q, K, A)
 * 9 cards per suit, 4 suits, total 36 cards
 */
export function createDeck(): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const values: { value: Card['value']; rank: number }[] = [
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
export function shuffle(deck: Card[]): Card[] {
  const cards = [...deck];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/**
 * Sort hands by suit and then rank for good UI visibility
 */
export function sortHand(hand: Card[]): Card[] {
  const suitOrder: Record<Suit, number> = { 'S': 4, 'H': 3, 'C': 2, 'D': 1 };
  return [...hand].sort((a, b) => {
    if (a.suit !== b.suit) {
      return suitOrder[b.suit] - suitOrder[a.suit];
    }
    return b.rank - a.rank;
  });
}

/**
 * Deal deck cards to 4 players
 */
export function dealCards(room: GameState) {
  const deck = shuffle(createDeck());
  
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
export function advanceDealer(room: GameState) {
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
export function isPlayerPacked(room: GameState, seat: number): boolean {
  if (room.highestBid === 'COAT' && room.highestBidder !== null) {
    const partnerSeat = (room.highestBidder + 2) % 4;
    return seat === partnerSeat;
  }
  return false;
}

/**
 * Helper to calculate the next active player, skipping the packed teammate
 */
export function getNextTurn(room: GameState, currentTurn: number): number {
  let next = (currentTurn + 1) % 4;
  while (isPlayerPacked(room, next)) {
    next = (next + 1) % 4;
  }
  return next;
}

/**
 * Starts a new bidding round
 */
export function startNewRound(room: GameState, addSystemMessage: (text: string) => void) {
  room.phase = 'BIDDING';
  room.highestBid = null;
  room.highestBidder = null;
  room.bids = [null, null, null, null];
  room.tricks = [];
  room.leadingSuit = null;

  // Bidding starts next to serving player
  room.currentBidder = (room.dealer + 1) % 4;
  dealCards(room);
  
  addSystemMessage(`Dealer ${room.players[room.dealer]?.name || `Seat ${room.dealer + 1}`} shuffled and dealt. Bidding starts now with ${room.players[room.currentBidder]?.name || `Seat ${room.currentBidder + 1}`}!`);
}

/**
 * Handle a submitted bid
 */
export function handleBidSubmit(
  room: GameState,
  seat: number,
  bidStr: string,
  addSystemMessage: (text: string) => void,
  redealCallback: () => void
): boolean {
  if (room.phase !== 'BIDDING' || room.currentBidder !== seat) {
    return false;
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
      let curHighestNum = typeof room.highestBid === 'number' ? room.highestBid : 0;
      if (bidValue > curHighestNum) {
        isHighestValue = true;
      }
    }

    if (isHighestValue) {
      room.highestBid = bidValue;
      room.highestBidder = seat;
    } else {
      // Set to PASS if equal or lower to prevent freeze
      bidStr = 'PASS';
      room.bids[seat] = 'PASS';
    }
  }

  const bidderName = room.players[seat]?.name || `Player ${seat + 1}`;
  addSystemMessage(`${bidderName} bid ${bidStr === 'COAT' ? '🔥 COAT' : bidStr}`);

  // Advance current bidder
  room.currentBidder = (room.currentBidder + 1) % 4;

  const isCoatBid = room.highestBid === 'COAT';
  const bidsCount = room.bids.filter(b => b !== null).length;

  if (isCoatBid || bidsCount === 4) {
    if (room.highestBidder === null) {
      addSystemMessage("Everyone passed! Cards are redealt.");
      advanceDealer(room);
      redealCallback();
      return true;
    }

    const contractHolder = room.players[room.highestBidder]!.name;

    if (room.highestBid === 'COAT') {
      const partnerSeat = (room.highestBidder + 2) % 4;
      const partnerName = room.players[partnerSeat]?.name || `Seat ${partnerSeat + 1}`;

      addSystemMessage(`🔥 COAT BID ACTIVE! ${contractHolder} bids COAT. Their partner ${partnerName} is now PACKED 🤐!`);
      addSystemMessage(`🚫 NO TRUMP: There is no trump (Hukoom) for this COAT round. ${contractHolder} must win all 9 tricks alone!`);

      room.phase = 'PLAYING';
      room.hukoomSuit = null;
      room.hukoomBroken = false;
      room.spadesBroken = false;
      room.currentTurn = room.highestBidder;
    } else {
      const bidType = `${room.highestBid} Tricks`;
      addSystemMessage(`Bidding finished! ${contractHolder} won with bid: ${bidType}.`);

      room.phase = 'SELECTING_HUKOOM';
      room.currentTurn = room.highestBidder;
      room.leadingSuit = null;
      room.tricks = [];
      addSystemMessage(`📢 ${contractHolder} must choose the Hukoom (Trump) suit for this round!`);
    }
  }

  return true;
}

/**
 * Handle chosen Hukoom Suit
 */
export function handleHukoomSelect(
  room: GameState,
  seat: number,
  suit: Suit,
  addSystemMessage: (text: string) => void
): boolean {
  if (room.phase !== 'SELECTING_HUKOOM' || room.currentTurn !== seat) {
    return false;
  }

  room.hukoomSuit = suit;
  room.hukoomBroken = false;
  room.spadesBroken = false;

  const suitNameMap: Record<Suit, string> = { 'S': '♠ Spades', 'H': '♥ Hearts', 'D': '♦ Diamonds', 'C': '♣ Clubs' };
  addSystemMessage(`📢 HUKOOM (Trump) set to: ${suitNameMap[suit]} by ${room.players[seat]?.name || 'Player'}`);

  room.phase = 'PLAYING';
  room.currentTurn = (room.dealer + 1) % 4; // Starts next to the dealer
  room.leadingSuit = null;
  room.tricks = [];

  return true;
}

/**
 * Check if a specific card is playable by the player
 */
export function isCardPlayable(room: GameState, seat: number, card: Card): boolean {
  if (room.phase !== 'PLAYING' || room.currentTurn !== seat) {
    return false;
  }

  const playerHand = room.hands[seat];
  
  if (room.tricks.length > 0) {
    const leadingSuit = room.leadingSuit!;
    const hasLeadingSuit = playerHand.some(c => c.suit === leadingSuit);
    if (hasLeadingSuit && card.suit !== leadingSuit) {
      return false; // Must follow leading suit if available!
    }
  } else {
    // Leading trick
    const trump = room.highestBid === 'COAT' ? null : (room.hukoomSuit || 'S');
    if (trump && card.suit === trump && !room.hukoomBroken) {
      const hasOtherSuits = playerHand.some(c => c.suit !== trump);
      if (hasOtherSuits) {
        return false; // Trump is not broken yet!
      }
    }
  }

  return true;
}

/**
 * BOT Bidding Strategic Decision
 */
export function getBotBid(room: GameState, seat: number): string {
  const hand = room.hands[seat];
  const suitCounts = (['S', 'H', 'D', 'C'] as Suit[]).map(suit => hand.filter(c => c.suit === suit).length);
  const maxSuitCount = Math.max(...suitCounts);
  const highCards = hand.filter(c => c.value === 'A' || c.value === 'K');

  let strength = maxSuitCount * 1.2 + highCards.length * 0.8;
  
  let targetBidStr = 'PASS';
  let curHighest = 0;
  if (room.highestBid !== null) {
    curHighest = room.highestBid === 'COAT' ? 10 : room.highestBid;
  }

  if (strength >= 8.5 && curHighest < 10) {
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

  if (targetBidStr !== 'PASS') {
    let bVal = targetBidStr === 'COAT' ? 10 : parseInt(targetBidStr, 10);
    if (bVal <= curHighest) {
      targetBidStr = 'PASS';
    }
  }

  return targetBidStr;
}

/**
 * BOT Hukoom selection
 */
export function getBotHukoom(room: GameState, seat: number): Suit {
  const hand = room.hands[seat];
  const suitCounts: Record<Suit, number> = { 'S': 0, 'H': 0, 'D': 0, 'C': 0 };
  for (const card of hand) {
    suitCounts[card.suit]++;
  }

  let bestSuit: Suit = 'S';
  let maxCount = -1;
  for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) {
    if (suitCounts[suit] > maxCount) {
      maxCount = suitCounts[suit];
      bestSuit = suit;
    }
  }

  return bestSuit;
}

/**
 * BOT Smart Play Selector
 */
export function getBotCardPlay(room: GameState, seat: number): Card {
  const hand = room.hands[seat];
  let playableCards = hand.filter(card => isCardPlayable(room, seat, card));
  if (playableCards.length === 0) {
    playableCards = [...hand]; // Fallback safety
  }

  const trump = room.highestBid === 'COAT' ? null : (room.hukoomSuit || 'S');

  if (room.tricks.length > 0) {
    const leadingSuit = room.leadingSuit!;
    // Find current winning card in trick to beat
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

    const partnerSeat = (seat + 2) % 4;
    const isPartnerWinning = highestInTrick.playerIndex === partnerSeat;

    if (isPartnerWinning) {
      // Partner winning: throw lowest card
      return playableCards.reduce((min, c) => (c.rank < min.rank ? c : min), playableCards[0]);
    } else {
      // Try to win the trick
      const winningOptions = playableCards.filter(c => {
        if (trump && c.suit === trump && highestInTrick.card.suit !== trump) return true;
        if (c.suit === leadingSuit && highestInTrick.card.suit === leadingSuit && c.rank > highestInTrick.card.rank) return true;
        return false;
      });

      if (winningOptions.length > 0) {
        return winningOptions.reduce((min, c) => (c.rank < min.rank ? c : min), winningOptions[0]);
      } else {
        return playableCards.reduce((min, c) => (c.rank < min.rank ? c : min), playableCards[0]);
      }
    }
  } else {
    // Leading: try to play an Ace/King, or throw lowest card
    const acesAndKings = playableCards.filter(c => c.value === 'A' || c.value === 'K');
    if (acesAndKings.length > 0) {
      return acesAndKings[0];
    }
    return playableCards.reduce((min, c) => (c.rank < min.rank ? c : min), playableCards[0]);
  }
}

/**
 * Handle score counting when 9 tricks are completed or early COAT ended
 */
export function resolveRoundScores(
  room: GameState,
  earlyOpponentWin: boolean,
  addSystemMessage: (text: string) => void
) {
  const bidderSeat = room.highestBidder!;
  const bidderTeam = (bidderSeat === 0 || bidderSeat === 2) ? 1 : 2;
  const bidStr = room.bids[bidderSeat]!;

  const t1Tricks = room.team1TricksWon;
  const t2Tricks = room.team2TricksWon;

  let t1Change = 0;
  let t2Change = 0;

  if (bidStr === 'COAT') {
    if (earlyOpponentWin) {
      if (bidderTeam === 1) {
        t2Change = 52;
        addSystemMessage(`💀 COAT OVER! Opponent won a trick! Team 2 gets 52 points and wins!`);
      } else {
        t1Change = 52;
        addSystemMessage(`💀 COAT OVER! Opponent won a trick! Team 1 gets 52 points and wins!`);
      }
    } else {
      if (bidderTeam === 1) {
        if (t1Tricks === 9) {
          t1Change = 52;
          addSystemMessage(`🏆 AMAZING! Team 1 won COAT and scores 52 points!`);
        } else {
          t2Change = 52;
          addSystemMessage(`💀 FAILED COAT! Team 2 gets 52 points as penalty!`);
        }
      } else {
        if (t2Tricks === 9) {
          t2Change = 52;
          addSystemMessage(`🏆 AMAZING! Team 2 won COAT and scores 52 points!`);
        } else {
          t1Change = 52;
          addSystemMessage(`💀 FAILED COAT! Team 1 gets 52 points as penalty!`);
        }
      }
    }
  } else {
    const bidVal = parseInt(bidStr, 10);
    if (bidderTeam === 1) {
      const success = t1Tricks >= bidVal;
      if (success) {
        t1Change = bidVal;
        addSystemMessage(`✅ Team 1 completed their bid of ${bidVal} and gets +${bidVal} points!`);
      } else {
        t2Change = bidVal * 2;
        addSystemMessage(`❌ Team 1 failed their bid of ${bidVal}! Opposite Team 2 gets +${bidVal * 2} points!`);
      }
    } else {
      const success = t2Tricks >= bidVal;
      if (success) {
        t2Change = bidVal;
        addSystemMessage(`✅ Team 2 completed their bid of ${bidVal} and gets +${bidVal} points!`);
      } else {
        t1Change = bidVal * 2;
        addSystemMessage(`❌ Team 2 failed their bid of ${bidVal}! Opposite Team 1 gets +${bidVal * 2} points!`);
      }
    }
  }

  // Update scores
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

  if (room.scoreTeam1 >= 52 || room.scoreTeam2 >= 52) {
    room.phase = 'GAME_OVER';
    if (room.scoreTeam1 >= 52 && room.scoreTeam2 >= 52) {
      if (room.scoreTeam1 > room.scoreTeam2) {
        room.winnerTeam = 1;
      } else if (room.scoreTeam2 > room.scoreTeam1) {
        room.winnerTeam = 2;
      } else {
        room.winnerTeam = bidderTeam;
      }
    } else if (room.scoreTeam1 >= 52) {
      room.winnerTeam = 1;
    } else {
      room.winnerTeam = 2;
    }

    addSystemMessage(`🏆 GAME OVER! TEAM ${room.winnerTeam} WINS THE COAT MATCH WITH ${room.winnerTeam === 1 ? room.scoreTeam1 : room.scoreTeam2} POINTS!`);
  } else {
    room.phase = 'ROUND_OVER';
    addSystemMessage(`Round ${roundNum} finished. Scores are Team 1: ${room.scoreTeam1} | Team 2: ${room.scoreTeam2}`);
  }
}
