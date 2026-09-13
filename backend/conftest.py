import os
import sys
import tempfile

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# database.py reads DB_DIR at import time; isolate every test run.
os.environ.setdefault("DB_DIR", tempfile.mkdtemp(prefix="dip-radar-tests-"))
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("SYNC_REQUEST_DELAY", "0")
os.environ.setdefault("COINGECKO_BATCH_DELAY", "0")
os.environ.setdefault("SYNC_FETCH_WORKERS", "1")


@pytest.fixture
def db():
    from database import Base

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()

