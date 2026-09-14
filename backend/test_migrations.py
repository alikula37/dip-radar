from sqlalchemy import create_engine, inspect, text

from migrations import run_migrations


def _create_legacy_database(path):
    engine = create_engine(f"sqlite:///{path}")
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE coins (symbol VARCHAR PRIMARY KEY, is_pre_2021 BOOLEAN)")
        )
        connection.execute(
            text(
                "CREATE TABLE klines ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, symbol VARCHAR, timestamp DATETIME, close FLOAT)"
            )
        )
        connection.execute(text("INSERT INTO coins (symbol, is_pre_2021) VALUES ('ETHBTC', 1)"))
        connection.execute(
            text("INSERT INTO klines (symbol, timestamp, close) VALUES ('ETHBTC', '2021-01-01', 1)")
        )
        connection.execute(
            text("INSERT INTO klines (symbol, timestamp, close) VALUES ('ETHBTC', '2021-01-01', 2)")
        )
        connection.execute(
            text("INSERT INTO klines (symbol, timestamp, close) VALUES ('ETHBTC', '2021-01-02', 3)")
        )
    return engine


def test_migrations_upgrade_legacy_database(tmp_path):
    engine = _create_legacy_database(tmp_path / "legacy.db")

    run_migrations(engine)
    run_migrations(engine)  # idempotent

    inspector = inspect(engine)
    coin_columns = {column["name"] for column in inspector.get_columns("coins")}
    assert "listed_checked" in coin_columns
    assert "is_stable" in coin_columns
    assert "valuation_pct_3y" in coin_columns
    assert "price_7d_ago_btc" in coin_columns
    assert "price_verified" in coin_columns

    with engine.connect() as connection:
        remaining = connection.execute(text("SELECT COUNT(*) FROM klines")).scalar()
        assert remaining == 2

        # Duplicate (symbol, timestamp) inserts must now be rejected.
        try:
            connection.execute(
                text("INSERT INTO klines (symbol, timestamp, close) VALUES ('ETHBTC', '2021-01-01', 9)")
            )
            connection.commit()
            inserted = True
        except Exception:
            inserted = False
    assert inserted is False


def test_migrations_are_noop_on_fresh_database(tmp_path):
    from database import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    Base.metadata.create_all(engine)

    run_migrations(engine)

    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM klines")).scalar() == 0
