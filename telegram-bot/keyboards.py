from aiogram.types import (
    InlineKeyboardMarkup, InlineKeyboardButton,
    ReplyKeyboardMarkup, KeyboardButton,
    ReplyKeyboardRemove,
)
from aiogram.utils.keyboard import InlineKeyboardBuilder, ReplyKeyboardBuilder

CITIES = ["Астана", "Алматы", "Шымкент", "Атырау", "Актобе", "Другой город"]


def kb_start() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="✨ Новая задача", callback_data="new_task")
    return builder.as_markup()


def kb_share_phone() -> ReplyKeyboardMarkup:
    builder = ReplyKeyboardBuilder()
    builder.button(text="📱 Поделиться номером", request_contact=True)
    return builder.as_markup(resize_keyboard=True, one_time_keyboard=True)


def kb_cities() -> ReplyKeyboardMarkup:
    builder = ReplyKeyboardBuilder()
    for city in CITIES:
        builder.button(text=city)
    builder.adjust(2)
    return builder.as_markup(resize_keyboard=True, one_time_keyboard=True)


def kb_confirm() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="✅ Подтвердить",   callback_data="confirm")
    builder.button(text="✏️ Изменить",      callback_data="edit")
    builder.button(text="❌ Отмена",        callback_data="cancel")
    builder.adjust(2, 1)
    return builder.as_markup()


def kb_remove() -> ReplyKeyboardRemove:
    return ReplyKeyboardRemove()