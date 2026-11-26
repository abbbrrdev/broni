# Telegram Bot

The end-user interface for [Broni](../README.md) — built with **aiogram 3**. Collects booking requests (typed or spoken), hands them to the [backend](../backend/README.md), and reports back once the call is done.

## Flow

1. User sends a request as text, or records a voice message — voice is transcribed locally with **Vosk** (`voice.py`) before it ever leaves the bot.
2. The bot calls `POST /api/process-request` on the backend, which extracts a structured task with Gemini.
3. The bot shows the extracted task for the user to confirm (`keyboards.py`, `messages.py`), then approves/rejects it via the backend.
4. Once the call completes, the bot fetches the outcome and sends a text summary plus the full call recording.

## Files

```
second_bot.py   Bot entry point — handlers, state machine, polling against the backend
voice.py        Voice-message → text via the local Vosk model
config.py       Env-based configuration
keyboards.py    Inline/reply keyboards
messages.py     User-facing message templates
```

## Setup

**1. Install dependencies**

```bash
pip install -r requirements.txt
```

**2. Download the Vosk speech model**

The model is *not* committed to this repo (it's ~130 MB). Grab the small Russian model and unpack it into `model/` next to `second_bot.py`:

```bash
curl -LO https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip
unzip vosk-model-small-ru-0.22.zip
mv vosk-model-small-ru-0.22 model
```

Other languages/sizes are available at [alphacephei.com/vosk/models](https://alphacephei.com/vosk/models) — point `VOSK_MODEL_PATH` at whichever folder you use.

**3. Configure environment**

```bash
cp .env.example .env
# then fill in BOT_TOKEN, API_URL, VOSK_MODEL_PATH
```

**4. Run**

```bash
python3 second_bot.py
```

Or via Docker from the repo root — see the [main README](../README.md#quick-start-docker).
