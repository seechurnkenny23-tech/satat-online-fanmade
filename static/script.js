const socket = io({ transports: ["websocket", "polling"] });

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
  pendingRoomCode: loadSavedRoomCode(),
};

const els = {
  roomCode: document.getElementById("roomCode"),
  yourSeatLabel: document.getElementById("yourSeatLabel"),
  copyRoomBtn: document.getElementById("copyRoomBtn"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
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
  let id = sessionStorage.getItem("satat-player-id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem("satat-player-id", id);
  }
  return id;
}

function saveName(name) {
  localStorage.setItem("satat-name", name);
}

function loadSavedName() {
  return localStorage.getItem("satat-name") || "";
}

function saveRoomCode(code) {
  sessionStorage.setItem("satat-room-code", code);
  appState.pendingRoomCode = code;
}

function loadSavedRoomCode() {
  return sessionStorage.getItem("satat-room-code") || "";
}

function clearSavedRoom() {
  sessionStorage.removeItem("satat-room-code");
  appState.pendingRoomCode = "";
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
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add("hidden"), 3000);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cardText(card) {
  const rank = { 14: "A", 13: "K", 12: "Q", 11: "J" }[card.rank] || String(card.rank);
  return `${rank}${SUIT_SYMBOLS[card.suit]}`;
}

function suitColorClass(suit) {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

function renderCard(card, options = {}) {
  const btn = document.createElement("button");
  btn.className = `playing-card ${suitColorClass(card.suit)} ${options.playable ? "playable" : ""}`.trim();
  btn.type = "button";
  btn.innerHTML = `<span class="rank">${escapeHtml(cardText(card))}</span>`;
  if (options.disabled) btn.disabled = true;
  return btn;
}

function renderCardBack() {
  const div = document.createElement("div");
  div.className = "card-back";
  div.textContent = "🂠";
  return div;
}

function positionToAbsSeat(position, yourSeat) {
  const offsets = { self: 0, left: 1, top: 2, right: 3 };
  return (yourSeat + offsets[position]) % 4;
}

function absSeatToPosition(absSeat, yourSeat) {
  return relativePositions[(absSeat - yourSeat + 4) % 4];
}

function teamTagData(position, connected) {
  if (!connected) return { label: "Offline", className: "disconnected" };
  if (position === "self") return { label: "Your seat", className: "you" };
  if (position === "top") return { label: "Partner", className: "" };
  return { label: "Opponent", className: "opponent" };
}

function updateSeat(position, player, absSeat, handCount) {
  const nameEl = document.getElementById(`playerName-${position}`);
  const tagEl = document.getElementById(`seatTag-${position}`);
  const metaEl = document.getElementById(`seatMeta-${position}`);
  const miniEl = document.getElementById(`mini-${position}`);

  if (!player) {
    nameEl.textContent = "Waiting...";
    tagEl.textContent = position === "top" ? "Partner" : position === "self" ? "Your seat" : "Opponent";
    tagEl.className = `team-tag ${position === "self" ? "you" : position === "top" ? "" : "opponent"}`.trim();
    metaEl.textContent = "0 cards";
    miniEl.innerHTML = "";
    return;
  }

  const tag = teamTagData(position, player.connected);
  nameEl.textContent = player.name;
  tagEl.textContent = tag.label;
  tagEl.className = `team-tag ${tag.className}`.trim();
  metaEl.textContent = `${handCount} cards`;
  miniEl.innerHTML = "";

  const hiddenCount = position === "self" ? 0 : Math.min(handCount, 8);
  for (let i = 0; i < hiddenCount; i += 1) {
    miniEl.appendChild(renderCardBack());
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
      cardEl.addEventListener("click", () => socket.emit("play_card", { cardId: card.id }));
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
        <span class="muted">${escapeHtml(name)}${isHost ? " · host" : ""}</span>
      </div>
      <span class="status-pill ${statusClass}">${statusLabel}</span>
    `;
    els.lobbyList.appendChild(div);
  }
}

function renderTopInfo(state) {
  els.roomCode.textContent = state.roomCode;
  els.copyRoomBtn.disabled = false;
  els.leaveRoomBtn.classList.remove("hidden");
  els.yourSeatLabel.textContent = seatOrder[state.youSeat];
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

function setBusy(isBusy) {
  els.createRoomBtn.disabled = isBusy;
  els.joinRoomBtn.disabled = isBusy;
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

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({ ok: false, message: "Bad server response." }));
  if (!response.ok || !data.ok) {
    throw new Error(data.message || "Request failed.");
  }
  return data;
}

function applyState(state) {
  appState.state = state;
  saveRoomCode(state.roomCode);
  renderState();
}

function registerCurrentSocket() {
  if (!socket.connected || !appState.pendingRoomCode) return;
  socket.emit("register_session", {
    code: appState.pendingRoomCode,
    playerId: appState.playerId,
  });
}

async function createRoom() {
  const name = validateName();
  if (!name) return;
  clearOverlayError();
  setBusy(true);
  try {
    const data = await postJson("/api/create_room", {
      name,
      playerId: appState.playerId,
      socketId: socket.id,
    });
    applyState(data.state);
    registerCurrentSocket();
  } catch (error) {
    showOverlayError(error.message);
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function joinRoom() {
  const name = validateName();
  if (!name) return;
  const code = els.joinCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    showOverlayError("Room code must be 4 letters.");
    return;
  }
  clearOverlayError();
  setBusy(true);
  try {
    const data = await postJson("/api/join_room", {
      code,
      name,
      playerId: appState.playerId,
      socketId: socket.id,
    });
    applyState(data.state);
    registerCurrentSocket();
  } catch (error) {
    showOverlayError(error.message);
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function leaveRoom() {
  const code = appState.state?.roomCode || appState.pendingRoomCode;
  if (!code) return;
  try {
    await postJson("/api/leave_room", { code, playerId: appState.playerId });
  } catch (_) {
    // ignore
  }
  appState.state = null;
  clearSavedRoom();
  els.joinOverlay.classList.remove("hidden");
  els.leaveRoomBtn.classList.add("hidden");
  els.copyRoomBtn.disabled = true;
  els.roomCode.textContent = "----";
  els.yourSeatLabel.textContent = "Not joined";
  showToast("You left the room.");
}

els.nameInput.value = loadSavedName();
els.joinCodeInput.value = loadSavedRoomCode();

els.createRoomBtn.addEventListener("click", createRoom);
els.joinRoomBtn.addEventListener("click", joinRoom);
els.startGameBtn.addEventListener("click", () => socket.emit("start_game"));
els.leaveRoomBtn.addEventListener("click", leaveRoom);
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
  btn.addEventListener("click", () => socket.emit("choose_trump", { suit: btn.dataset.suit }));
});

socket.on("connect", () => {
  registerCurrentSocket();
});

socket.on("disconnect", () => {
  showToast("Disconnected from server. Trying to reconnect...");
});

socket.on("state", (state) => {
  applyState(state);
});

socket.on("server_error", (payload) => {
  const message = payload?.message || "Something went wrong.";
  if (!els.joinOverlay.classList.contains("hidden")) {
    showOverlayError(message);
  }
  showToast(message);
});

renderState();
