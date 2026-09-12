from datetime import datetime, timezone


def utcnow() -> datetime:
    """Timezone-aware current UTC time."""
    return datetime.now(timezone.utc)


def utcnow_naive() -> datetime:
    """UTC now without tzinfo; SQLite columns store naive UTC datetimes."""
    return utcnow().replace(tzinfo=None)


def to_millis(value: datetime) -> int:
    """Convert a (naive UTC or aware) datetime to epoch milliseconds."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return int(value.timestamp() * 1000)


def from_millis(value: int) -> datetime:
    """Convert epoch milliseconds to a naive UTC datetime."""
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).replace(tzinfo=None)
