import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import http from "node:http";
import path from "node:path";
import bcrypt from "bcryptjs";
import cookie from "cookie";
import { nanoid } from "nanoid";
import pg from "pg";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT || 8080);
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-jaipur-secret";
const DATABASE_URL = process.env.DATABASE_URL || "postgres://jaipur:jaipur@localhost:5432/jaipur";
const FRONTEND_OUT = path.join(process.cwd(), "frontend", "out");

const app = express();
const server = http.createServer(app);
const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });
const PgSessionStore = connectPgSimple(session);
const sessionMiddleware = session({
  store: new PgSessionStore({
    pool,
    createTableIfMissing: true,
    tableName: "sessions"
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
});

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: "64kb" }));
app.use(sessionMiddleware);
app.use(express.static(FRONTEND_OUT));

const io = new Server(server, {
  cors: { origin: false }
});

const goods = {
  diamonds: { label: "Diamonds", count: 6, tokenValues: [7, 7, 5, 5, 5], minimumSale: 2 },
  gold: { label: "Gold", count: 6, tokenValues: [6, 6, 5, 5, 5], minimumSale: 2 },
  silver: { label: "Silver", count: 6, tokenValues: [5, 5, 5, 5, 5], minimumSale: 2 },
  cloth: { label: "Cloth", count: 8, tokenValues: [5, 3, 3, 2, 2, 1, 1], minimumSale: 1 },
  spice: { label: "Spice", count: 8, tokenValues: [5, 3, 3, 2, 2, 1, 1], minimumSale: 1 },
  leather: { label: "Leather", count: 10, tokenValues: [4, 3, 2, 1, 1, 1, 1, 1, 1], minimumSale: 1 }
};

const bonusValues = {
  3: [3, 2, 2, 1, 1, 1, 1],
  4: [6, 6, 5, 5, 4, 4],
  5: [10, 10, 9, 8, 8]
};

const rooms = new Map();
const socketUsers = new Map();

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      name_key TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function publicUser(user) {
  return user ? { id: user.id, name: user.name } : null;
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Login required." });
  next();
}

