"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { io } from "socket.io-client";

const GOODS = {
  diamonds: { label: "Diamonds", color: 0xb91c1c, icon: "◆" },
  gold: { label: "Gold", color: 0xb7791f, icon: "●" },
  silver: { label: "Silver", color: 0x64748b, icon: "◐" },
  cloth: { label: "Cloth", color: 0x1d4ed8, icon: "▧" },
  spice: { label: "Spice", color: 0xc2410c, icon: "✦" },
  leather: { label: "Leather", color: 0x7c2d12, icon: "⬟" },
  camel: { label: "Camel", color: 0x854d0e, icon: "♞" }
};

function useAudio() {
  return useMemo(() => {
    let ctx = null;
    const play = (notes) => {
      ctx ||= new window.AudioContext();
      const now = ctx.currentTime;
      notes.forEach(([f, t, gain]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "triangle";
        o.frequency.setValueAtTime(f, now + t);
        g.gain.setValueAtTime(0.0001, now + t);
        g.gain.exponentialRampToValueAtTime(gain, now + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.18);
        o.connect(g).connect(ctx.destination);
        o.start(now + t);
        o.stop(now + t + 0.22);
      });
    };
    return {
      card: () => play([[420, 0, 0.07], [520, 0.04, 0.05]]),
      success: () => play([[660, 0, 0.08], [880, 0.05, 0.06], [990, 0.1, 0.05]]),
      error: () => play([[220, 0, 0.08], [170, 0.06, 0.06]])
    };
  }, []);
}

export default function Page() {
  const canvasRef = useRef(null);
  const pixiRef = useRef(null);
  const socketRef = useRef(null);
  const [mode, setMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [me, setMe] = useState(null);
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState({ market: new Set(), hand: new Set(), herd: new Set() });
  const [sellType, setSellType] = useState("");
  const [sellCount, setSellCount] = useState(1);
  const audio = useAudio();

  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  useEffect(() => {
    api("/api/me").then(({ user }) => setMe(user || null)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!me || socketRef.current) return;
    const socket = io();
    socketRef.current = socket;
    socket.on("game:state", (next) => {
      setGame(next);
      setSelected({ market: new Set(), hand: new Set(), herd: new Set() });
    });
    const match = window.location.pathname.match(/\/join\/([^/]+)/);
    if (match) socket.emit("game:join", { id: match[1] });
    return () => socket.close();
  }, [me]);

  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;
    const app = new Application();
    app.init({ background: "#f2eadb", resizeTo: canvasRef.current, antialias: true }).then(() => {
      if (cancelled) return;
      canvasRef.current.appendChild(app.canvas);
      pixiRef.current = app;
      drawBoard(app, game, selected);
    });
    return () => {
      cancelled = true;
      if (pixiRef.current) {
        pixiRef.current.destroy(true, { children: true });
        pixiRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (pixiRef.current) drawBoard(pixiRef.current, game, selected, setSelected, audio, me?.id);
    const myHandTypes = new Set((game?.players.find((p) => p.id === me?.id)?.hand || []).map((c) => c.type));
    if (!myHandTypes.has(sellType)) setSellType([...myHandTypes][0] || "");
  }, [game, selected, me, sellType, audio]);

  const myTurn = game && me && game.status === "playing" && game.currentPlayerId === me.id;
  const inviteUrl = game ? `${typeof window !== "undefined" ? window.location.origin : ""}/join/${game.id}` : "";

  const act = (action, payload = {}) => {
    if (!socketRef.current || !game) return;
    socketRef.current.emit("game:action", { id: game.id, action, payload }, (reply) => {
      if (!reply?.ok) return audio.error();
      audio.success();
    });
  };

  const onAuth = async (event) => {
    event.preventDefault();
    setAuthError("");
    const form = new FormData(event.currentTarget);
    try {
      const data = await api(`/api/${mode}`, {
        method: "POST",
        body: JSON.stringify({ name: form.get("name"), password: form.get("password") })
      });
      setMe(data.user);
      audio.success();
    } catch (error) {
      setAuthError(error.message);
      audio.error();
    }
  };

  const createGame = async () => {
    const { game: created } = await api("/api/games", { method: "POST", body: "{}" });
    setGame(created);
    socketRef.current?.emit("game:join", { id: created.id });
  };

  const copyInvite = async () => {
    if (inviteUrl) await navigator.clipboard.writeText(inviteUrl);
  };

  const doLogout = async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    window.location.href = "/";
  };

  if (!me) {
    return (
      <main className="auth-wrap">
        <form className="auth-card" onSubmit={onAuth}>
          <h1>Jaipur</h1>
          <div className="mode-row">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Login</button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Register</button>
          </div>
          <input name="name" required maxLength={24} placeholder="Player name" />
          <input name="password" type="password" required minLength={6} placeholder="Password" />
          <button type="submit">{mode === "login" ? "Login" : "Create account"}</button>
          <p>{authError}</p>
        </form>
      </main>
    );
  }

  return (
    <main className="game-wrap">
      <header className="bar">
        <span>{me.name}</span>
        <button onClick={doLogout}>Logout</button>
      </header>
      <section className="controls">
        <button onClick={createGame}>Open Session</button>
        <input readOnly value={inviteUrl} />
        <button onClick={copyInvite}>Copy</button>
      </section>
      <section className="actions">
        <button disabled={!myTurn || selected.market.size !== 1} onClick={() => act("takeOne", { cardId: [...selected.market][0] })}>Take Selected</button>
        <button disabled={!myTurn} onClick={() => act("takeCamels")}>Take Camels</button>
        <select value={sellType} onChange={(e) => setSellType(e.target.value)}>
          {[...new Set((game?.players.find((p) => p.id === me.id)?.hand || []).map((c) => c.type))].map((type) => (
            <option key={type} value={type}>{GOODS[type].label}</option>
          ))}
        </select>
        <input type="number" min="1" max="7" value={sellCount} onChange={(e) => setSellCount(Number(e.target.value))} />
        <button disabled={!myTurn || !sellType} onClick={() => act("sell", { type: sellType, count: sellCount })}>Sell</button>
        <button disabled={!myTurn} onClick={() => act("exchange", { marketIds: [...selected.market], handIds: [...selected.hand], herdIds: [...selected.herd] })}>Exchange</button>
      </section>
      <div ref={canvasRef} className="board" />
    </main>
  );
}

