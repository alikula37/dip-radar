import logging
import os

from apscheduler.schedulers.blocking import BlockingScheduler

from database import Base, engine
from fetcher import run_sync_with_lock
from migrations import run_migrations

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s:%(name)s:%(message)s",
)
logger = logging.getLogger(__name__)


def job() -> None:
    logger.info("Running scheduled sync...")
    try:
        started = run_sync_with_lock()
    except Exception:
        logger.exception("Scheduled sync failed.")
        return
    logger.info("Sync %s.", "completed" if started else "skipped (already running)")


if __name__ == "__main__":
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    logger.info("Starting worker...")
    # Run once on startup, then every 24 hours.
    job()

    scheduler = BlockingScheduler()
    scheduler.add_job(job, "interval", hours=24, max_instances=1, coalesce=True, jitter=300)
    scheduler.start()
