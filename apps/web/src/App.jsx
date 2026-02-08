import { useEffect, useState } from "react";
import { socket } from "./socket";

/** ------------------ Card helpers (OUTSIDE App) ------------------ **/
function cardToFilename(card) {
  if (!card?.value || !card?.suit) return null;

  const suitMap = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" };
  const valueMap = { A: "ace", J: "jack", Q: "queen", K: "king" };

  const v = valueMap[card.value] || String(card.value).toLowerCase(); // "2".."10" stays
  const s = suitMap[card.suit];
  if (!s) return null;

  return `${v}_of_${s}.png`;
}

function cardImgSrc(card) {
  const file = cardToFilename(card);
  return file ? `/cards/${file}` : null;
}

function CardView({ card, faceDown, width = 60, height = 90 }) {
  const src = faceDown ? "/cards/back.png" : cardImgSrc(card);

  return (
    <div
      style={{
        width,
        height,
        borderRadius: 10,
        border: "1px solid #333",
        overflow: "hidden",
        background: "#111",
        boxShadow: "0 6px 16px rgba(0,0,0,0.2)"
      }}
    >
      {src ? (
        <img
          src={src}
          alt="card"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          draggable={false}
        />
      ) : (
        <div
          style={{
            color: "white",
            display: "flex",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "bold"
          }}
        >
          ?
        </div>
      )}
    </div>
  );
}

