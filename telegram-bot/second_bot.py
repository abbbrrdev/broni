import asyncio
import json
import logging
import os
import wave
from pathlib import Path
from typing import Optional

import aiohttp
from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message,
    ReplyKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardRemove,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    CallbackQuery,
)
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
API_URL = os.getenv("API_URL", "http://localhost:3001/api/process-request")
API_SECRET_KEY = os.getenv("API_SECRET_KEY", "dev-secret-token")
VOSK_MODEL_PATH = os.getenv("VOSK_MODEL_PATH", "model")
TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")

# Base API URL (убираем /api/process-request, оставляем хост)
API_BASE = API_URL.rsplit("/api/", 1)[0]
RESULT_URL = API_BASE + "/api/task-result/{task_id}"

# taskId → chat_id (для поллинга)
pending_call_results: dict[str, int] = {}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Vosk – lazy load so the bot starts even if model isn't present yet
# ---------------------------------------------------------------------------
vosk_model = None


def get_vosk_model():
    global vosk_model
    if vosk_model is None:
        try:
            from vosk import Model
            vosk_model = Model(VOSK_MODEL_PATH)
            logger.info("Vosk model loaded from '%s'", VOSK_MODEL_PATH)
        except Exception as exc:
            logger.warning("Vosk model not loaded: %s", exc)
    return vosk_model


def transcribe_audio(ogg_path: str) -> Optional[str]:
    """Convert OGG → WAV (mono 16 kHz) then run Vosk STT."""
    model = get_vosk_model()
    if model is None:
        return None

    wav_path = ogg_path.replace(".ogg", ".wav")
    try:
        from pydub import AudioSegment
        audio = AudioSegment.from_ogg(ogg_path)
        audio = audio.set_channels(1).set_frame_rate(16000)
        audio.export(wav_path, format="wav")
    except Exception as exc:
        logger.error("Audio conversion failed: %s", exc)
        return None

    try:
        from vosk import KaldiRecognizer
        wf = wave.open(wav_path, "rb")
        rec = KaldiRecognizer(model, wf.getframerate())
        rec.SetWords(True)

        results = []
        while True:
            data = wf.readframes(4000)
            if not data:
                break
            if rec.AcceptWaveform(data):
                part = json.loads(rec.Result())
                results.append(part.get("text", ""))
        final = json.loads(rec.FinalResult())
        results.append(final.get("text", ""))
        wf.close()

        text = " ".join(r for r in results if r).strip()
        return text if text else None
    except Exception as exc:
        logger.error("Vosk recognition failed: %s", exc)
        return None
    finally:
        for p in (wav_path,):
            if os.path.exists(p):
                os.remove(p)


# ---------------------------------------------------------------------------
# FSM States
# ---------------------------------------------------------------------------
class TaskForm(StatesGroup):
    waiting_name = State()
    waiting_phone = State()
    waiting_city = State()
    waiting_request = State()
    waiting_confirm = State()


# ---------------------------------------------------------------------------
# Keyboards
# ---------------------------------------------------------------------------
CITIES = ["Астана", "Алматы", "Шымкент", "Актобе", "Тараз", "Другой"]

CITY_COORDS = {
    "Астана": (51.1801, 71.4460),
    "Алматы": (43.2220, 76.8512),
    "Шымкент": (42.3417, 69.5901),
    "Актобе": (50.2839, 57.1670),
    "Тараз": (42.9000, 71.3667),
}


def main_menu_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="📋 Создать задачу")]],
        resize_keyboard=True,
    )


def phone_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📱 Поделиться номером", request_contact=True)],
            [KeyboardButton(text="❌ Отмена")],
        ],
        resize_keyboard=True,
    )


def city_kb() -> ReplyKeyboardMarkup:
    rows = [[KeyboardButton(text=c)] for c in CITIES]
    rows.append([KeyboardButton(text="📍 Отправить геолокацию", request_location=True)])
    rows.append([KeyboardButton(text="❌ Отмена")])
    return ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)


