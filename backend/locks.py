import logging
from datetime import timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import SyncLock
from timeutils import utcnow_naive

logger = logging.getLogger(__name__)

DEFAULT_LOCK_NAME = "sync"
DEFAULT_TTL_MINUTES = 60


def renew_lock(db: Session, name: str = DEFAULT_LOCK_NAME, ttl_minutes: int = DEFAULT_TTL_MINUTES) -> bool:
    """Slide the owner's expiry forward; keeps a dead process from blocking for hours.

    The whole point of the shorter TTL is that a killed sync (container
    rebuild, OOM, ...) stops blocking new syncs quickly, while a live sync
    keeps the lock because every progress write renews it.
    """
    lock = db.get(SyncLock, name)
    if lock is None:
        return False
    lock.expires_at = utcnow_naive() + timedelta(minutes=ttl_minutes)
    db.commit()
    return True


def try_acquire_lock(db: Session, name: str = DEFAULT_LOCK_NAME, ttl_minutes: int = DEFAULT_TTL_MINUTES) -> bool:
    """Cross-process lock backed by the shared SQLite database.

    Returns True when the lock was acquired, False when another process holds it.
    Expired locks are taken over optimistically.
    """
    now = utcnow_naive()
    expires_at = now + timedelta(minutes=ttl_minutes)

    try:
        db.add(SyncLock(name=name, acquired_at=now, expires_at=expires_at))
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
    except Exception:
        db.rollback()
        raise

    lock = db.get(SyncLock, name)
    if lock is None:
        return False

    if lock.expires_at is not None and lock.expires_at < now:
        updated = (
            db.query(SyncLock)
            .filter(SyncLock.name == name, SyncLock.expires_at == lock.expires_at)
            .update({"acquired_at": now, "expires_at": expires_at})
        )
        db.commit()
        if updated:
            logger.warning("Took over expired sync lock '%s'.", name)
            return True

    return False


def release_lock(db: Session, name: str = DEFAULT_LOCK_NAME) -> None:
    db.query(SyncLock).filter(SyncLock.name == name).delete()
    db.commit()


def is_locked(db: Session, name: str = DEFAULT_LOCK_NAME) -> bool:
    lock = db.get(SyncLock, name)
    if lock is None:
        return False
    if lock.expires_at is not None and lock.expires_at < utcnow_naive():
        return False
    return True
