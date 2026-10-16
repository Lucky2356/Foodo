"""Deterministic primitives; exact twins of frontend/src/engine/basics.ts."""

from __future__ import annotations

import math
from datetime import date, timedelta

MASK32 = 0xFFFFFFFF


def round_half_up(value: float, step: float) -> float:
    return math.floor(value / step + 0.5) * step


def round_kop(value: float) -> int:
    return math.floor(value + 0.5)


def clean_qty(value: float) -> float:
    return math.floor(value * 1e6 + 0.5) / 1e6


def clamp(value: float, low: float, high: float) -> float:
    if value < low:
        return low
    if value > high:
        return high
    return value


def _imul(a: int, b: int) -> int:
    return (a * b) & MASK32


class Rng:
    """mulberry32, operating on unsigned 32-bit patterns (identical bits to the JS version)."""

    def __init__(self, seed: int) -> None:
        self.state = int(math.floor(abs(seed))) % 4294967296
        self.draws = 0

    def next(self) -> float:
        self.draws += 1
        self.state = (self.state + 0x6D2B79F5) & MASK32
        a = self.state
        t = _imul(a ^ (a >> 15), 1 | a)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & MASK32) ^ t
        return ((t ^ (t >> 14)) & MASK32) / 4294967296


def parse_iso_date(value: str) -> date:
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError(f"Некорректная дата: {value}")
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError(f"Некорректная дата: {value}")
    return parsed


def is_iso_date(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parse_iso_date(value)
    except ValueError:
        return False
    return True


def add_days(value: str, days: int) -> str:
    return (parse_iso_date(value) + timedelta(days=days)).isoformat()


def iso_weekday(value: str) -> int:
    return parse_iso_date(value).isoweekday()


def days_between(start: str, end: str) -> int:
    return (parse_iso_date(end) - parse_iso_date(start)).days
