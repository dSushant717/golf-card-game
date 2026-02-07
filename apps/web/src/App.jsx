import { useEffect, useState } from "react";
import { socket } from "./socket";

export default function App() {
  const [connected, setConnected] = useState(false);

  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");

  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");

  const [hand, setHand] = useState([]);
  const [gameStarted, setGameStarted] = useState(false);



  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onRoomState = (state) => setRoom(state);
    const onError = (e) => setError(e.message || "Error");
    const onHand = (cards) => setHand(cards);
    const onGameStarted = () => setGameStarted(true);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    socket.on("error", onError);
    socket.on("game:hand", onHand);
    socket.on("game:started", onGameStarted)

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onRoomState);
      socket.off("error", onError);
      socket.off("game:hand", onHand);
      socket.off("game:started", onGameStarted);
    };
  }, []);

  const createRoom = () => {
    setError("");
    socket.emit("room:create", { name: name || "Player" }, (res) => {
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

          <h3>Players</h3>
          {gameStarted && (
            <>
              <h3>Your Cards</h3>
              <div style={{ display: "flex", gap: 10 }}>
                {hand.map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: 60,
                      height: 90,
                      border: "1px solid #333",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#2e7d32",
                      color: "white"
                    }}
                  >
                    ?
                  </div>
                ))}
              </div>
            </>
          )}
          <ul>
            {room.players.map((p) => (
              <li key={p.id}>
                {p.name} {p.ready ? "✅" : "⏳"}
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

          <p style={{ marginTop: 12, color: "#555" }}>
            Open a second browser window and join with the room code to test multiplayer.
          </p>
        </>
      )}
    </div>
  );
}