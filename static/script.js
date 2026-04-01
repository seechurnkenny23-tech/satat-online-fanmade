const socket = io();

const SUIT_SYMBOLS = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const seatOrder = ["South", "West", "North", "East"];
const relativePositions = ["self", "left", "top", "right"];

const appState = {
  playerId: getOrCreatePlayerId(),
  state: null,
  hasAttemptedAutoJoin: false,
};

const els = {
  roomCode: document.getElementById("roomCode"),
  yourSeatLabel: document.getElementById("yourSeatLabel"),
  copyRoomBtn: document.getElementById("copyRoomBtn"),
  startGameBtn: document.getElementById("startGameBtn"),
  scoreNS: document.getElementById("scoreNS"),
  scoreWE: document.getElementById("scoreWE"),
  roundNumber: document.getElementById("roundNumber"),
  dealerName: document.getElementById("dealerName"),
  trumpMakerName: document.getElementById("trumpMakerName"),
  trumpSuit: document.getElementById("trumpSuit"),
  turnName: document.getElementById("turnName"),
  tricksNS: document.getElementById("tricksNS"),
  tricksWE: document.getElementById("tricksWE"),
  centerMessage: document.getElementById("centerMessage"),
  lastTrickBox: document.getElementById("lastTrickBox"),
  yourHand: document.getElementById("yourHand"),
  trumpChooser: document.getElementById("trumpChooser"),
  log: document.getElementById("log"),
  lobbyList: document.getElementById("lobbyList"),
  joinOverlay: document.getElementById("joinOverlay"),
  overlayError: document.getElementById("overlayError"),
  nameInput: document.getElementById("nameInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinCodeInput: document.getElementById("joinCodeInput"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  toast: document.getElementById("toast"),
};

function getOrCreatePlayerId() {
  let id = localStorage.getItem("satat-player-id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem("satat-player-id", id);
  }
  return id;
}

function saveName(name) {
  localStorage.setItem("satat-name", name);
}

function saveRoomCode(code) {
  localStorage.setItem("satat-room-code", code);
}

function loadSavedName() {
  return localStorage.getItem("satat-name") || "";
}

function loadSavedRoomCode() {
  return localStorage.getItem("satat-room-code") || "";
}

function clearOverlayError() {
  els.overlayError.textContent = "";
}

function showOverlayError(message) {
  els.overlayError.textContent = message;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 3000);
}

function cardText(card) {
  const rank = ({ 14: "A", 13: "K", 12: "Q", 11: "J" })[card.rank] || String(card.rank);
  return `${rank}${SUIT_SYMBOLS[card.suit]}`;
}

function suitColorClass(suit) {
  return suit === "hearts" || suit === "diamonds" ? "red" : "";
}

function renderCard(card, options = {}) {
  const div = document.createElement("div");
  div.className = `card ${suitColorClass(card.suit)}`.trim();
  if (options.playable) div.classList.add("playable");
  if (options.disabled) div.classList.add("disabled");
  if (options.winner) div.classList.add("winner-card");
  div.dataset.cardId = card.id;
  const rank = ({ 14: "A", 13: "K", 12: "Q", 11: "J" })[card.rank] || String(card.rank);
  const symbol = SUIT_SYMBOLS[card.suit];
  div.innerHTML = `
    <div class="top"><span>${rank}</span><span>${symbol}</span></div>
    <div class="center">${symbol}</div>
    <div class="bottom"><span>${rank}</span><span>${symbol}</span></div>
  `;
  return div;
}

function renderCardBack() {
  const div = document.createElement("div");
  div.className = "card-back";
  return div;
}

function positionToAbsSeat(position, yourSeat) {
  const offset = relativePositions.indexOf(position);
  return (yourSeat + offset) % 4;
}

function absSeatToPosition(absSeat, yourSeat) {
  const offset = (absSeat - yourSeat + 4) % 4;
  return relativePositions[offset];
}

function teamTagData(position, connected) {
  if (position === "self") return { label: connected ? "Your seat" : "Disconnected", className: connected ? "you" : "disconnected" };
  if (position === "top") return { label: connected ? "Partner" : "Disconnected", className: connected ? "" : "disconnected" };
  return { label: connected ? "Opponent" : "Disconnected", className: connected ? "opponent" : "disconnected" };
}

