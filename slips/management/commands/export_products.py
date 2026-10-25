import json

from django.core.management.base import BaseCommand

from slips.models import Product

from ._timings import DEFAULT_FILE, FIELDS


class Command(BaseCommand):
    help = "Save all products and their timings to product_timings.json (commit it to share)."

    def add_arguments(self, parser):
        parser.add_argument("--file", default=str(DEFAULT_FILE))

    def handle(self, *args, file, **options):
        rows = [{f: getattr(p, f) for f in FIELDS} for p in Product.objects.all()]
        with open(file, "w") as fh:
            json.dump(rows, fh, indent=2)
            fh.write("\n")
        self.stdout.write(self.style.SUCCESS(f"Saved {len(rows)} products to {file}"))