def request_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🎤 Записать голосовое")],
            [KeyboardButton(text="❌ Отмена")],
        ],
        resize_keyboard=True,
        input_field_placeholder="Напишите запрос или нажмите 🎤",
    )


def confirm_kb(task_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="✅ Подтвердить", callback_data=f"approve:{task_id}"),
                InlineKeyboardButton(text="❌ Отменить", callback_data="cancel_task"),
            ]
        ]
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def format_task(task: dict) -> str:
    lines = [
        "📌 <b>Детали задачи:</b>",
        f"🏪 <b>Место:</b> {task.get('placeName', task.get('name', '—'))}",
        f"📞 <b>Телефон:</b> {task.get('placeNumber', task.get('number', '—'))}",
        f"📍 <b>Адрес:</b> {task.get('address', task.get('street', '—'))}",
        f"🕐 <b>Время:</b> {task.get('time', '—')}",
    ]
    if task.get("additionalInfo"):
        lines.append(f"ℹ️ {task['additionalInfo']}")
    return "\n".join(lines)


async def city_from_coords(lat: float, lon: float) -> str:
    """Best-effort reverse geocoding via Nominatim (no key required)."""
    url = (
        f"https://nominatim.openstreetmap.org/reverse"
        f"?lat={lat}&lon={lon}&format=json&accept-language=ru"
    )
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                data = await resp.json()
                addr = data.get("address", {})
                return (
                    addr.get("city")
                    or addr.get("town")
                    or addr.get("village")
                    or "Неизвестно"
                )
    except Exception:
        # fall back to closest known city by distance
        import math
        best, best_d = "Астана", float("inf")
        for name, (clat, clon) in CITY_COORDS.items():
            d = math.hypot(lat - clat, lon - clon)
            if d < best_d:
                best_d, best = d, name
        return best


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
router = Router()


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext):
    await state.clear()
    await message.answer(
        "👋 Привет! Я помогу вам создать задачу — забронировать столик, "
        "записаться на приём и многое другое.\n\nНажмите кнопку ниже, чтобы начать.",
        reply_markup=main_menu_kb(),
    )


