const goodsMeta = {
  diamonds: { label: "Diamonds", icon: "◆", tone: "red" },
  gold: { label: "Gold", icon: "●", tone: "gold" },
  silver: { label: "Silver", icon: "◐", tone: "silver" },
  cloth: { label: "Cloth", icon: "▧", tone: "blue" },
  spice: { label: "Spice", icon: "✦", tone: "orange" },
  leather: { label: "Leather", icon: "⬟", tone: "brown" },
  camel: { label: "Camel", icon: "♞", tone: "sand" }
};

const authPanel = document.querySelector("#auth-panel");
const gameShell = document.querySelector("#game-shell");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const authSubmit = document.querySelector("#auth-submit");
const authMode = document.querySelector("#auth-mode");
const showLogin = document.querySelector("#show-login");
const showRegister = document.querySelector("#show-register");
const registerNow = document.querySelector("#register-now");
const meName = document.querySelector("#me-name");
const inviteLink = document.querySelector("#invite-link");
const createGame = document.querySelector("#create-game");
const copyInvite = document.querySelector("#copy-invite");
const logout = document.querySelector("#logout");
const marketEl = document.querySelector("#market");
const handEl = document.querySelector("#hand");
const herdEl = document.querySelector("#herd");
const scoreRow = document.querySelector("#score-row");
const tokenEl = document.querySelector("#tokens");
const logEl = document.querySelector("#log");
const toastEl = document.querySelector("#toast");
const deckCount = document.querySelector("#deck-count");
const turnName = document.querySelector("#turn-name");
const gameCode = document.querySelector("#game-code");
const takeOne = document.querySelector("#take-one");
const takeCamels = document.querySelector("#take-camels");
const sellType = document.querySelector("#sell-type");
const sellCount = document.querySelector("#sell-count");
const sellButton = document.querySelector("#sell");
const exchangeButton = document.querySelector("#exchange");
const resultEl = document.querySelector("#result");

let mode = "login";
let me = null;
let socket = null;
let currentGame = null;
let selectedMarket = new Set();
let selectedHand = new Set();
let selectedHerd = new Set();

const audio = {
  ctx: null,
  play(kind) {
    this.ctx ||= new AudioContext();
    const now = this.ctx.currentTime;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const settings = {
      card: [440, 0.045],
      coin: [880, 0.08],
      error: [140, 0.12],
      start: [660, 0.11]
    }[kind] || [420, 0.05];
    oscillator.type = kind === "error" ? "sawtooth" : "triangle";
    oscillator.frequency.setValueAtTime(settings[0], now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + settings[1]);
    oscillator.connect(gain).connect(this.ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + settings[1] + 0.02);
  }
};