function shuffle(cards) {
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function buildDeck() {
  const cards = [];
  for (const [type, config] of Object.entries(goods)) {
    for (let i = 0; i < config.count; i += 1) cards.push({ id: nanoid(8), type });
  }
  for (let i = 0; i < 8; i += 1) cards.push({ id: nanoid(8), type: "camel" });
  return shuffle(cards);
}

function draw(game) {
  return game.deck.shift() || null;
}

function drawNonCamel(game) {
  for (let i = 0; i < game.deck.length; i += 1) {
    if (game.deck[i].type !== "camel") {
      return game.deck.splice(i, 1)[0];
    }
  }
  return draw(game);
}

function createGame(host) {
  const deck = buildDeck();
  const game = {
    id: nanoid(7).toUpperCase(),
    status: "waiting",
    players: [{ ...host, hand: [], herd: [], gold: 0 }],
    deck,
    market: [],
    tokens: Object.fromEntries(Object.entries(goods).map(([type, config]) => [type, [...config.tokenValues]])),
    bonus: {
      3: shuffle(bonusValues[3]),
      4: shuffle(bonusValues[4]),
      5: shuffle(bonusValues[5])
    },
    current: 0,
    log: [],
    winnerId: null,
    finalReason: ""
  };
  rooms.set(game.id, game);
  return game;
}

function startGame(game, guest) {
  if (game.status !== "waiting") throw new Error("This session already started.");
  if (game.players.some((player) => player.id === guest.id)) throw new Error("You are already in this session.");
  game.players.push({ ...guest, hand: [], herd: [], gold: 0 });
  for (const player of game.players) {
    for (let i = 0; i < 5; i += 1) {
      const card = draw(game);
      if (card?.type === "camel") player.herd.push(card);
      else if (card) player.hand.push(card);
    }
  }
  game.market = [{ id: nanoid(8), type: "camel" }, { id: nanoid(8), type: "camel" }, { id: nanoid(8), type: "camel" }];
  game.market.push(drawNonCamel(game), drawNonCamel(game));
  game.market = game.market.filter(Boolean);
  game.status = "playing";
  game.log.unshift(`${guest.name} joined. The market opens.`);
}

function fillMarket(game) {
  while (game.market.length < 5 && game.deck.length) {
    const card = draw(game);
    if (card) game.market.push(card);
  }
}

function handCount(player, type) {
  return player.hand.filter((card) => card.type === type).length;
}

function removeCards(cards, ids) {
  const idSet = new Set(ids);
  const removed = [];
  const kept = [];
  for (const card of cards) {
    if (idSet.has(card.id)) removed.push(card);
    else kept.push(card);
  }
  return { removed, kept };
}

function endTurn(game) {
  const emptyStacks = Object.values(game.tokens).filter((stack) => stack.length === 0).length;
  if (emptyStacks >= 3 || (game.deck.length === 0 && game.market.length < 5)) {
    game.status = "finished";
    const camelCounts = game.players.map((player) => player.herd.length);
    const largestHerd = Math.max(...camelCounts);
    const tied = camelCounts.filter((count) => count === largestHerd).length > 1;
    if (!tied) game.players[camelCounts.indexOf(largestHerd)].gold += 5;
    const high = Math.max(...game.players.map((player) => player.gold));
    const winners = game.players.filter((player) => player.gold === high);
    game.winnerId = winners.length === 1 ? winners[0].id : null;
    game.finalReason = emptyStacks >= 3 ? "Three goods token stacks are empty." : "The deck cannot refill the market.";
    game.log.unshift(`Game over. ${game.finalReason}`);
    return;
  }
  game.current = (game.current + 1) % 2;
}

function assertTurn(game, userId) {
  if (!game || game.status !== "playing") throw new Error("This game is not active.");
  if (game.players[game.current].id !== userId) throw new Error("It is not your turn.");
}

function takeOne(game, userId, cardId) {
  assertTurn(game, userId);
  const player = game.players[game.current];
  const index = game.market.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error("That card is no longer in the market.");
  const [card] = game.market.splice(index, 1);
  if (card.type === "camel") throw new Error("Use take camels to collect camels.");
  if (player.hand.length >= 7) throw new Error("Your hand is full.");
  player.hand.push(card);
  fillMarket(game);
  game.log.unshift(`${player.name} took one ${goods[card.type].label.toLowerCase()} card.`);
  endTurn(game);
}

function takeCamels(game, userId) {
  assertTurn(game, userId);
  const player = game.players[game.current];
  const camels = game.market.filter((card) => card.type === "camel");
  if (!camels.length) throw new Error("There are no camels in the market.");
  game.market = game.market.filter((card) => card.type !== "camel");
  player.herd.push(...camels);
  fillMarket(game);
  game.log.unshift(`${player.name} took ${camels.length} camel${camels.length === 1 ? "" : "s"}.`);
  endTurn(game);
}

function exchange(game, userId, marketIds, handIds, herdIds) {
  assertTurn(game, userId);
  const player = game.players[game.current];
  const wanted = new Set(marketIds);
  const marketCards = game.market.filter((card) => wanted.has(card.id));
  if (marketCards.length !== marketIds.length || marketCards.length < 2) {
    throw new Error("Exchange at least two market cards.");
  }
  const handResult = removeCards(player.hand, handIds);
  const herdResult = removeCards(player.herd, herdIds);
  const offered = [...handResult.removed, ...herdResult.removed];
  if (offered.length !== marketCards.length) throw new Error("Exchange the same number of cards.");
  const nextHandCount = handResult.kept.length + marketCards.filter((card) => card.type !== "camel").length;
  if (nextHandCount > 7) throw new Error("That exchange would exceed the seven-card hand limit.");
  player.hand = [...handResult.kept, ...marketCards.filter((card) => card.type !== "camel")];
  player.herd = [...herdResult.kept, ...marketCards.filter((card) => card.type === "camel")];
  game.market = game.market.filter((card) => !wanted.has(card.id));
  game.market.push(...offered);
  game.log.unshift(`${player.name} exchanged ${offered.length} cards with the market.`);
  endTurn(game);
}

function sell(game, userId, type, count) {
  assertTurn(game, userId);
  const player = game.players[game.current];
  if (!goods[type]) throw new Error("Unknown goods type.");
  const config = goods[type];
  if (count < config.minimumSale) throw new Error(`${config.label} must be sold in sets of at least ${config.minimumSale}.`);
  if (handCount(player, type) < count) throw new Error("You do not have enough matching cards.");
  const soldIds = player.hand.filter((card) => card.type === type).slice(0, count).map((card) => card.id);
  player.hand = player.hand.filter((card) => !soldIds.includes(card.id));
  let gained = 0;
  for (let i = 0; i < count; i += 1) gained += game.tokens[type].shift() || 0;
  const bonusKey = Math.min(count, 5);
  const bonus = count >= 3 ? game.bonus[bonusKey].shift() || 0 : 0;
  player.gold += gained + bonus;
  game.log.unshift(`${player.name} sold ${count} ${config.label.toLowerCase()} for ${gained + bonus} gold.`);
  endTurn(game);
}

function visibleState(game, userId) {
  const currentPlayer = game.players[game.current];
  return {
    id: game.id,
    status: game.status,
    inviteUrl: `/join/${game.id}`,
    currentPlayerId: currentPlayer?.id || null,
    winnerId: game.winnerId,
    finalReason: game.finalReason,
    market: game.market,
    deckCount: game.deck.length,
    tokens: game.tokens,
    bonusCounts: Object.fromEntries(Object.entries(game.bonus).map(([key, stack]) => [key, stack.length])),
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      gold: player.gold,
      handCount: player.hand.length,
      herdCount: player.herd.length,
      hand: player.id === userId ? player.hand : [],
      herd: player.id === userId ? player.herd : []
    })),
    log: game.log.slice(0, 8)
  };
}