function updateSeat(position, player, absSeat, handCount) {
  const nameEl = document.getElementById(`playerName-${position}`);
  const metaEl = document.getElementById(`seatMeta-${position}`);
  const tagEl = document.getElementById(`seatTag-${position}`);
  const miniEl = position === "self" ? els.yourHand : document.getElementById(`mini-${position}`);

  if (position !== "self") miniEl.innerHTML = "";

  if (!player) {
    nameEl.textContent = `Empty ${seatOrder[absSeat]}`;
    metaEl.textContent = "Waiting for player";
    tagEl.textContent = position === "top" ? "Partner" : position === "self" ? "Your seat" : "Opponent";
    tagEl.className = `team-tag ${position === "self" ? "you" : position === "top" ? "" : "opponent"}`.trim();
    if (position !== "self") {
      for (let i = 0; i < 3; i += 1) miniEl.appendChild(renderCardBack());
    }
    return;
  }

  const tag = teamTagData(position, player.connected);
  nameEl.textContent = `${player.name} · ${seatOrder[absSeat]}`;
  metaEl.textContent = `${handCount} cards${player.connected ? "" : " · offline"}`;
  tagEl.textContent = tag.label;
  tagEl.className = `team-tag ${tag.className}`.trim();

  if (position !== "self") {
    const backs = Math.max(1, Math.min(handCount || 0, position === "top" ? 8 : 7));
    for (let i = 0; i < backs; i += 1) miniEl.appendChild(renderCardBack());
  }
}

function renderPlayers(state) {
  relativePositions.forEach((position) => {
    const absSeat = positionToAbsSeat(position, state.youSeat);
    updateSeat(position, state.players[absSeat], absSeat, state.handCounts[absSeat]);
  });
}

function renderHand(state) {
  els.yourHand.innerHTML = "";
  const legal = new Set(state.legalCardIds || []);

  state.hand.forEach((card) => {
    const playable = legal.has(card.id);
    const cardEl = renderCard(card, {
      playable,
      disabled: state.phase === "play" && state.currentPlayer === state.youSeat && !playable,
    });

    if (playable) {
      cardEl.addEventListener("click", () => {
        socket.emit("play_card", { cardId: card.id });
      });
    }

    els.yourHand.appendChild(cardEl);
  });
}

function renderTrick(state) {
  ["self", "left", "top", "right"].forEach((position) => {
    document.getElementById(`slot-${position}`).innerHTML = "";
  });

  state.trick.forEach((entry) => {
    const position = absSeatToPosition(entry.player, state.youSeat);
    const slot = document.getElementById(`slot-${position}`);
    slot.appendChild(renderCard(entry.card));
  });

  if (state.lastTrick && state.lastTrick.length) {
    const summary = state.lastTrick
      .map((entry) => `${seatOrder[entry.player]} ${cardText(entry.card)}`)
      .join(" · ");
    els.lastTrickBox.textContent = `Last trick: ${summary}`;
    els.lastTrickBox.classList.remove("hidden");
  } else {
    els.lastTrickBox.classList.add("hidden");
  }
}

function renderLog(state) {
  els.log.innerHTML = "";
  [...state.log].reverse().forEach((entry) => {
    const div = document.createElement("div");
    div.className = "log-entry";
    div.innerHTML = entry;
    els.log.appendChild(div);
  });
}

function renderLobby(state) {
  els.lobbyList.innerHTML = "";
  for (let absSeat = 0; absSeat < 4; absSeat += 1) {
    const player = state.players[absSeat];
    const div = document.createElement("div");
    div.className = "lobby-item";
    const isHost = state.hostSeat === absSeat;
    const name = player ? player.name : "Waiting...";
    const statusLabel = !player ? "empty" : player.connected ? "connected" : "offline";
    const statusClass = !player ? "" : player.connected ? "connected" : "disconnected";
    div.innerHTML = `
      <div>
        <strong>${seatOrder[absSeat]}</strong><br />
        <span class="muted">${name}${isHost ? " · host" : ""}</span>
      </div>
      <span class="status-pill ${statusClass}">${statusLabel}</span>
    `;
    els.lobbyList.appendChild(div);
  }
}

