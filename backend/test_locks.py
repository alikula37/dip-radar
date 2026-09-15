from datetime import timedelta

from locks import DEFAULT_TTL_MINUTES, is_locked, release_lock, renew_lock, try_acquire_lock
from models import SyncLock
from timeutils import utcnow_naive


def test_lock_lifecycle_and_expiry_takeover(db):
    assert not is_locked(db)

    assert try_acquire_lock(db, ttl_minutes=1) is True
    assert try_acquire_lock(db, ttl_minutes=1) is False
    assert is_locked(db)

    release_lock(db)
    assert not is_locked(db)

    # An expired lock may be taken over by the next sync.
    assert try_acquire_lock(db, ttl_minutes=1) is True
    lock = db.get(SyncLock, "sync")
    lock.expires_at = utcnow_naive() - timedelta(minutes=1)
    db.commit()

    assert is_locked(db) is False
    assert try_acquire_lock(db, ttl_minutes=1) is True


def test_renew_lock_slides_the_expiry_forward(db):
    assert try_acquire_lock(db, ttl_minutes=1) is True
    lock = db.get(SyncLock, "sync")
    lock.expires_at = utcnow_naive() + timedelta(minutes=1)
    db.commit()

    assert renew_lock(db) is True

    renewed = db.get(SyncLock, "sync")
    assert renewed.expires_at > utcnow_naive() + timedelta(minutes=DEFAULT_TTL_MINUTES - 1)


def test_renew_lock_is_a_noop_without_a_lock(db):
    assert renew_lock(db) is False


def test_sync_progress_renews_the_lock(db):
    import fetcher

    assert try_acquire_lock(db, ttl_minutes=1) is True
    lock = db.get(SyncLock, "sync")
    lock.expires_at = utcnow_naive() + timedelta(minutes=1)
    db.commit()

    fetcher.write_sync_progress(db, "klines", 5, 10)

    renewed = db.get(SyncLock, "sync")
    assert renewed.expires_at > utcnow_naive() + timedelta(minutes=DEFAULT_TTL_MINUTES - 1)
