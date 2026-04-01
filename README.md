# Satat Multiplayer

This is a real-time 4-player browser version of **Satat** with room codes.

## What it does
- 4 human players
- fixed partnerships: South/North vs West/East
- room code lobby
- live synchronized turns
- trump selection by the player to the dealer's left
- special **2 of hearts** rule
- follow-suit validation
- reconnect support if someone refreshes the page
- host can start the next round after a round ends

## Files
- `app.py` - Python server
- `templates/index.html` - main page
- `static/style.css` - styling
- `static/script.js` - client-side multiplayer logic

## Run on Windows
Open PowerShell in this project folder and run:

```powershell
py -m pip install -r requirements.txt
py app.py
```

If `py` does not work, try:

```powershell
python -m pip install -r requirements.txt
python app.py
```

Then open:

```text
http://127.0.0.1:5000
```

## Play with 4 people on the same Wi-Fi / LAN
1. One person runs the server.
2. Find that computer's local IP address.
3. Other players open `http://YOUR-IP:5000` in their browser.
4. Create a room and share the 4-letter room code.

## Notes
- The server must stay open while playing.
- This is a room-based multiplayer build, not a static HTML-only file.
- For internet play across different homes, deploy the project to a Python host and share that public URL.


## Disclaimer
- This project is a fan-made browser implementation inspired by a traditional Mauritian card game.
- It is not presented as an official, endorsed, or affiliated release.
- Keep the code, visuals, sounds, and written text original or properly licensed before sharing publicly.
