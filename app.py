from __future__ import annotations

import os
import random
import string
from typing import Dict, List, Optional

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room as socket_join_room

app = Flask(__name__)
app.config["SECRET_KEY"] = "satat-secret-key"
socketio = SocketIO(app, cors_allowed_origins="*")

SEAT_NAMES = ["South", "West", "North", "East"]
TEAM_NAMES = ["South / North", "West / East"]
SUIT_NAMES = {
    "spades": "Spades",
    "hearts": "Hearts",
    "diamonds": "Diamonds",
    "clubs": "Clubs",
}
SUITS = ["spades", "hearts", "diamonds", "clubs"]

ROOMS: Dict[str, dict] = {}
SID_INDEX: Dict[str, dict] = {}


@app.route("/")
def index():
    return render_template("index.html")


def sanitize_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        return "Player"
    return name[:18]


def generate_room_code() -> str:
    while True:
        code = "".join(random.choices(string.ascii_uppercase, k=4))
        if code not in ROOMS:
            return code


def make_room(code: str) -> dict:
    return {
        "code": code,
        "players": [None, None, None, None],
        "host_seat": None,
        "started": False,
        "round": 0,
        "dealer": None,
        "trump_maker": None,
        "trump": None,
        "phase": "lobby",
        "paused": False,
        "pre_pause_message": "",
        "message": "Waiting for 4 players.",
        "log": [],
        "deck": [],
        "hands": [[], [], [], []],
        "trick": [],
        "last_trick": [],
        "current_player": None,
        "trick_wins": [0, 0],
        "round_wins": [0, 0],
    }


def room_player_count(room: dict) -> int:
    return sum(1 for p in room["players"] if p is not None)


def connected_count(room: dict) -> int:
    return sum(1 for p in room["players"] if p and p["connected"])


def all_seated(room: dict) -> bool:
    return room_player_count(room) == 4


def all_connected(room: dict) -> bool:
    return connected_count(room) == 4 and all_seated(room)


def next_player(player: int) -> int:
    return (player + 1) % 4


def team_of(player: int) -> int:
    return 0 if player % 2 == 0 else 1


def effective_host_seat(room: dict) -> Optional[int]:
    host_seat = room.get("host_seat")
    if host_seat is not None:
        player = room["players"][host_seat]
        if player and player["connected"]:
            return host_seat
    for seat, player in enumerate(room["players"]):
        if player and player["connected"]:
            return seat
    return host_seat


def log(room: dict, message: str) -> None:
    room["log"].append(message)
    room["log"] = room["log"][-80:]


def card_text(card: dict) -> str:
    rank = card["rank"]
    rank_text = {14: "A", 13: "K", 12: "Q", 11: "J"}.get(rank, str(rank))
    symbol = {"spades": "♠", "hearts": "♥", "diamonds": "♦", "clubs": "♣"}[card["suit"]]
    return f"{rank_text}{symbol}"


def create_deck() -> List[dict]:
    deck = []
    for suit in SUITS:
        for rank in range(2, 15):
            deck.append({"suit": suit, "rank": rank, "id": f"{suit}-{rank}"})
    return deck


def card_sort_value(card: dict) -> int:
    suit_order = {"spades": 0, "hearts": 1, "diamonds": 2, "clubs": 3}
    return suit_order[card["suit"]] * 100 - card["rank"]


def sort_hand(hand: List[dict]) -> None:
    hand.sort(key=card_sort_value)


def is_two_hearts(card: dict) -> bool:
    return card["suit"] == "hearts" and card["rank"] == 2


def deal_batch(room: dict, count: int) -> None:
    player = next_player(room["dealer"])
    for _ in range(4):
        for _ in range(count):
            room["hands"][player].append(room["deck"].pop())
        player = next_player(player)


def start_round(room: dict) -> None:
    room["phase"] = "choosing"
    room["paused"] = False
    room["pre_pause_message"] = ""
    room["trump"] = None
    room["trump_maker"] = next_player(room["dealer"])
    room["deck"] = create_deck()
    random.shuffle(room["deck"])
    room["hands"] = [[], [], [], []]
    room["trick"] = []
    room["last_trick"] = []
    room["current_player"] = room["trump_maker"]
    room["trick_wins"] = [0, 0]

    deal_batch(room, 5)
    for hand in room["hands"]:
        sort_hand(hand)

    room["message"] = f"{SEAT_NAMES[room['trump_maker']]} must choose trump."
    log(room, f"<strong>{SEAT_NAMES[room['trump_maker']]}</strong> is the trump maker.")


