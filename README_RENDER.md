# Satat Multiplayer – Public Online Deploy (Render)

## Local run
python -m pip install -r requirements.txt
python app.py

## Render deploy
- Push this folder to a GitHub repository.
- In Render, create a new Web Service from that repo.
- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn --worker-class eventlet -w 1 app:app`
- Or let Render read `render.yaml` automatically.

## Notes
- The in-memory room state resets whenever the server restarts.
- Free hosting can sleep when idle.


## Branding note
Use the public title **Satat Online — Fan Made** and keep a short non-affiliation disclaimer in the app or landing page.
