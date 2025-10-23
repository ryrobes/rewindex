"""Sparkline utilities for visualizing timeline data."""

from __future__ import annotations


def create_sparkline(values: list[int | float], width: int = 20, height: int = 8) -> str:
    """Create ASCII sparkline visualization.

    Args:
        values: List of numeric values to visualize
        width: Desired width of sparkline (will sample/interpolate data to fit)
        height: Number of different bar heights (default 8 for full block chars)

    Returns:
        String with sparkline using Unicode block characters
    """
    # Unicode block characters from empty to full
    chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

    if not values:
        return '─' * width

    # Ensure we have the right number of values for width
    if len(values) > width:
        # Sample data to fit width
        step = len(values) / width
        sampled = [values[int(i * step)] for i in range(width)]
        values = sampled
    elif len(values) < width:
        # Pad with zeros or interpolate
        values = values + [0] * (width - len(values))

    # Normalize to 0-7 range (8 chars)
    min_val = min(values)
    max_val = max(values)

    if max_val == min_val:
        # All values are the same
        return chars[4] * len(values)  # Use middle character

    # Normalize each value to 0-7 index
    normalized = []
    for v in values:
        if max_val > min_val:
            norm = (v - min_val) / (max_val - min_val) * 7
            normalized.append(int(norm))
        else:
            normalized.append(4)

    return ''.join(chars[n] for n in normalized)


def create_sparkline_with_labels(
    values: list[int | float],
    labels: list[str] | None = None,
    width: int = 40,
    show_min_max: bool = True
) -> str:
    """Create sparkline with optional labels and min/max values.

    Args:
        values: Numeric values to visualize
        labels: Optional labels for start/end
        width: Width of sparkline
        show_min_max: Whether to show min/max values

    Returns:
        Formatted sparkline string with labels
    """
    if not values:
        return ""

    sparkline = create_sparkline(values, width)

    if show_min_max:
        min_val = min(values)
        max_val = max(values)
        result = f"{min_val:>6.0f} {sparkline} {max_val:<6.0f}"
    else:
        result = sparkline

    if labels and len(labels) >= 2:
        start_label = labels[0]
        end_label = labels[-1]
        label_line = f"{start_label:<{width//2}}{'':>{width//2 - len(end_label)}}{end_label}"
        result = f"{result}\n{label_line}"

    return result
