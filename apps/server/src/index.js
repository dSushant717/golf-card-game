import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("OK");
});

const io = new Server(httpServer, {
    cors: { origin: "http://localhost:5173" }
});

// roomCode -> { code, players: [{id,name,ready}] }
const rooms = new Map();

function makeRoomCode() {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
}

function emitRoomState(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    io.to(roomCode).emit("room:state", room);
}

function tryStartGame(room) {
    if (room.started) return;
    if (room.players.length < 2) return;

    const allReady = room.players.every(p => p.ready);
    if (!allReady) return;

    room.started = true;
    room.deck = createDeck();

    // before dealing
    for (const p of room.players) {
    p.hand = [];
    }

    // deal 4 cards to each player
    for (let i = 0; i < 4; i++) {
        for (const p of room.players) {
            p.hand.push(room.deck.pop());
        }
    }

    // send private hands
    for (const p of room.players) {
        io.to(p.id).emit("game:hand", p.hand);
    }

    // notify room game started
    io.to(room.code).emit("game:started");
}

function createDeck() {
    const suits = ["♠", "♥", "♦", "♣"];
    const values = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const deck = [];

    for (const s of suits) {
        for (const v of values) {
            deck.push({ suit: s, value: v });
        }
    }

    // shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
}

io.on("connection", (socket) => {
    console.log("connected:", socket.id);

    socket.on("room:create", ({ name }, cb) => {
        let code = makeRoomCode();
        while (rooms.has(code)) code = makeRoomCode();

        const room = {
            code,
            players: [
                {
                    id: socket.id,
                    name: name || "Player",
                    ready: false,
                    hand: [] // ← new
                }
            ],
            started: false,
            deck: []
        };

        rooms.set(code, room);
        socket.join(code);

        cb({ roomCode: code });
        emitRoomState(code);
    });

    socket.on("room:join", ({ roomCode, name }, cb) => {
        const code = (roomCode || "").toUpperCase();
        const room = rooms.get(code);
        if (!room) return socket.emit("error", { message: "Room not found" });

        // prevent duplicate entry if user refreshes quickly
        const already = room.players.some(p => p.id === socket.id);
        if (!already) {
            room.players.push({ id: socket.id, name: name || "Player", ready: false, hand: [] });
        }

        socket.join(code);
        cb({ ok: true });
        emitRoomState(code);
    });

    socket.on("player:ready", ({ roomCode, ready }) => {
        const code = (roomCode || "").toUpperCase();
        const room = rooms.get(code);
        if (!room) return;

        const p = room.players.find(x => x.id === socket.id);
        if (!p) return;

        p.ready = !!ready;
        emitRoomState(code);
        tryStartGame(room);
    });

    socket.on("disconnect", () => {
        console.log("disconnected:", socket.id);

        // remove player from any room they were in
        for (const [code, room] of rooms) {
            const before = room.players.length;
            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.players.length !== before) {
                if (room.players.length === 0) {
                    rooms.delete(code);
                } else {
                    emitRoomState(code);
                }
            }
        }
    });
});

httpServer.listen(4000, () => {
    console.log("server running on http://localhost:4000");
});