import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("OK");
});

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins }
});

// roomCode -> room object
const rooms = new Map();

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function layoutSize(style) {
  return style === "golf6_standard" ? 6 : 4; // default 4 for golf4_standard and golf4_cabo
}

/** ------------------ Deck helpers ------------------ **/
function createDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const values = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const deck = [];

  for (const s of suits) {
    for (const v of values) deck.push({ suit: s, value: v });
  }

  // shuffle (Fisher–Yates)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

/** ------------------ Scoring ------------------ **/
function cardPoints4(card) {
  if (!card) return 0;
  const v = card.value;
  if (v === "A") return 1;
  if (v === "K") return 0;
  if (v === "J" || v === "Q") return 10;
  if (v === "10") return 10;
  return Number(v);
}

function handScore4(hand) {
  if (!Array.isArray(hand) || hand.length !== 4) return 0;

  // layout:
  // [0 1]
  // [2 3]
  const c0 = hand[0], c1 = hand[1], c2 = hand[2], c3 = hand[3];

  const colLeft =
    (c0?.value && c2?.value && c0.value === c2.value)
      ? 0
      : cardPoints4(c0) + cardPoints4(c2);

  const colRight =
    (c1?.value && c3?.value && c1.value === c3.value)
      ? 0
      : cardPoints4(c1) + cardPoints4(c3);

  return colLeft + colRight;
}

// 6-card scoring: A=1, 2=-2, 3-10 face value, J/Q=10, K=0
function cardPoints6(card) {
  if (!card) return 0;
  const v = card.value;
  if (v === "A") return 1;
  if (v === "2") return -2;
  if (v === "K") return 0;
  if (v === "J" || v === "Q") return 10;
  if (v === "10") return 10;
  return Number(v); // 3..9
}

// layout 2 rows x 3 cols: [0 1 2] / [3 4 5]
// same-column pair cancels to 0 for that column
function handScore6(hand) {
  if (!Array.isArray(hand) || hand.length !== 6) return 0;

  let total = 0;
  for (let col = 0; col < 3; col++) {
    const top = hand[col];
    const bottom = hand[col + 3];
    if (top?.value && bottom?.value && top.value === bottom.value) {
      total += 0;
    } else {
      total += cardPoints6(top) + cardPoints6(bottom);
    }
  }
  return total;
}

/** ------------------ Public room state ------------------ **/
function publicRoomState(room) {
  return {
    code: room.code,
    started: room.started,
    turnIndex: room.turnIndex,
    deckCount: room.deck ? room.deck.length : 0,
    style: room.style,
    roundEnded: !!room.roundEnded,
    knock: room.knock || null,
    caller: room.caller || null,

    discardTop:
      room.discard && room.discard.length > 0
        ? room.discard[room.discard.length - 1]
        : null,

    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      isTurn: !!p.isTurn,
      // only send revealed card info; hidden cards become {revealed:false}
      hand: Array.isArray(p.hand)
        ? p.hand.map((c) => (c?.revealed ? c : { revealed: false }))
        : []
    }))
  };
}

function emitRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  io.to(roomCode).emit("room:state", publicRoomState(room));
}

/** ------------------ Round end ------------------ **/
function endRound(room) {
  room.roundEnded = true;

  // reveal everyone’s cards
  for (const p of room.players) {
    if (Array.isArray(p.hand)) {
      for (const c of p.hand) {
        if (c) c.revealed = true;
      }
    }
  }

  // calculate round scores
  const scores = {};
  for (const p of room.players) {
    if (room.style === "golf6_standard") {
      scores[p.id] = handScore6(p.hand);
    } else {
      // golf4_standard and golf4_cabo treated same for now
      scores[p.id] = handScore4(p.hand);
    }
  }

  // Optional standard rule: if knocker is NOT the lowest, add +10 penalty
  if (room.knock?.knockerId) {
    const knockerId = room.knock.knockerId;
    const knockerScore = scores[knockerId];

    let lowest = Infinity;
    for (const id of Object.keys(scores)) lowest = Math.min(lowest, scores[id]);

    if (knockerScore !== lowest) {
      scores[knockerId] += 10;
    }
  }

  // track totals
  if (!room.totals) room.totals = {};
  for (const id of Object.keys(scores)) {
    room.totals[id] = (room.totals[id] || 0) + scores[id];
  }

  room.lastRoundScores = scores;

  // stop turns
  for (const p of room.players) p.isTurn = false;

  emitRoomState(room.code);
  io.to(room.code).emit("round:ended", { scores, totals: room.totals });
}

