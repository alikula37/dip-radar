def calculate_distance_pct(current_price: float, reference_low: float) -> float:
    if not current_price or not reference_low or reference_low == 0:
        return 0.0
    return ((current_price - reference_low) / reference_low) * 100

def calculate_bubble_sizes(coins: list, use_atl: bool = False):
    # Min-max scaling for bubble sizes, inversely proportional to distance_pct
    # Smaller distance -> larger bubble
    
    distances = []
    for c in coins:
        dist = c.distance_pct_atl if use_atl else c.distance_pct_event
        if dist is not None:
            distances.append(dist)
            
    if not distances:
        return
        
    min_dist = min(distances)
    max_dist = max(distances)
    
    MIN_BUBBLE_SIZE = 10.0
    MAX_BUBBLE_SIZE = 100.0
    
    for c in coins:
        dist = c.distance_pct_atl if use_atl else c.distance_pct_event
        if dist is None:
            size = MIN_BUBBLE_SIZE
        else:
            if max_dist == min_dist:
                size = MAX_BUBBLE_SIZE
            else:
                # Invert: max_dist gets MIN_BUBBLE, min_dist gets MAX_BUBBLE
                normalized = 1.0 - ((dist - min_dist) / (max_dist - min_dist))
                size = MIN_BUBBLE_SIZE + (normalized * (MAX_BUBBLE_SIZE - MIN_BUBBLE_SIZE))
                
        if use_atl:
            c.bubble_size_atl = size
        else:
            c.bubble_size_event = size