function renderTopInfo(state) {
  els.roomCode.textContent = state.roomCode;
  els.copyRoomBtn.disabled = false;
  els.yourSeatLabel.textContent = `${seatOrder[state.youSeat]}`;
  els.scoreNS.textContent = state.roundWins[0];
  els.scoreWE.textContent = state.roundWins[1];
  els.roundNumber.textContent = state.round || 0;
  els.tricksNS.textContent = state.trickWins[0];
  els.tricksWE.textContent = state.trickWins[1];
  els.dealerName.textContent = state.dealer == null ? "-" : seatOrder[state.dealer];
  els.trumpMakerName.textContent = state.trumpMaker == null ? "-" : seatOrder[state.trumpMaker];
  els.trumpSuit.textContent = state.trump ? state.suitNames[state.trump] : "Not chosen";
  els.turnName.textContent = state.currentPlayer == null ? "-" : seatOrder[state.currentPlayer];
  els.centerMessage.textContent = `${state.message} (${state.connectedCount}/4 connected)`;

  els.startGameBtn.classList.toggle("hidden", !state.canStartGame);
  els.startGameBtn.textContent = state.phase === "round_over" ? "Next round" : "Start round";
  els.trumpChooser.classList.toggle("hidden", !state.canChooseTrump);
}

function renderState() {
  const state = appState.state;
  if (!state) return;

  els.joinOverlay.classList.add("hidden");
  renderTopInfo(state);
  renderPlayers(state);
  renderHand(state);
  renderTrick(state);
  renderLobby(state);
  renderLog(state);
}

function validateName() {
  const name = els.nameInput.value.trim();
  if (!name) {
    showOverlayError("Enter your name first.");
    return null;
  }
  saveName(name);
  return name;
}

function createRoom() {
  const name = validateName();
  if (!name) return;
  clearOverlayError();
  socket.emit("create_room", { name, playerId: appState.playerId });
}

function joinRoom() {
  const name = validateName();
  if (!name) return;
  const code = els.joinCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    showOverlayError("Room code must be 4 letters.");
    return;
  }
  clearOverlayError();
  socket.emit("join_room_request", { code, name, playerId: appState.playerId });
}

function autoRejoinIfPossible() {
  if (appState.state || appState.hasAttemptedAutoJoin) return;
  const savedCode = loadSavedRoomCode();
  const savedName = loadSavedName();
  if (!savedCode || !savedName) return;
  appState.hasAttemptedAutoJoin = true;
  els.nameInput.value = savedName;
  els.joinCodeInput.value = savedCode;
  socket.emit("join_room_request", { code: savedCode, name: savedName, playerId: appState.playerId });
}

els.nameInput.value = loadSavedName();
els.joinCodeInput.value = loadSavedRoomCode();

els.createRoomBtn.addEventListener("click", createRoom);
els.joinRoomBtn.addEventListener("click", joinRoom);
els.startGameBtn.addEventListener("click", () => socket.emit("start_game"));
els.copyRoomBtn.addEventListener("click", async () => {
  if (!appState.state?.roomCode) return;
  try {
    await navigator.clipboard.writeText(appState.state.roomCode);
    showToast("Room code copied.");
  } catch {
    showToast("Could not copy the room code.");
  }
});

els.joinCodeInput.addEventListener("input", () => {
  els.joinCodeInput.value = els.joinCodeInput.value.toUpperCase().replace(/[^A-Z]/g, "");
});

els.nameInput.addEventListener("input", clearOverlayError);
els.joinCodeInput.addEventListener("input", clearOverlayError);

document.querySelectorAll(".suit-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    socket.emit("choose_trump", { suit: btn.dataset.suit });
  });
});

socket.on("connect", () => {
  autoRejoinIfPossible();
});

socket.on("disconnect", () => {
  showToast("Disconnected from server. Trying to reconnect...");
});

socket.on("state", (state) => {
  appState.state = state;
  saveRoomCode(state.roomCode);
  renderState();
});

socket.on("server_error", (payload) => {
  const message = payload?.message || "Something went wrong.";
  if (!els.joinOverlay.classList.contains("hidden")) {
    showOverlayError(message);
  }
  showToast(message);
});

renderState();