@router.message(Command("cancel"))
@router.message(F.text == "❌ Отмена")
async def cmd_cancel(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("Действие отменено.", reply_markup=main_menu_kb())


# ── Step 1: start flow ──────────────────────────────────────────────────────
@router.message(F.text == "📋 Создать задачу")
async def start_task(message: Message, state: FSMContext):
    await state.set_state(TaskForm.waiting_name)
    await message.answer(
        "Введите ваше <b>имя</b>:",
        parse_mode="HTML",
        reply_markup=ReplyKeyboardMarkup(
            keyboard=[[KeyboardButton(text="❌ Отмена")]],
            resize_keyboard=True,
        ),
    )


# ── Step 2: name → ask phone ────────────────────────────────────────────────
@router.message(TaskForm.waiting_name)
async def got_name(message: Message, state: FSMContext):
    name = message.text.strip()
    if not name:
        await message.answer("Пожалуйста, введите имя.")
        return
    await state.update_data(name=name)
    await state.set_state(TaskForm.waiting_phone)
    await message.answer(
        f"Отлично, <b>{name}</b>! 👋\n\n"
        "Теперь укажите ваш <b>номер телефона</b>.\n"
        "Нажмите кнопку ниже, чтобы поделиться номером автоматически, "
        "или введите вручную в формате <code>+7XXXXXXXXXX</code>.",
        parse_mode="HTML",
        reply_markup=phone_kb(),
    )


# ── Step 3: phone (contact or text) → ask city ──────────────────────────────
@router.message(TaskForm.waiting_phone, F.contact)
async def got_contact(message: Message, state: FSMContext):
    phone = message.contact.phone_number
    if not phone.startswith("+"):
        phone = "+" + phone
    await _phone_received(message, state, phone)


@router.message(TaskForm.waiting_phone, F.text)
async def got_phone_text(message: Message, state: FSMContext):
    phone = message.text.strip()
    if not (phone.startswith("+") and len(phone) >= 10):
        await message.answer(
            "Пожалуйста, введите корректный номер (например, <code>+77051234567</code>) "
            "или нажмите кнопку «Поделиться номером».",
            parse_mode="HTML",
        )
        return
    await _phone_received(message, state, phone)


async def _phone_received(message: Message, state: FSMContext, phone: str):
    await state.update_data(phone=phone)
    await state.set_state(TaskForm.waiting_city)
    await message.answer(
        f"Номер принят: <code>{phone}</code> ✅\n\n"
        "Теперь выберите ваш <b>город</b> или отправьте геолокацию:",
        parse_mode="HTML",
        reply_markup=city_kb(),
    )


# ── Step 4: city (button / text / location) → ask request ───────────────────
@router.message(TaskForm.waiting_city, F.location)
async def got_location(message: Message, state: FSMContext):
    lat = message.location.latitude
    lon = message.location.longitude
    city = await city_from_coords(lat, lon)
    await _city_received(message, state, city)


@router.message(TaskForm.waiting_city, F.text)
async def got_city_text(message: Message, state: FSMContext):
    city = message.text.strip()
    if city not in CITIES and city != "Другой":
        # accept free-form city name
        pass
    if city == "Другой":
        await message.answer("Введите название вашего города:")
        return
    await _city_received(message, state, city)


async def _city_received(message: Message, state: FSMContext, city: str):
    await state.update_data(city=city)
    await state.set_state(TaskForm.waiting_request)
    await message.answer(
        f"Город: <b>{city}</b> ✅\n\n"
        "Опишите, что нужно сделать — <b>текстом</b> или <b>голосовым сообщением</b>.\n\n"
        "Например: <i>забронируй столик в Del Papa на Республике в 17:00</i>",
        parse_mode="HTML",
        reply_markup=request_kb(),
    )


# ── Step 5: request (text or voice) → send to API ───────────────────────────
@router.message(TaskForm.waiting_request, F.text & ~F.text.startswith("🎤"))
async def got_request_text(message: Message, state: FSMContext):
    await _process_request(message, state, message.text.strip())


@router.message(TaskForm.waiting_request, F.voice)
async def got_voice(message: Message, state: FSMContext):
    wait_msg = await message.answer("🎙 Распознаю голосовое сообщение…", reply_markup=ReplyKeyboardRemove())

    # Download voice file
    bot: Bot = message.bot
    file = await bot.get_file(message.voice.file_id)
    ogg_path = f"/tmp/voice_{message.from_user.id}.ogg"
    await bot.download_file(file.file_path, destination=ogg_path)

    loop = asyncio.get_event_loop()
    text = await loop.run_in_executor(None, transcribe_audio, ogg_path)

    # Cleanup
    if os.path.exists(ogg_path):
        os.remove(ogg_path)

    await wait_msg.delete()

    if not text:
        await message.answer(
            "😔 Не удалось распознать голосовое сообщение. "
            "Попробуйте ещё раз или введите запрос текстом.",
            reply_markup=request_kb(),
        )
        return

    await message.answer(f"🗣 Распознано: <i>{text}</i>", parse_mode="HTML")
    await _process_request(message, state, text)


@router.message(TaskForm.waiting_request, F.text == "🎤 Записать голосовое")
async def prompt_voice(message: Message):
    await message.answer("🎤 Запишите и отправьте голосовое сообщение.")


async def _process_request(message: Message, state: FSMContext, text: str):
    data = await state.get_data()
    name = data["name"]
    phone = data["phone"]
    city = data["city"]

    await message.answer("⏳ Обрабатываю запрос…", reply_markup=ReplyKeyboardRemove())

    payload = {"name": name, "number": phone, "text": text, "city": city}

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(API_URL, json=payload, headers={"Authorization": f"Bearer {API_SECRET_KEY}"}, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                result = await resp.json()
    except aiohttp.ClientConnectorError:
        await message.answer(
            "❌ Не удалось подключиться к серверу. Убедитесь, что бэкенд запущен.",
            reply_markup=main_menu_kb(),
        )
        await state.clear()
        return
    except Exception as exc:
        logger.error("API error: %s", exc)
        await message.answer("❌ Произошла ошибка при обращении к серверу.", reply_markup=main_menu_kb())
        await state.clear()
        return

    if not result.get("success"):
        await message.answer(
            f"❌ Сервер вернул ошибку: {result.get('message', 'неизвестно')}",
            reply_markup=main_menu_kb(),
        )
        await state.clear()
        return

    task_id = result.get("taskId", "")
    task = result.get("task", {})

    await state.update_data(task_id=task_id)
    await state.set_state(TaskForm.waiting_confirm)

    await message.answer(
        f"✅ Задача найдена!\n\n{format_task(task)}\n\n"
        "Подтвердить выполнение задачи?",
        parse_mode="HTML",
        reply_markup=confirm_kb(task_id),
    )


# ── Step 6: confirm / cancel ─────────────────────────────────────────────────
@router.callback_query(F.data.startswith("approve:"))
async def approve_task(callback: CallbackQuery, state: FSMContext):
    task_id = callback.data.split(":", 1)[1]
    approve_url = API_URL.replace("/process-request", f"/tasks/{task_id}/approve")

    await callback.message.edit_reply_markup(reply_markup=None)
    await callback.message.answer("⏳ Подтверждаю задачу…")

    try:
        async with aiohttp.ClientSession() as session:
            async with session.put(approve_url, headers={"Authorization": f"Bearer {API_SECRET_KEY}"}, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                result = await resp.json()
    except Exception as exc:
        logger.error("Approve error: %s", exc)
        await callback.message.answer("❌ Ошибка при подтверждении.", reply_markup=main_menu_kb())
        await state.clear()
        await callback.answer()
        return

    await state.clear()

    if result.get("success"):
        task = result.get("task", {})
        task_id_approved = task.get("id", task_id)
        chat_id = callback.message.chat.id

        # Регистрируем задачу для поллинга результата звонка
        pending_call_results[task_id_approved] = chat_id

        await callback.message.answer(
            f"🎉 <b>Задача подтверждена!</b>\n\n"
            f"📞 Выполняется звонок на номер <b>{task.get('placeNumber', '—')}</b>\n"
            f"🏢 {task.get('placeName', '—')} — {task.get('address', '—')}\n"
            f"🕐 {task.get('time', '—')}\n\n"
            f"📌 Как звонок завершится — пришлю результат и запись разговора 🎙",
            parse_mode="HTML",
            reply_markup=main_menu_kb(),
        )
    else:
        await callback.message.answer(
            f"❌ Не удалось подтвердить: {result.get('message', '')}",
            reply_markup=main_menu_kb(),
        )

    await callback.answer()


@router.callback_query(F.data == "cancel_task")
async def cancel_task_cb(callback: CallbackQuery, state: FSMContext):
    await callback.message.edit_reply_markup(reply_markup=None)
    await state.clear()
    await callback.message.answer("Задача отменена.", reply_markup=main_menu_kb())
    await callback.answer()


# ---------------------------------------------------------------------------
# Background: опрос результатов звонка
# ---------------------------------------------------------------------------

async def poll_call_results(bot_instance: Bot):
    """Каждые 15 секунд проверяет статус звонков и шлёт результат в Telegram."""
    # task_id → кол-во попыток после того как outcome != PENDING
    waiting_for_recording: dict[str, int] = {}

    while True:
        await asyncio.sleep(15)
        if not pending_call_results:
            continue

        done = []
        async with aiohttp.ClientSession() as session:
            for task_id, chat_id in list(pending_call_results.items()):
                url = RESULT_URL.format(task_id=task_id)
                try:
                    async with session.get(url, headers={"Authorization": f"Bearer {API_SECRET_KEY}"}, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                        if resp.status != 200:
                            continue
                        data = await resp.json()
                        outcome = data.get("outcome", "PENDING")

                        if outcome == "PENDING":
                            continue

                        recording_url = data.get("recordingUrl")

                        # Если запись ещё не готова — ждём ещё (макс. 8 попыток = ~2 мин)
                        if not recording_url:
                            attempts = waiting_for_recording.get(task_id, 0) + 1
                            waiting_for_recording[task_id] = attempts
                            if attempts < 8:
                                logger.info(f"Waiting for recording {task_id} (attempt {attempts})")
                                continue
                            # Превысили лимит — шлём без записи
                            logger.warning(f"Recording timeout for {task_id}, sending without it")

                        await _send_call_result(bot_instance, chat_id, task_id, data, session)
                        done.append(task_id)
                        waiting_for_recording.pop(task_id, None)

                except Exception as e:
                    logger.warning(f"Poll error {task_id}: {e}")

        for t in done:
            pending_call_results.pop(t, None)



async def _send_call_result(
    bot_instance: Bot, chat_id: int, task_id: str, data: dict, session: aiohttp.ClientSession
):
    outcome = data.get("outcome", "UNCLEAR")
    summary = data.get("summary", "")
    place = data.get("placeName", "—")
    time_str = data.get("time", "—")
    recording_url = data.get("recordingUrl")

    icon = "✅" if outcome == "BOOKED" else ("❌" if outcome == "REJECTED" else "❓")
    outcome_ru = {"BOOKED": "Забронировано", "REJECTED": "Отказано", "UNCLEAR": "Неясен"}.get(outcome, outcome)

    text = (
        f"{icon} <b>Результат звонка</b>  <code>#{task_id}</code>\n\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🏠 <b>{place}</b>\n"
        f"🕐 Время: <b>{time_str}</b>\n"
        f"📋 Итог: <b>{outcome_ru}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n\n"
        f"💬 {summary}"
    )
    await bot_instance.send_message(chat_id, text, parse_mode="HTML")

    # Отправляем аудио-запись звонка
    if recording_url:
        try:
            if recording_url.startswith("/api/"):
                recording_url = f"http://localhost:3001{recording_url}"
                
            headers = {"Authorization": f"Bearer {API_SECRET_KEY}"}
            async with session.get(recording_url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as rec:
                if rec.status == 200:
                    audio_bytes = await rec.read()
                    from aiogram.types import BufferedInputFile
                    audio_file = BufferedInputFile(audio_bytes, filename=f"call_{task_id}.wav")
                    await bot_instance.send_audio(
                        chat_id,
                        audio=audio_file,
                        title=f"Запись звонка — {place}",
                        performer="AI Ассистент",
                        caption="🎙 Запись разговора с заведением",
                    )
                else:
                    await bot_instance.send_message(
                        chat_id,
                        f"🎙 Не удалось загрузить запись (статус {rec.status})",
                    )
        except Exception as e:
            logger.error(f"Recording send error: {e}")
    else:
        await bot_instance.send_message(chat_id, "🔇 Запись ещё обрабатывается, попробуйте чуть позже.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
async def main():
    if not BOT_TOKEN:
        raise ValueError("BOT_TOKEN не задан в .env")

    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, get_vosk_model)

    bot_instance = Bot(token=BOT_TOKEN)
    dp_instance = Dispatcher(storage=MemoryStorage())
    dp_instance.include_router(router)

    logger.info("Bot started")
    asyncio.create_task(poll_call_results(bot_instance))
    await dp_instance.start_polling(bot_instance, skip_updates=True)


if __name__ == "__main__":
    asyncio.run(main())