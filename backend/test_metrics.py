import unittest
from metrics import calculate_distance_pct, calculate_bubble_sizes

class DummyCoin:
    def __init__(self, distance_pct_event, distance_pct_atl):
        self.distance_pct_event = distance_pct_event
        self.distance_pct_atl = distance_pct_atl
        self.bubble_size_event = None
        self.bubble_size_atl = None

class TestMetrics(unittest.TestCase):
    def test_calculate_distance_pct(self):
        self.assertEqual(calculate_distance_pct(150, 100), 50.0)
        self.assertEqual(calculate_distance_pct(100, 100), 0.0)
        self.assertEqual(calculate_distance_pct(50, 100), -50.0)
        self.assertEqual(calculate_distance_pct(0, 100), 0.0)
        self.assertEqual(calculate_distance_pct(100, 0), 0.0)

    def test_calculate_bubble_sizes(self):
        coins = [
            DummyCoin(10.0, 20.0),
            DummyCoin(50.0, 60.0),
            DummyCoin(100.0, 110.0)
        ]
        
        calculate_bubble_sizes(coins, use_atl=False)
        
        # Min distance (10.0) should have max bubble size (100.0)
        self.assertEqual(coins[0].bubble_size_event, 100.0)
        # Max distance (100.0) should have min bubble size (10.0)
        self.assertEqual(coins[2].bubble_size_event, 10.0)
        # Middle distance (50.0) should be in between
        self.assertTrue(10.0 < coins[1].bubble_size_event < 100.0)

if __name__ == '__main__':
    unittest.main()