function toast(message, kind = "card") {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  audio.play(kind);
  window.clearTimeout(toastEl.timer);
  toastEl.timer = window.setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function setMode(next) {
  mode = next;
  showLogin.classList.toggle("active", mode === "login");
  showRegister.classList.toggle("active", mode === "register");
  authSubmit.textContent = mode === "login" ? "Login" : "Register";
  registerNow.textContent = mode === "login" ? "Create account" : "Use existing login";
  authMode.textContent = mode === "login" ? "Login to continue" : "Create your player account";
  document.querySelector("#password").autocomplete = mode === "login" ? "current-password" : "new-password";
  authMessage.textContent = "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function connectSocket() {
  socket = io();
  socket.on("connect_error", () => toast("Login required before joining a game.", "error"));
  socket.on("game:state", (game) => {
    currentGame = game;
    selectedMarket.clear();
    selectedHand.clear();
    selectedHerd.clear();
    renderGame();
  });
}

function showApp(user) {
  me = user;
  meName.textContent = user.name;
  authPanel.hidden = true;
  gameShell.hidden = false;
  connectSocket();
  const joinId = location.pathname.match(/\/join\/([^/]+)/)?.[1];
  if (joinId) joinGame(joinId);
}

async function joinGame(id) {
  socket.emit("game:join", { id }, (reply) => {
    if (!reply?.ok) return toast(reply?.error || "Could not join game.", "error");
    currentGame = reply.game;
    renderGame();
    toast("Session joined.", "start");
  });
}

function cardButton(card, area) {
  const meta = goodsMeta[card.type];
  const button = document.createElement("button");
  button.className = `card ${meta.tone}`;
  button.type = "button";
  button.dataset.id = card.id;
  button.dataset.type = card.type;
  button.setAttribute("aria-pressed", String(getSelection(area).has(card.id)));
  button.innerHTML = `
    <span class="card-icon">${meta.icon}</span>
    <span class="card-name">${meta.label}</span>
  `;
  button.addEventListener("click", () => {
    const set = getSelection(area);
    if (set.has(card.id)) set.delete(card.id);
    else set.add(card.id);
    audio.play("card");
    renderGame();
  });
  return button;
}

function getSelection(area) {
  if (area === "market") return selectedMarket;
  if (area === "hand") return selectedHand;
  return selectedHerd;
}

function renderGame() {
  if (!currentGame) return;
  const players = currentGame.players;
  const myPlayer = players.find((player) => player.id === me.id);
  const active = players.find((player) => player.id === currentGame.currentPlayerId);
  const myTurn = currentGame.currentPlayerId === me.id && currentGame.status === "playing";

  gameCode.textContent = currentGame.id;
  deckCount.textContent = currentGame.deckCount;
  turnName.textContent = currentGame.status === "waiting" ? "Waiting" : active?.name || "Finished";
  inviteLink.value = `${location.origin}/join/${currentGame.id}`;
  resultEl.textContent = currentGame.status === "finished"
    ? winnerText(currentGame)
    : currentGame.status === "waiting" ? "Invite a friend to start." : "";

  scoreRow.replaceChildren(...players.map((player) => {
    const panel = document.createElement("article");
    panel.className = `score-card ${player.id === currentGame.currentPlayerId ? "active" : ""}`;
    panel.innerHTML = `
      <span>${player.name}</span>
      <strong>${player.gold} gold</strong>
      <small>${player.handCount} hand · ${player.herdCount} camels</small>
    `;
    return panel;
  }));

  marketEl.replaceChildren(...currentGame.market.map((card) => cardButton(card, "market")));
  handEl.replaceChildren(...(myPlayer?.hand || []).map((card) => cardButton(card, "hand")));
  herdEl.replaceChildren(...(myPlayer?.herd || []).map((card) => cardButton(card, "herd")));

  const sellable = [...new Set((myPlayer?.hand || []).map((card) => card.type))];
  sellType.replaceChildren(...sellable.map((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = goodsMeta[type].label;
    return option;
  }));

  tokenEl.replaceChildren(...Object.entries(currentGame.tokens).map(([type, stack]) => {
    const meta = goodsMeta[type];
    const div = document.createElement("div");
    div.className = `token ${meta.tone} ${stack.length === 0 ? "empty" : ""}`;
    div.innerHTML = `<span>${meta.label}</span><strong>${stack[0] || 0}</strong><small>${stack.length} left</small>`;
    return div;
  }));

  logEl.replaceChildren(...currentGame.log.map((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    return li;
  }));

  takeCamels.disabled = !myTurn;
  takeOne.disabled = !myTurn || selectedMarket.size !== 1;
  sellButton.disabled = !myTurn || !sellable.length;
  exchangeButton.disabled = !myTurn;
}

function winnerText(game) {
  if (game.winnerId === me.id) return `You win. ${game.finalReason}`;
  if (game.winnerId) {
    const winner = game.players.find((player) => player.id === game.winnerId);
    return `${winner?.name || "Opponent"} wins. ${game.finalReason}`;
  }
  return `Tie game. ${game.finalReason}`;
}

function action(actionName, payload = {}) {
  if (!currentGame) return toast("Open or join a session first.", "error");
  socket.emit("game:action", { id: currentGame.id, action: actionName, payload }, (reply) => {
    if (!reply?.ok) return toast(reply?.error || "Move rejected.", "error");
    toast(actionName === "sell" ? "Sale recorded." : "Move played.", actionName === "sell" ? "coin" : "card");
  });
}

showLogin.addEventListener("click", () => setMode("login"));
showRegister.addEventListener("click", () => setMode("register"));
registerNow.addEventListener("click", () => setMode(mode === "login" ? "register" : "login"));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "";
  const form = new FormData(authForm);
  try {
    const data = await api(`/api/${mode}`, {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), password: form.get("password") })
    });
    showApp(data.user);
  } catch (error) {
    authMessage.textContent = error.message;
    audio.play("error");
  }
});

createGame.addEventListener("click", async () => {
  try {
    const { game } = await api("/api/games", { method: "POST", body: "{}" });
    currentGame = game;
    socket.emit("game:join", { id: game.id }, () => {});
    renderGame();
    toast("Session opened. Share the invite link.", "start");
  } catch (error) {
    toast(error.message, "error");
  }
});

copyInvite.addEventListener("click", async () => {
  if (!inviteLink.value) return;
  await navigator.clipboard.writeText(inviteLink.value);
  toast("Invite copied.");
});

logout.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" });
  location.href = "/";
});

marketEl.addEventListener("dblclick", (event) => {
  const card = event.target.closest(".card");
  if (card && card.dataset.type !== "camel") action("takeOne", { cardId: card.dataset.id });
});

takeCamels.addEventListener("click", () => action("takeCamels"));

takeOne.addEventListener("click", () => {
  const [cardId] = selectedMarket;
  action("takeOne", { cardId });
});

sellButton.addEventListener("click", () => {
  action("sell", { type: sellType.value, count: Number(sellCount.value) });
});

exchangeButton.addEventListener("click", () => {
  action("exchange", {
    marketIds: [...selectedMarket],
    handIds: [...selectedHand],
    herdIds: [...selectedHerd]
  });
});

api("/api/me").then(({ user }) => {
  if (user) showApp(user);
}).catch(() => {});
