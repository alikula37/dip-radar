from apscheduler.schedulers.blocking import BlockingScheduler
from database import SessionLocal, engine, Base
from fetcher import run_all_syncs
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)

def job():
    logger.info("Running scheduled sync...")
    db = SessionLocal()
    try:
        run_all_syncs(db)
    finally:
        db.close()
    logger.info("Sync completed.")

if __name__ == "__main__":
    logger.info("Starting worker...")
    # Run once on startup
    job()
    
    scheduler = BlockingScheduler()
    scheduler.add_job(job, 'interval', hours=24)
    scheduler.start()
