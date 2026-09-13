def test_demo_seed_populates_database():
    import demo_seed
    from database import SessionLocal
    from models import Coin

    demo_seed.main(days=30)

    db = SessionLocal()
    try:
        assert db.query(Coin).count() == len(demo_seed.COINS)
        coin = db.get(Coin, "ETHBTC")
        assert coin.current_price_btc is not None
        assert coin.distance_pct_event is not None
        assert coin.price_7d_ago_btc is not None
    finally:
        db.close()

    # A second run must not duplicate data.
    demo_seed.main(days=30)

    db = SessionLocal()
    try:
        assert db.query(Coin).count() == len(demo_seed.COINS)
    finally:
        db.close()
