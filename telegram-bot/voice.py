"""
voice.py — локальное распознавание речи через Vosk (офлайн, бесплатно).
"""

import io
import json
import logging
import os
import wave
from typing import Optional

import aiohttp
from vosk import KaldiRecognizer, Model

from config import BOT_TOKEN, VOSK_MODEL_PATH

logger = logging.getLogger(__name__)

_model = None  # type: Optional[Model]


def get_model() -> Model:
    global _model
    if _model is None:
        if not os.path.exists(VOSK_MODEL_PATH):
            raise FileNotFoundError(
                f"Vosk модель не найдена: {VOSK_MODEL_PATH}\n"
                "Скачайте с https://alphacephei.com/vosk/models и распакуйте в папку model/"
            )
        logger.info(f"Загружаю Vosk модель из {VOSK_MODEL_PATH} ...")
        _model = Model(VOSK_MODEL_PATH)
        logger.info("Vosk модель загружена ✓")
    return _model


async def download_voice(bot, file_id: str) -> bytes:
    file = await bot.get_file(file_id)
    url = f"https://api.telegram.org/file/bot{bot.token}/{file.file_path}"
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            resp.raise_for_status()
            return await resp.read()


def ogg_to_wav_bytes(ogg_bytes: bytes) -> bytes:
    from pydub import AudioSegment
    audio = AudioSegment.from_ogg(io.BytesIO(ogg_bytes))
    audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)
    wav_buf = io.BytesIO()
    audio.export(wav_buf, format="wav")
    return wav_buf.getvalue()


def recognize_wav(wav_bytes: bytes) -> str:
    model = get_model()
    wf = wave.open(io.BytesIO(wav_bytes))
    rec = KaldiRecognizer(model, wf.getframerate())
    rec.SetWords(False)
    parts = []
    while True:
        data = wf.readframes(4000)
        if not data:
            break
        if rec.AcceptWaveform(data):
            parts.append(json.loads(rec.Result()).get("text", ""))
    parts.append(json.loads(rec.FinalResult()).get("text", ""))
    return " ".join(p for p in parts if p).strip()


async def transcribe_voice(bot, file_id: str) -> str:
    ogg_bytes = await download_voice(bot, file_id)
    wav_bytes  = ogg_to_wav_bytes(ogg_bytes)
    return recognize_wav(wav_bytes)
