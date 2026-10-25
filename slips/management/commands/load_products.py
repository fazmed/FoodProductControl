import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from slips.models import Product

from ._timings import DEFAULT_FILE, FIELDS


class Command(BaseCommand):
    help = (
        "Load products and timings from product_timings.json. Run once on a new computer "
        "after `migrate`. The product list then matches the file exactly; products not in "
        "the file are hidden (not deleted). Slips are never touched."
    )

    def add_arguments(self, parser):
        parser.add_argument("--file", default=str(DEFAULT_FILE))

    def handle(self, *args, file, **options):
        try:
            with open(file) as fh:
                rows = json.load(fh)
        except FileNotFoundError:
            raise CommandError(f"{file} not found. Run `export_products` on the main computer first.")
        except json.JSONDecodeError as e:
            raise CommandError(f"{file} is not valid JSON: {e}")

        created = updated = 0
        kept = set()
        with transaction.atomic():
            for row in rows:
                if not row.get("name"):
                    raise CommandError(f"A product in {file} has no name: {row}")
                product = Product.objects.filter(name=row["name"], note=row.get("note", "")).first()
                if product is None:
                    product, created = Product(), created + 1
                else:
                    updated += 1
                for f in FIELDS:
                    if f in row:
                        setattr(product, f, row[f])
                product.full_clean()
                product.save()
                kept.add(product.pk)
            hidden = Product.objects.exclude(pk__in=kept).filter(active=True).update(active=False)

        self.stdout.write(self.style.SUCCESS(
            f"Loaded {len(rows)} products from {file}: {created} added, {updated} updated, {hidden} hidden."
        ))