/** ------------------ Turn advance logic ------------------ **/
function nextTurn(room) {
  const oldIndex = room.turnIndex;
  const endedPlayerId = room.players[oldIndex]?.id;

  room.players[oldIndex].isTurn = false;
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.players[room.turnIndex].isTurn = true;

  // 6-card end condition: after someone "calls" (all cards revealed),
  // each other player gets one final turn, then round ends.
  if (room.style === "golf6_standard" && room.caller && !room.roundEnded) {
    if (endedPlayerId && endedPlayerId !== room.caller.callerId) {
      room.caller.remaining -= 1;
    }

    const nowId = room.players[room.turnIndex]?.id;
    if (room.caller.remaining <= 0 && nowId === room.caller.callerId) {
      endRound(room);
      return;
    }
  }

  // 4-card knock end condition:
  // after someone knocks, each other player gets one final turn, then round ends.
  if (room.style !== "golf6_standard" && room.knock && !room.roundEnded) {
    if (endedPlayerId && endedPlayerId !== room.knock.knockerId) {
      room.knock.remaining -= 1;
    }

    const nowId = room.players[room.turnIndex]?.id;
    if (room.knock.remaining <= 0 && nowId === room.knock.knockerId) {
      endRound(room);
      return;
    }
  }

  emitRoomState(room.code);
}

/** ------------------ Game start ------------------ **/
function tryStartGame(room) {
  if (room.started) return;
  if (room.players.length < 2) return;

  const allReady = room.players.every((p) => p.ready);
  if (!allReady) return;

  room.started = true;
  room.roundEnded = false;
  room.caller = null; // { callerId, remaining }
  room.knock = null; // { knockerId, remaining }

  room.picked = {}; // socketId -> card privately held
  room.discard = [];
  room.deck = createDeck();

  // clear hands
  for (const p of room.players) p.hand = [];

  const n = layoutSize(room.style);

  // deal n cards to each player
  for (let i = 0; i < n; i++) {
    for (const p of room.players) {
      p.hand.push({ ...room.deck.pop(), revealed: false });
    }
  }

  // set discard pile top
  const firstDiscard = room.deck.pop();
  if (firstDiscard) room.discard.push(firstDiscard);

  // set turn
  room.turnIndex = 0;
  for (let i = 0; i < room.players.length; i++) {
    room.players[i].isTurn = i === room.turnIndex;
  }

  // reveal first 2 cards of each player
  for (const p of room.players) {
    if (p.hand[0]) p.hand[0].revealed = true;
    if (p.hand[1]) p.hand[1].revealed = true;
  }

  emitRoomState(room.code);

  // send private full hands
  for (const p of room.players) {
    io.to(p.id).emit("game:hand", p.hand);
  }

  io.to(room.code).emit("game:started");
}