function emitGame(game) {
  for (const player of game.players) {
    io.to(`user:${player.id}`).emit("game:state", visibleState(game, player.id));
  }
}

app.post("/api/register", async (req, res) => {
  const name = cleanName(req.body.name);
  const password = String(req.body.password || "");
  if (name.length < 2 || password.length < 6) {
    return res.status(400).json({ error: "Use a name with 2+ characters and a password with 6+ characters." });
  }
  const nameKey = name.toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query(
      "INSERT INTO users (id, name, name_key, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name",
      [nanoid(12), name, nameKey, passwordHash]
    );
    req.session.user = publicUser(result.rows[0]);
    res.json({ user: req.session.user });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "That name is already registered." });
    }
    console.error(error);
    res.status(500).json({ error: "Could not register right now." });
  }
});

app.post("/api/login", async (req, res) => {
  const name = cleanName(req.body.name);
  const password = String(req.body.password || "");
  const result = await pool.query(
    "SELECT id, name, password_hash FROM users WHERE name_key = $1",
    [name.toLowerCase()]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Name or password is wrong." });
  }
  req.session.user = publicUser(user);
  res.json({ user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/games", requireLogin, (req, res) => {
  const game = createGame(req.session.user);
  res.json({ game: visibleState(game, req.session.user.id) });
});

app.get("/join/:id", (req, res) => {
  res.sendFile(path.join(FRONTEND_OUT, "index.html"));
});

io.engine.use((req, res, next) => {
  sessionMiddleware(req, res, next);
});

io.use((socket, next) => {
  const parsed = cookie.parse(socket.handshake.headers.cookie || "");
  if (!parsed["connect.sid"] && !socket.request.session?.user) return next(new Error("Login required."));
  if (!socket.request.session?.user) return next(new Error("Login required."));
  next();
});

io.on("connection", (socket) => {
  const user = socket.request.session.user;
  socketUsers.set(socket.id, user);
  socket.join(`user:${user.id}`);

  socket.on("game:join", ({ id }, reply) => {
    try {
      const game = rooms.get(String(id || "").toUpperCase());
      if (!game) throw new Error("Game not found.");
      if (game.status === "waiting" && !game.players.some((player) => player.id === user.id)) startGame(game, user);
      if (!game.players.some((player) => player.id === user.id)) throw new Error("This game already has two players.");
      socket.join(`game:${game.id}`);
      emitGame(game);
      reply?.({ ok: true, game: visibleState(game, user.id) });
    } catch (error) {
      reply?.({ ok: false, error: error.message });
    }
  });

  socket.on("game:action", ({ id, action, payload }, reply) => {
    try {
      const game = rooms.get(String(id || "").toUpperCase());
      if (!game) throw new Error("Game not found.");
      if (action === "takeOne") takeOne(game, user.id, payload.cardId);
      else if (action === "takeCamels") takeCamels(game, user.id);
      else if (action === "exchange") exchange(game, user.id, payload.marketIds || [], payload.handIds || [], payload.herdIds || []);
      else if (action === "sell") sell(game, user.id, payload.type, Number(payload.count));
      else throw new Error("Unknown action.");
      emitGame(game);
      reply?.({ ok: true });
    } catch (error) {
      reply?.({ ok: false, error: error.message });
    }
  });

  socket.on("disconnect", () => {
    socketUsers.delete(socket.id);
  });
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
    return res.status(404).end();
  }
  return res.sendFile(path.join(FRONTEND_OUT, "index.html"));
});

await initDatabase();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Jaipur listening on ${PORT}`);
});