def valid_cards_for_player(room: dict, player: int) -> List[dict]:
    hand = room["hands"][player]
    if room["phase"] != "play":
        return []
    if not room["trick"]:
        return hand[:]

    lead = room["trick"][0]["card"]

    if is_two_hearts(lead):
        actual_trumps = [card for card in hand if card["suit"] == room["trump"]]
        return actual_trumps if actual_trumps else hand[:]

    follow_suit_cards = [
        card for card in hand if (not is_two_hearts(card) and card["suit"] == lead["suit"])
    ]
    if follow_suit_cards:
        free_two_hearts = [card for card in hand if is_two_hearts(card)]
        return follow_suit_cards + free_two_hearts

    return hand[:]


def beats(room: dict, challenger: dict, current_winner: dict, lead_card: dict) -> bool:
    if is_two_hearts(challenger):
        return not is_two_hearts(current_winner)
    if is_two_hearts(current_winner):
        return False

    challenger_trump = challenger["suit"] == room["trump"]
    winner_trump = current_winner["suit"] == room["trump"]

    if challenger_trump and not winner_trump:
        return True
    if not challenger_trump and winner_trump:
        return False
    if challenger_trump and winner_trump:
        return challenger["rank"] > current_winner["rank"]

    lead_suit = lead_card["suit"]
    challenger_lead = challenger["suit"] == lead_suit
    winner_lead = current_winner["suit"] == lead_suit

    if challenger_lead and not winner_lead:
        return True
    if not challenger_lead and winner_lead:
        return False
    if challenger_lead and winner_lead:
        return challenger["rank"] > current_winner["rank"]

    return False


def evaluate_trick_winner(room: dict) -> int:
    winner = room["trick"][0]
    lead = room["trick"][0]["card"]
    for entry in room["trick"][1:]:
        if beats(room, entry["card"], winner["card"], lead):
            winner = entry
    return winner["player"]


def emit_error(message: str, sid: Optional[str] = None) -> None:
    emit("server_error", {"message": message}, to=sid or request.sid)


def build_state(room: dict, seat: int) -> dict:
    legal_ids = []
    if room["phase"] == "play" and room["current_player"] == seat and not room["paused"]:
        legal_ids = [card["id"] for card in valid_cards_for_player(room, seat)]

    players = []
    for player in room["players"]:
        if player is None:
            players.append(None)
        else:
            players.append(
                {
                    "seat": player["seat"],
                    "name": player["name"],
                    "connected": player["connected"],
                }
            )

    host_seat = effective_host_seat(room)
    can_start_game = (
        host_seat == seat
        and all_connected(room)
        and room["phase"] in {"lobby", "round_over"}
    )

    return {
        "roomCode": room["code"],
        "youSeat": seat,
        "hostSeat": host_seat,
        "players": players,
        "phase": room["phase"],
        "paused": room["paused"],
        "started": room["started"],
        "round": room["round"],
        "dealer": room["dealer"],
        "trumpMaker": room["trump_maker"],
        "trump": room["trump"],
        "currentPlayer": room["current_player"],
        "trickWins": room["trick_wins"],
        "roundWins": room["round_wins"],
        "message": room["message"],
        "log": room["log"],
        "trick": room["trick"],
        "lastTrick": room["last_trick"],
        "hand": room["hands"][seat],
        "handCounts": [len(hand) for hand in room["hands"]],
        "legalCardIds": legal_ids,
        "canChooseTrump": room["phase"] == "choosing" and room["trump_maker"] == seat and not room["paused"],
        "canStartGame": can_start_game,
        "connectedCount": connected_count(room),
        "seatedCount": room_player_count(room),
        "seatNames": SEAT_NAMES,
        "suitNames": SUIT_NAMES,
        "teamNames": TEAM_NAMES,
    }


def broadcast_state(room: dict) -> None:
    for player in room["players"]:
        if player and player["connected"] and player["sid"]:
            socketio.emit("state", build_state(room, player["seat"]), to=player["sid"])