/** ------------------ App ------------------ **/
export default function App() {
  const [connected, setConnected] = useState(false);

  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");

  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");

  const [hand, setHand] = useState([]);
  const [gameStarted, setGameStarted] = useState(false);

  const [picked, setPicked] = useState(null);
  const [myId, setMyId] = useState("");

  const [roundResult, setRoundResult] = useState(null);

  const [style, setStyle] = useState("golf4_standard");

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      setMyId(socket.id);
    };
    const onDisconnect = () => {
      setConnected(false);
      setMyId("");
    };
    const onRoomState = (state) => setRoom(state);
    const onError = (e) => setError(e.message || "Error");
    const onHand = (cards) => setHand(cards);
    const onGameStarted = () => setGameStarted(true);
    const onPicked = (card) => setPicked(card);
    const onRoundEnded = (data) => setRoundResult(data);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    socket.on("error", onError);
    socket.on("game:hand", onHand);
    socket.on("game:started", onGameStarted);
    socket.on("game:picked", onPicked);
    socket.on("round:ended", onRoundEnded);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onRoomState);
      socket.off("error", onError);
      socket.off("game:hand", onHand);
      socket.off("game:started", onGameStarted);
      socket.off("game:picked", onPicked);
      socket.off("round:ended", onRoundEnded);
    };
  }, []);

  const createRoom = () => {
    setError("");
    socket.emit("room:create", { name: name || "Player", style }, (res) => {
      setRoomCode(res.roomCode);
      socket.emit("room:join", { roomCode: res.roomCode, name: name || "Player" }, () => {});
    });
  };

  const joinRoom = () => {
    setError("");
    socket.emit("room:join", { roomCode: roomCode.trim(), name: name || "Player" }, () => {});
  };

  const setReady = (ready) => {
    if (!room) return;
    socket.emit("player:ready", { roomCode: room.code, ready });
  };

  const topDiscard = room?.discardTop || null;
  const cols = room?.style === "golf6_standard" ? 3 : 2;

  const myTurn = !!room?.players.find((p) => p.id === myId)?.isTurn;

  function allowDrop(e) {
    e.preventDefault();
  }

  function dragSet(e, type) {
    e.dataTransfer.setData("text/plain", type); // "deck" | "discard" | "picked"
  }

  function dragGet(e) {
    return e.dataTransfer.getData("text/plain");
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif", maxWidth: 650 }}>
      <h1>Golf Card Game</h1>

      <p>
        Server:{" "}
        <b style={{ color: connected ? "green" : "red" }}>
          {connected ? "Connected" : "Disconnected"}
        </b>
      </p>

      {error && (
        <div style={{ background: "#ffd9d9", padding: 10, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {!room ? (
        <>
          <label>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginBottom: 12 }}
            placeholder="Sushant"
          />

          <label>Style</label>
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginBottom: 12 }}
          >
            <option value="golf4_standard">4 Card — Standard</option>
            <option value="golf6_standard">6 Card — Standard</option>
            <option value="golf4_cabo">4 Card — Cabo (Power Cards)</option>
          </select>

          <button onClick={createRoom} style={{ padding: 10, width: "100%", marginBottom: 12 }}>
            Create Room
          </button>

          <label>Room Code</label>
          <input
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            style={{ display: "block", width: "100%", padding: 8, marginBottom: 12 }}
            placeholder="ABCDE"
          />

          <button onClick={joinRoom} style={{ padding: 10, width: "100%" }}>
            Join Room
          </button>
        </>
      ) : (
        <>
          <h2>Room: {room.code}</h2>

          <p style={{ color: "#555", marginTop: 4 }}>
            Style: <b>{room.style}</b>
          </p>

          <p>
            {room.players.find((p) => p.id === myId)?.isTurn ? "🟢 Your turn" : "⏳ Waiting"}
          </p>

          {room?.knock && !room?.roundEnded && (
            <p style={{ color: "#b45309" }}>
              🔔 Knocked! Final turns remaining: {room.knock.remaining}
            </p>
          )}

          {room?.roundEnded && (
            <p style={{ color: "#15803d" }}>✅ Round ended! Check scores below.</p>
          )}

          {roundResult && (
            <div style={{ marginTop: 12, padding: 10, border: "1px solid #ddd" }}>
              <h3>Round Scores</h3>
              <ul>
                {room.players.map((p) => (
                  <li key={p.id}>
                    {p.name}: {roundResult.scores?.[p.id]} (Total: {roundResult.totals?.[p.id]})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {gameStarted && (
            <>
              <h3>Your Cards</h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, 60px)`,
                  gap: 10,
                  marginBottom: 16
                }}
              >
                {hand.map((card, i) => {
                  const canSwap = gameStarted && myTurn && !!picked;

                  return (
                    <div
                      key={i}
                      onDragOver={allowDrop}
                      onDrop={(e) => {
                        const t = dragGet(e);
                        if (t !== "picked") return;
                        if (!myTurn || !picked) return;
                        socket.emit("game:swap", { roomCode: room.code, index: i });
                      }}
                      onClick={() => {
                        if (!canSwap) return;
                        socket.emit("game:swap", { roomCode: room.code, index: i });
                      }}
                      style={{
                        width: 60,
                        height: 90,
                        borderRadius: 10,
                        cursor: canSwap ? "pointer" : "default"
                      }}
                    >
                      <CardView card={card} faceDown={!card?.revealed} width={60} height={90} />
                    </div>
                  );
                })}
              </div>

              <h3>Opponents</h3>
              {room.players
                .filter((p) => p.id !== myId)
                .map((p) => (
                  <div key={p.id} style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: "bold", marginBottom: 6 }}>{p.name}</div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${cols}, 60px)`,
                        gap: 10
                      }}
                    >
                      {(p.hand || []).map((c, i) => (
                        <div key={i} style={{ width: 60, height: 90 }}>
                          <CardView card={c} faceDown={!c?.revealed} width={60} height={90} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

              <h3>Table</h3>

              <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                {/* Deck */}
                <div style={{ textAlign: "center" }}>
                  <div
                    draggable
                    onDragStart={(e) => {
                      if (!gameStarted || !myTurn || picked) return;
                      dragSet(e, "deck");
                    }}
                    title="Drag to Picked to draw"
                    style={{ display: "inline-block" }}
                  >
                    <CardView faceDown={true} width={80} height={115} />
                  </div>

                  <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
                    Deck ({room?.deckCount ?? "?"})
                  </div>

                  <button
                    disabled={!myTurn || picked}
                    onClick={() => socket.emit("game:drawDeck", { roomCode: room.code })}
                    style={{ marginTop: 8, padding: 8 }}
                  >
                    Draw
                  </button>
                </div>

                {/* Picked (drop target) */}
                <div style={{ textAlign: "center" }}>
                  <div
                    onDragOver={allowDrop}
                    onDrop={(e) => {
                      const t = dragGet(e);
                      if (!myTurn || picked) return;

                      if (t === "deck") socket.emit("game:drawDeck", { roomCode: room.code });
                      if (t === "discard") socket.emit("game:takeDiscard", { roomCode: room.code });
                    }}
                    draggable={!!picked}
                    onDragStart={(e) => {
                      if (!picked) return;
                      dragSet(e, "picked");
                    }}
                    style={{ width: 80, height: 115 }}
                    title="Drop Deck/Discard here to pick. Drag picked to swap/discard."
                  >
                    <CardView card={picked} faceDown={!picked} width={80} height={115} />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
                    Picked
                  </div>
                </div>

                {/* Knock */}
                {room?.style !== "golf6_standard" && (
                  <button
                    disabled={!myTurn || !!picked || room?.knock || room?.roundEnded}
                    onClick={() => socket.emit("game:knock", { roomCode: room.code })}
                    style={{ padding: 10 }}
                  >
                    Knock
                  </button>
                )}

                {/* Discard */}
                <div style={{ textAlign: "center" }}>
                  <div
                    draggable={!!topDiscard}
                    onDragStart={(e) => {
                      if (!gameStarted || !myTurn || picked || !topDiscard) return;
                      dragSet(e, "discard");
                    }}
                    onDragOver={allowDrop}
                    onDrop={(e) => {
                      const t = dragGet(e);
                      if (t !== "picked") return;
                      if (!myTurn || !picked) return;
                      socket.emit("game:discardPicked", { roomCode: room.code });
                    }}
                    style={{ width: 80, height: 115 }}
                    title="Drop picked here to discard"
                  >
                    {topDiscard ? (
                      <CardView card={topDiscard} faceDown={false} width={80} height={115} />
                    ) : (
                      <div
                        style={{
                          width: 80,
                          height: 115,
                          border: "1px solid #333",
                          borderRadius: 12,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "white"
                        }}
                      >
                        Empty
                      </div>
                    )}
                  </div>

                  <button
                    disabled={!myTurn || picked || !topDiscard}
                    onClick={() => socket.emit("game:takeDiscard", { roomCode: room.code })}
                    style={{ marginTop: 8, padding: 8 }}
                  >
                    Take
                  </button>
                </div>
              </div>
            </>
          )}

          <ul style={{ marginTop: 16 }}>
            {room.players.map((p) => (
              <li key={p.id}>
                {p.name} {p.ready ? "✅" : "⏳"} {p.isTurn ? "🟢" : ""}
              </li>
            ))}
          </ul>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setReady(true)} style={{ padding: 10 }}>
              Ready
            </button>
            <button onClick={() => setReady(false)} style={{ padding: 10 }}>
              Not Ready
            </button>
          </div>
        </>
      )}
    </div>
  );
}