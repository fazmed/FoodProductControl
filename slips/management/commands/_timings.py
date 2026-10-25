from pathlib import Path

from django.conf import settings

DEFAULT_FILE = Path(settings.BASE_DIR) / "product_timings.json"
FIELDS = ("name", "note", "group", "basis", "duration_value", "duration_unit", "sort_order", "active")