def reassign_host_if_needed(room: dict) -> None:
    if room.get("host_seat") is None:
        return
    player = room["players"][room["host_seat"]]
    if player is None:
        for seat, other in enumerate(room["players"]):
            if other is not None:
                room["host_seat"] = seat
                return
        room["host_seat"] = None


def add_or_reconnect_player(room: dict, sid: str, name: str, player_id: str) -> int:
    for seat, player in enumerate(room["players"]):
        if player and player["player_id"] == player_id:
            player["sid"] = sid
            player["name"] = name
            player["connected"] = True
            SID_INDEX[sid] = {"code": room["code"], "seat": seat}
            socket_join_room(room["code"])
            if room["started"] and room["paused"] and all_connected(room):
                room["paused"] = False
                restore = room["pre_pause_message"] or "The game continues."
                room["message"] = f"All players reconnected. {restore}"
                log(room, f"<strong>{name}</strong> reconnected. The game resumed.")
            return seat

    for seat, player in enumerate(room["players"]):
        if player is None:
            room["players"][seat] = {
                "sid": sid,
                "seat": seat,
                "name": name,
                "player_id": player_id,
                "connected": True,
            }
            if room.get("host_seat") is None:
                room["host_seat"] = seat
            SID_INDEX[sid] = {"code": room["code"], "seat": seat}
            socket_join_room(room["code"])
            if not room["started"]:
                room["message"] = f"{connected_count(room)} / 4 players connected."
            log(room, f"<strong>{name}</strong> joined as <strong>{SEAT_NAMES[seat]}</strong>.")
            return seat

    raise ValueError("Room is full.")


def cleanup_room_if_empty(room_code: str) -> None:
    room = ROOMS.get(room_code)
    if not room:
        return
    if any(player is not None for player in room["players"]):
        return
    ROOMS.pop(room_code, None)


@socketio.on("create_room")
def on_create_room(data):
    name = sanitize_name(data.get("name"))
    player_id = (data.get("playerId") or "").strip()
    if not player_id:
        emit_error("Missing player id.")
        return

    code = generate_room_code()
    room = make_room(code)
    ROOMS[code] = room
    add_or_reconnect_player(room, request.sid, name, player_id)
    broadcast_state(room)


@socketio.on("join_room_request")
def on_join_room_request(data):
    code = (data.get("code") or "").strip().upper()
    name = sanitize_name(data.get("name"))
    player_id = (data.get("playerId") or "").strip()

    if not code or code not in ROOMS:
        emit_error("Room not found.")
        return
    if not player_id:
        emit_error("Missing player id.")
        return

    room = ROOMS[code]
    try:
        add_or_reconnect_player(room, request.sid, name, player_id)
    except ValueError:
        emit_error("That room is already full.")
        return

    broadcast_state(room)


@socketio.on("start_game")
def on_start_game():
    sid_info = SID_INDEX.get(request.sid)
    if not sid_info:
        emit_error("You are not in a room.")
        return

    room = ROOMS.get(sid_info["code"])
    seat = sid_info["seat"]
    if not room:
        emit_error("Room not found.")
        return
    if effective_host_seat(room) != seat:
        emit_error("Only the host can start the round.")
        return
    if not all_connected(room):
        emit_error("You need 4 connected players to start.")
        return

    if room["phase"] == "lobby":
        room["started"] = True
        room["round"] = 1
        room["dealer"] = random.randint(0, 3)
        room["round_wins"] = [0, 0]
        log(room, f"<strong>{SEAT_NAMES[room['dealer']]}</strong> is the first dealer.")
        start_round(room)
    elif room["phase"] == "round_over":
        room["round"] += 1
        room["dealer"] = next_player(room["dealer"])
        log(room, f"<strong>{SEAT_NAMES[room['dealer']]}</strong> is now the dealer.")
        start_round(room)
    else:
        emit_error("The round is already in progress.")
        return

    broadcast_state(room)


