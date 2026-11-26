import os
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN: str = os.getenv("BOT_TOKEN", "")
if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN is not set. Create telegram-bot/.env from .env.example and fill it in.")

API_URL:   str = os.getenv("API_URL",   "http://localhost:3001/api/process-request")
VOSK_MODEL_PATH: str = os.getenv("VOSK_MODEL_PATH", "model")  # папка model/ рядом с bot.py
