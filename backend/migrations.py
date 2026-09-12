import logging

from sqlalchemy import Engine, inspect, text

logger = logging.getLogger(__name__)

# Columns added after the initial release. They must be applied to databases
# created by older versions, because Base.metadata.create_all() never alters
# existing tables.
COIN_COLUMNS = {
    "listed_checked": "BOOLEAN NOT NULL DEFAULT 0",
    "price_7d_ago_btc": "FLOAT",
    "price_30d_ago_btc": "FLOAT",
    "price_verified": "BOOLEAN",
    "price_deviation_pct": "FLOAT",
}


def _has_unique_index(connection, table: str, columns: list) -> bool:
    index_rows = connection.execute(text(f"PRAGMA index_list('{table}')")).fetchall()
    for row in index_rows:
        name, is_unique = row[1], row[2]
        if not is_unique:
            continue
        indexed_columns = [
            info[2]
            for info in connection.execute(text(f"PRAGMA index_info('{name}')")).fetchall()
        ]
        if indexed_columns == columns:
            return True
    return False


def _deduplicate_klines(connection) -> int:
    duplicates = connection.execute(
        text(
            "SELECT COUNT(*) FROM klines "
            "WHERE id NOT IN (SELECT MIN(id) FROM klines GROUP BY symbol, timestamp)"
        )
    ).scalar()
    if duplicates:
        connection.execute(
            text(
                "DELETE FROM klines "
                "WHERE id NOT IN (SELECT MIN(id) FROM klines GROUP BY symbol, timestamp)"
            )
        )
        logger.warning("Removed %s duplicate kline rows.", duplicates)
    return duplicates or 0


def run_migrations(engine: Engine) -> None:
    """Apply lightweight, idempotent migrations for existing SQLite databases."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    with engine.begin() as connection:
        if "coins" in tables:
            existing_columns = {column["name"] for column in inspector.get_columns("coins")}
            for name, ddl in COIN_COLUMNS.items():
                if name not in existing_columns:
                    connection.execute(text(f"ALTER TABLE coins ADD COLUMN {name} {ddl}"))
                    logger.info("Migration: added coins.%s", name)

        if "klines" in tables:
            _deduplicate_klines(connection)
            if not _has_unique_index(connection, "klines", ["symbol", "timestamp"]):
                connection.execute(
                    text(
                        "CREATE UNIQUE INDEX uq_kline_symbol_timestamp "
                        "ON klines (symbol, timestamp)"
                    )
                )
                logger.info("Migration: created unique index on klines(symbol, timestamp)")
