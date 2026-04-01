# Satat Online — Fan Made (Clean Rewrite)

This is a full clean rewrite of the multiplayer web app.

## What changed

- room creation and room joining now use simple HTTP API routes
- live game updates still use Socket.IO
- explicit threading mode for Flask-SocketIO
- one player id per browser tab using `sessionStorage`
- Render-ready deployment files included

## Local run

```bash
python -m pip install -r requirements.txt
python app.py
```

Then open:

```text
http://127.0.0.1:5000
```

## Render

Use the included `render.yaml`.

## Disclaimer

This is a fan-made browser implementation inspired by a traditional Mauritian card game.
It is not presented as an official, endorsed, or affiliated release.
