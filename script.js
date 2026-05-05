const goods = [
  { name: "Ruby", value: 22, icon: "◆", type: "ruby" },
  { name: "Gold", value: 18, icon: "●", type: "gold" },
  { name: "Silk", value: 14, icon: "✦", type: "silk" },
  { name: "Spice", value: 10, icon: "✹", type: "spice" },
  { name: "Camel", value: 6, icon: "♞", type: "camel" }
];

const state = {
  day: 1,
  rupees: 0,
  camels: 3,
  market: [],
  selected: new Set(),
  over: false
};

const market = document.querySelector("#market");
const day = document.querySelector("#day");
const rupees = document.querySelector("#rupees");
const camels = document.querySelector("#camels");
const message = document.querySelector("#message");
const trade = document.querySelector("#trade");
const rest = document.querySelector("#rest");
const newGame = document.querySelector("#new-game");

function pickGood() {
  const roll = Math.random();
  const pool = roll < 0.18 ? goods.slice(0, 2) : goods;
  return pool[Math.floor(Math.random() * pool.length)];
}

function restock() {
  state.market = Array.from({ length: 5 }, pickGood);
  state.selected.clear();
  render();
}

function render() {
  day.textContent = state.day;
  rupees.textContent = state.rupees;
  camels.textContent = state.camels;
  trade.disabled = state.over || state.selected.size === 0;
  rest.disabled = state.over;
  market.innerHTML = "";

  state.market.forEach((good, index) => {
    const card = document.createElement("button");
    card.className = `card ${good.type}`;
    card.type = "button";
    card.setAttribute("aria-pressed", String(state.selected.has(index)));
    card.innerHTML = `
      <span class="icon" aria-hidden="true">${good.icon}</span>
      <span class="name">${good.name}</span>
      <span class="value">${good.value} rupees</span>
    `;
    card.addEventListener("click", () => toggle(index));
    market.append(card);
  });
}

function toggle(index) {
  if (state.over) return;
  if (state.selected.has(index)) {
    state.selected.delete(index);
  } else {
    state.selected.add(index);
  }
  render();
}

function finishTurn(text) {
  if (state.rupees >= 120) {
    state.over = true;
    message.textContent = `Victory in ${state.day} days. ${text}`;
  } else if (state.day >= 12) {
    state.over = true;
    message.textContent = `The market closes with ${state.rupees} rupees. Try again.`;
  } else {
    state.day += 1;
    message.textContent = text;
    restock();
  }
  render();
}

function tradeSelected() {
  const selectedGoods = [...state.selected].map((index) => state.market[index]);
  const types = new Set(selectedGoods.map((good) => good.type));

  if (types.size > 1 && !types.has("camel")) {
    message.textContent = "Only matching goods can be traded together.";
    return;
  }

  if (types.has("camel")) {
    state.camels += selectedGoods.length;
    finishTurn(`You gathered ${selectedGoods.length} camel${selectedGoods.length === 1 ? "" : "s"}.`);
    return;
  }

  const total = selectedGoods.reduce((sum, good) => sum + good.value, 0);
  const bonus = selectedGoods.length >= 3 ? selectedGoods.length * 4 : 0;
  const transport = Math.max(0, selectedGoods.length - state.camels);

  if (transport > 0) {
    message.textContent = `You need ${transport} more camel${transport === 1 ? "" : "s"} to move that trade.`;
    return;
  }

  state.camels -= selectedGoods.length;
  state.rupees += total + bonus;
  finishTurn(`Sold ${selectedGoods.length} lot${selectedGoods.length === 1 ? "" : "s"} for ${total + bonus} rupees.`);
}

function startGame() {
  state.day = 1;
  state.rupees = 0;
  state.camels = 3;
  state.over = false;
  message.textContent = "Select goods that share a color or choose camels to trade.";
  restock();
}

trade.addEventListener("click", tradeSelected);
rest.addEventListener("click", () => finishTurn("The market has fresh goods."));
newGame.addEventListener("click", startGame);

startGame();