function drawBoard(app, game, selected, setSelected, audio, meId) {
  app.stage.removeChildren();
  if (!game) return;

  const container = new Container();
  app.stage.addChild(container);
  const width = app.screen.width;
  const cardW = Math.max(96, Math.floor(width / 9));
  const cardH = Math.floor(cardW * 1.35);

  const titleStyle = new TextStyle({ fill: 0x1f2937, fontSize: 20, fontWeight: "700" });
  const labelStyle = new TextStyle({ fill: 0x334155, fontSize: 14, fontWeight: "600" });
  const info = new Text(`Game ${game.id}  Deck ${game.deckCount}  Turn ${game.status === "playing" ? (game.players.find((p) => p.id === game.currentPlayerId)?.name || "-") : game.status}`, titleStyle);
  info.position.set(16, 12);
  container.addChild(info);

  const drawRow = (cards, y, area, title) => {
    const t = new Text(title, labelStyle);
    t.position.set(16, y - 24);
    container.addChild(t);
    cards.forEach((card, i) => {
      const x = 16 + i * (cardW + 10);
      const meta = GOODS[card.type];
      const cardG = new Graphics().roundRect(0, 0, cardW, cardH, 12).fill(0xfffbeb).stroke({ color: meta.color, width: 3 });
      cardG.position.set(x, y);
      cardG.eventMode = "static";
      cardG.cursor = "pointer";
      if (selected[area]?.has(card.id)) {
        const halo = new Graphics().roundRect(-4, -4, cardW + 8, cardH + 8, 14).stroke({ color: 0x0f766e, width: 4 });
        cardG.addChild(halo);
      }
      const icon = new Text(meta.icon, new TextStyle({ fill: meta.color, fontSize: Math.floor(cardW / 2), fontWeight: "700" }));
      icon.anchor.set(0.5);
      icon.position.set(cardW / 2, cardH / 2 - 12);
      cardG.addChild(icon);
      const name = new Text(meta.label, new TextStyle({ fill: 0x111827, fontSize: 14, fontWeight: "700" }));
      name.anchor.set(0.5);
      name.position.set(cardW / 2, cardH - 22);
      cardG.addChild(name);
      cardG.on("pointertap", () => {
        if (!setSelected) return;
        setSelected((prev) => {
          const next = { market: new Set(prev.market), hand: new Set(prev.hand), herd: new Set(prev.herd) };
          if (next[area].has(card.id)) next[area].delete(card.id);
          else next[area].add(card.id);
          audio?.card();
          return next;
        });
      });
      container.addChild(cardG);
    });
  };

  const me = game.players.find((player) => player.id === meId) || game.players[0];
  drawRow(game.market, 72, "market", "Market");
  drawRow(me.hand || [], 72 + cardH + 64, "hand", "Your Hand");
  drawRow(me.herd || [], 72 + (cardH + 64) * 2, "herd", "Camels");
}