@socketio.on("choose_trump")
def on_choose_trump(data):
    sid_info = SID_INDEX.get(request.sid)
    if not sid_info:
        emit_error("You are not in a room.")
        return

    room = ROOMS.get(sid_info["code"])
    seat = sid_info["seat"]
    suit = data.get("suit")

    if not room or suit not in SUITS:
        emit_error("Invalid trump suit.")
        return
    if room["paused"]:
        emit_error("The game is paused while waiting for a player to reconnect.")
        return
    if room["phase"] != "choosing":
        emit_error("Trump is not being chosen right now.")
        return
    if room["trump_maker"] != seat:
        emit_error("Only the trump maker can choose trump.")
        return

    room["trump"] = suit
    deal_batch(room, 4)
    deal_batch(room, 4)
    for hand in room["hands"]:
        sort_hand(hand)

    room["phase"] = "play"
    room["current_player"] = room["trump_maker"]
    room["message"] = f"{SEAT_NAMES[room['current_player']]} leads the first trick. Trump is {SUIT_NAMES[suit]}."
    log(room, f"<strong>{SEAT_NAMES[seat]}</strong> chose <strong>{SUIT_NAMES[suit]}</strong> as trump.")
    broadcast_state(room)


@socketio.on("play_card")
def on_play_card(data):
    sid_info = SID_INDEX.get(request.sid)
    if not sid_info:
        emit_error("You are not in a room.")
        return

    room = ROOMS.get(sid_info["code"])
    seat = sid_info["seat"]
    card_id = data.get("cardId")

    if not room:
        emit_error("Room not found.")
        return
    if room["paused"]:
        emit_error("The game is paused while waiting for a player to reconnect.")
        return
    if room["phase"] != "play":
        emit_error("Cards cannot be played right now.")
        return
    if room["current_player"] != seat:
        emit_error("It is not your turn.")
        return

    hand = room["hands"][seat]
    card = next((item for item in hand if item["id"] == card_id), None)
    if not card:
        emit_error("Card not found in your hand.")
        return

    legal_ids = {item["id"] for item in valid_cards_for_player(room, seat)}
    if card_id not in legal_ids:
        emit_error("You must follow the rule for this trick.")
        return

    hand.remove(card)
    room["trick"].append({"player": seat, "card": card})
    log(room, f"<strong>{SEAT_NAMES[seat]}</strong> played <strong>{card_text(card)}</strong>.")

    if len(room["trick"]) < 4:
        room["current_player"] = next_player(seat)
        room["message"] = f"{SEAT_NAMES[room['current_player']]} to play."
        broadcast_state(room)
        return

    winner = evaluate_trick_winner(room)
    winning_team = team_of(winner)
    room["trick_wins"][winning_team] += 1
    room["last_trick"] = room["trick"][:]
    room["trick"] = []
    room["current_player"] = winner

    log(room, f"<strong>{SEAT_NAMES[winner]}</strong> won the trick for <strong>{TEAM_NAMES[winning_team]}</strong>.")

    if room["trick_wins"][winning_team] >= 7:
        room["phase"] = "round_over"
        room["round_wins"][winning_team] += 1
        room["message"] = (
            f"{TEAM_NAMES[winning_team]} won the round {room['trick_wins'][0]} - {room['trick_wins'][1]}. "
            "Host can start the next round."
        )
        log(room, f"<strong>{TEAM_NAMES[winning_team]}</strong> won the round.")
    else:
        room["message"] = f"{SEAT_NAMES[winner]} won the trick and leads next."

    broadcast_state(room)


@socketio.on("disconnect")
def on_disconnect(reason):
    sid_info = SID_INDEX.pop(request.sid, None)
    if not sid_info:
        return

    room = ROOMS.get(sid_info["code"])
    seat = sid_info["seat"]
    if not room:
        return

    player = room["players"][seat]
    if player is None:
        return

    name = player["name"]

    if room["started"]:
        player["connected"] = False
        player["sid"] = None
        if not room["paused"]:
            room["pre_pause_message"] = room["message"]
        room["paused"] = True
        room["message"] = f"{name} disconnected. Waiting for reconnection."
        log(room, f"<strong>{name}</strong> disconnected. The game is paused.")
    else:
        room["players"][seat] = None
        log(room, f"<strong>{name}</strong> left the lobby.")
        reassign_host_if_needed(room)
        room["message"] = f"{connected_count(room)} / 4 players connected."
        cleanup_room_if_empty(room["code"])

    broadcast_state(room)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    socketio.run(app, host="0.0.0.0", port=port, debug=debug)