/** ------------------ Socket handlers ------------------ **/
io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on("room:create", ({ name, style }, cb) => {
    let code = makeRoomCode();
    while (rooms.has(code)) code = makeRoomCode();

    const room = {
      code,
      style: style || "golf4_standard",
      players: [
        { id: socket.id, name: name || "Player", ready: false, hand: [], isTurn: false }
      ],
      started: false,
      roundEnded: false,
      deck: [],
      discard: [],
      picked: {},
      turnIndex: 0,
      totals: {}
    };

    rooms.set(code, room);
    socket.join(code);

    if (typeof cb === "function") cb({ roomCode: code });
    emitRoomState(code);
  });

  socket.on("room:join", ({ roomCode, name }, cb) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit("error", { message: "Room not found" });
      return;
    }

    const already = room.players.some((p) => p.id === socket.id);
    if (!already) {
      room.players.push({
        id: socket.id,
        name: name || "Player",
        ready: false,
        hand: [],
        isTurn: false
      });
    }

    socket.join(code);
    if (typeof cb === "function") cb({ ok: true });
    emitRoomState(code);

    // if game already started, send the joining player's hand (if exists)
    const p = room.players.find((x) => x.id === socket.id);
    if (room.started && p) {
      io.to(socket.id).emit("game:hand", p.hand);
      io.to(socket.id).emit("game:started");
    }
  });

  socket.on("player:ready", ({ roomCode, ready }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms.get(code);
    if (!room) return;

    const p = room.players.find((x) => x.id === socket.id);
    if (!p) return;

    p.ready = !!ready;
    emitRoomState(code);
    tryStartGame(room);
  });

  socket.on("game:drawDeck", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.started || room.roundEnded) return;

    const current = room.players[room.turnIndex];
    if (!current || current.id !== socket.id) return;
    if (room.picked?.[socket.id]) return;
    if (room.deck.length === 0) return;

    const card = room.deck.pop();
    room.picked[socket.id] = card;

    io.to(socket.id).emit("game:picked", card);
    emitRoomState(code);
  });

  socket.on("game:takeDiscard", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.started || room.roundEnded) return;

    const current = room.players[room.turnIndex];
    if (!current || current.id !== socket.id) return;
    if (room.picked?.[socket.id]) return;
    if (!room.discard || room.discard.length === 0) return;

    const card = room.discard.pop();
    room.picked[socket.id] = card;

    io.to(socket.id).emit("game:picked", card);
    emitRoomState(code);
  });

  socket.on("game:swap", ({ roomCode, index }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.started || room.roundEnded) return;

    const current = room.players[room.turnIndex];
    if (!current || current.id !== socket.id) return;

    const pickedCard = room.picked?.[socket.id];
    if (!pickedCard) return;

    const n = layoutSize(room.style);
    if (!Number.isInteger(index) || index < 0 || index >= n) return;
    if (!Array.isArray(current.hand) || current.hand.length !== n) return;

    const outgoing = current.hand[index];

    current.hand[index] = { ...pickedCard, revealed: true };
    delete room.picked[socket.id];

    // 6-card end trigger: first player to have all revealed becomes caller
    if (room.style === "golf6_standard" && !room.roundEnded) {
      const allUp = current.hand.every((c) => c && c.revealed);
      if (allUp && !room.caller) {
        room.caller = { callerId: current.id, remaining: room.players.length - 1 };
      }
    }

    if (outgoing) room.discard.push(outgoing);

    io.to(socket.id).emit("game:hand", current.hand);
    io.to(socket.id).emit("game:picked", null);

    nextTurn(room);
  });

  socket.on("game:discardPicked", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.started || room.roundEnded) return;

    const current = room.players[room.turnIndex];
    if (!current || current.id !== socket.id) return;

    const pickedCard = room.picked?.[socket.id];
    if (!pickedCard) return;

    room.discard.push(pickedCard);
    delete room.picked[socket.id];

    io.to(socket.id).emit("game:picked", null);
    nextTurn(room);
  });

  socket.on("game:knock", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const room = rooms.get(code);

    if (!room || !room.started || room.roundEnded) return;
    if (room.style === "golf6_standard") return;

    const current = room.players[room.turnIndex];
    if (!current || current.id !== socket.id) return;
    if (room.picked?.[socket.id]) return; // can't knock while holding picked
    if (room.knock) return; // only once

    room.knock = { knockerId: socket.id, remaining: room.players.length - 1 };

    emitRoomState(room.code);

    // knocking ends your turn immediately
    nextTurn(room);
  });

  socket.on("disconnect", () => {
    console.log("disconnected:", socket.id);

    for (const [code, room] of rooms) {
      const before = room.players.length;
      room.players = room.players.filter((p) => p.id !== socket.id);

      if (room.players.length !== before) {
        if (room.players.length === 0) {
          rooms.delete(code);
        } else {
          // fix turnIndex if needed
          if (room.turnIndex >= room.players.length) room.turnIndex = 0;
          emitRoomState(code);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`server running on http://localhost:${PORT}`);
});