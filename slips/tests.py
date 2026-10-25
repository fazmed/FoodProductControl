import json
from datetime import date, datetime

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from .models import Product, Slip


def local(*args):
    return timezone.make_aware(datetime(*args))


class PullTimeTests(TestCase):
    """Cases taken from the real paper slips."""

    def get(self, name, note=""):
        return Product.objects.get(name=name, note=note)

    def test_hours_and_days_from_time_in(self):
        # Buttermilk Batter, in Tue 06/10 1:45 PM -> pull Fri 09/10 1:45 PM
        self.assertEqual(self.get("Buttermilk Batter").pull_at(local(2026, 10, 6, 13, 45)), local(2026, 10, 9, 13, 45))
        # Strawberry Syrup is 12 hrs: 11 AM -> 11 PM same day
        self.assertEqual(self.get("Strawberry Syrup").pull_at(local(2026, 10, 7, 11)), local(2026, 10, 7, 23))
        # Chopped Chicken 36 hrs
        self.assertEqual(self.get("Chopped Chicken").pull_at(local(2026, 10, 7, 11)), local(2026, 10, 8, 23))
        # Pulled Chicken in the freezer, 4 weeks
        self.assertEqual(self.get("Pulled Chicken", "Freezer").pull_at(local(2026, 10, 1, 9)), local(2026, 10, 29, 9))

    def test_days_keep_clock_time_across_daylight_saving(self):
        # Clocks go back on Sun 01 Nov 2026 in Toronto: 7 days from Sun 25 Oct 5:52 PM
        # is still 5:52 PM on the pull day, not 4:52 PM.
        made = timezone.now().replace(year=2026, month=10, day=25, hour=21, minute=52, second=0, microsecond=0)  # 5:52 PM EDT
        pull = timezone.localtime(self.get("Spicy Mayo").pull_at(made))
        self.assertEqual((pull.day, pull.hour, pull.minute), (1, 17, 52))
        # Hour-based items count real elapsed time.
        hours = self.get("Strawberry Syrup").pull_at(made)
        self.assertEqual((hours - made).total_seconds(), 12 * 3600)

    def test_frozen_counts_from_defrost_start(self):
        # Spicy Tenders, defrost start 01/10, in 11 AM -> pull 08/10 11 AM
        p = self.get("Spicy Tenders", "Frozen")
        self.assertEqual(p.pull_at(local(2026, 10, 1, 11), defrost_start=date(2026, 10, 1)), local(2026, 10, 8, 11))
        with self.assertRaises(ValueError):
            p.pull_at(local(2026, 10, 1, 11))

    def test_seasoned_chicken_counts_from_time_in(self):
        # Mild Dark, in 07/10 2:45 PM -> pull 11/10 2:45 PM (4 days)
        self.assertEqual(self.get("Mild Dark").pull_at(local(2026, 10, 7, 14, 45)), local(2026, 10, 11, 14, 45))
        self.assertEqual(self.get("Spicy White").pull_at(local(2026, 10, 7, 14, 45)), local(2026, 10, 11, 14, 45))
        self.assertFalse(self.get("Spicy Wings").active)  # not a product at this store: hidden
        self.assertFalse(self.get("Mild Wings").active)

    def test_kill_date_rule_still_available(self):
        # An admin can still set a product to count from the kill date.
        p = self.get("Mild Dark")
        p.basis = Product.Basis.KILL
        self.assertEqual(p.pull_at(local(2026, 10, 7, 14, 45), kill_date=date(2026, 10, 6)), local(2026, 10, 10, 14, 45))

    def test_seeded_catalogue(self):
        self.assertEqual(Product.objects.count(), 48)
        self.assertEqual(self.get("Tortilla Bread").shelf_life_label, "2 days")
        self.assertEqual(self.get("Mild Mayo").shelf_life_label, "30 days")
        self.assertEqual(self.get("Bone-in Wings", "Frozen").shelf_life_label, "7 days from defrost")
        self.assertEqual(self.get("Spicy Dark").shelf_life_label, "4 days")

    def test_fresh_chicken_counts_from_time_in(self):
        made = local(2026, 10, 7, 11)
        for name in ("Fillet", "Nuggets/LTO", "Boneless Wings", "Spicy Tenders", "Mild Tenders"):
            self.assertEqual(self.get(name, "Fresh").pull_at(made), local(2026, 10, 11, 11), name)  # boneless: 4 days
        self.assertEqual(self.get("Bone-in Wings", "Fresh").pull_at(made), local(2026, 10, 10, 11))  # bone-in: 3 days
        self.assertEqual(self.get("Fillet", "Fresh").group, "fresh_boneless")
        self.assertEqual(self.get("Bone-in Wings", "Fresh").group, "fresh_bonein")
        self.assertEqual(self.get("Fillet", "Frozen").group, "frozen_boneless")
        self.assertEqual(self.get("Bone-in Wings", "Frozen").group, "frozen_bonein")


class ApiTests(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("admin", password="pw", is_staff=True)
        self.client.force_login(self.staff)

    def post(self, url, body):
        return self.client.post(url, json.dumps(body), content_type="application/json")

    def ids(self, *names):
        return [Product.objects.filter(name=n).order_by("id").first().id for n in names]

    def test_board_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.get("/").status_code, 302)
        self.assertEqual(self.client.get("/api/slips/").status_code, 302)

    def test_board_renders(self):
        res = self.client.get("/")
        self.assertContains(res, "CONTROL SLIPS")
        self.assertContains(res, "initial-data")

    def test_create_combined_and_separate(self):
        sauces = self.ids("HBBQ", "H Garlic", "S'Hot")
        res = self.post("/api/slips/create/", {
            "product_ids": sauces, "initials": "kr", "time_in": "2026-10-07T11:00", "combine": True,
        })
        self.assertEqual(res.status_code, 201)
        slips = res.json()["slips"]
        self.assertEqual(len(slips), 1)
        self.assertEqual(sorted(slips[0]["product_ids"]), sorted(sauces))
        self.assertEqual(slips[0]["initials"], "KR")
        self.assertTrue(slips[0]["pull_at"].startswith("2026-10-10T11:00"))

        # Different shelf lives never share a slip, even when asked to.
        res = self.post("/api/slips/create/", {
            "product_ids": self.ids("Lettuce", "Pickles"), "initials": "KR", "combine": True, "quantity": 2,
        })
        self.assertEqual(len(res.json()["slips"]), 4)

    def test_create_seasoned_chicken_without_kill_date(self):
        res = self.post("/api/slips/create/", {
            "product_ids": self.ids("Spicy Dark"), "initials": "JS", "time_in": "2026-10-07T15:45", "quantity": 6,
        })
        self.assertEqual(res.status_code, 201)
        slips = res.json()["slips"]
        self.assertEqual(len(slips), 6)
        self.assertTrue(slips[0]["pull_at"].startswith("2026-10-11T15:45"))
        self.assertIsNone(slips[0]["kill_date"])

    def test_create_needs_defrost_date(self):
        res = self.post("/api/slips/create/", {"product_ids": self.ids("Fillet"), "initials": "JS"})
        self.assertEqual(res.status_code, 400)

    def test_discard_and_restore(self):
        slip = self.post("/api/slips/create/", {"product_ids": self.ids("Lettuce"), "initials": "KR"}).json()["slips"][0]
        self.post("/api/slips/discard/", {"ids": [slip["id"]], "initials": "sk"})
        s = Slip.objects.get(id=slip["id"])
        self.assertIsNotNone(s.discarded_at)
        self.assertEqual(s.discarded_by, "SK")
        self.post("/api/slips/restore/", {"ids": [slip["id"]]})
        self.assertIsNone(Slip.objects.get(id=slip["id"]).discarded_at)

    def test_print_tray(self):
        created = self.post("/api/slips/create/", {
            "product_ids": self.ids("Lettuce", "Pickles"), "initials": "KR",
        }).json()["slips"]
        ids = [s["id"] for s in created]
        # New slips wait in the tray (not printed yet).
        self.assertTrue(all(s["printed_at"] is None for s in created))

        self.post("/api/slips/printed/", {"ids": ids})
        self.assertFalse(Slip.objects.filter(id__in=ids, printed_at__isnull=True).exists())

        # Put one back in the tray to reprint.
        self.post("/api/slips/printed/", {"ids": ids[:1], "printed": False})
        self.assertEqual(list(Slip.objects.filter(printed_at__isnull=True).values_list("id", flat=True)), ids[:1])

    def test_product_edit_is_staff_only_and_keeps_old_pull_times(self):
        lettuce = Product.objects.get(name="Lettuce")
        slip = self.post("/api/slips/create/", {
            "product_ids": [lettuce.id], "initials": "KR", "time_in": "2026-10-07T11:00",
        }).json()["slips"][0]

        res = self.post(f"/api/products/{lettuce.id}/", {"name": "Lettuce (shredded)", "duration_value": 2})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["product"]["shelf_life"], "2 days")
        self.assertTrue(Slip.objects.get(id=slip["id"]).pull_at == local(2026, 10, 8, 11))

        staff_user = User.objects.create_user("crew", password="pw")
        self.client.force_login(staff_user)
        res = self.post(f"/api/products/{lettuce.id}/", {"duration_value": 9})
        self.assertEqual(res.status_code, 400)

    def test_delete_product(self):
        pickles = Product.objects.get(name="Pickles")
        slip = self.post("/api/slips/create/", {"product_ids": [pickles.id], "initials": "KR"}).json()["slips"][0]
        # Still on the board: refused.
        res = self.post(f"/api/products/{pickles.id}/delete/", {})
        self.assertEqual(res.status_code, 400)
        self.assertIn("Discard those slips first", res.json()["error"])
        # Once discarded, it can be deleted; the history slip stays.
        self.post("/api/slips/discard/", {"ids": [slip["id"]], "initials": "KR"})
        self.assertEqual(self.post(f"/api/products/{pickles.id}/delete/", {}).status_code, 200)
        self.assertFalse(Product.objects.filter(id=pickles.id).exists())
        self.assertTrue(Slip.objects.filter(id=slip["id"]).exists())
        # Crew (non-admin) can't delete.
        self.client.force_login(User.objects.create_user("crew2", password="pw"))
        lettuce = Product.objects.get(name="Lettuce")
        self.assertEqual(self.post(f"/api/products/{lettuce.id}/delete/", {}).status_code, 400)

    def test_add_product(self):
        res = self.post("/api/products/create/", {
            "name": "Coleslaw Dressing", "group": "sauce", "basis": "time_in", "duration_value": 5, "duration_unit": "days",
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["product"]["shelf_life"], "5 days")
        self.assertEqual(self.post("/api/products/create/", {"name": ""}).status_code, 400)


class TimingsFileTests(TestCase):
    def test_export_then_load_on_a_new_computer(self):
        import tempfile
        from pathlib import Path

        from django.core.management import call_command

        path = Path(tempfile.mkdtemp()) / "timings.json"
        # Main computer: admin renamed Lettuce and changed Pickles, then exported.
        Product.objects.filter(name="Pickles").update(duration_value=6)
        Product.objects.filter(name="Lettuce").update(name="Shredded Lettuce")
        Product.objects.create(name="Ranch", group="sauce", duration_value=5)
        call_command("export_products", file=str(path))
        exported = json.loads(path.read_text())
        self.assertEqual(len(exported), 49)  # export includes hidden products

        # New computer: fresh default products, then load the file.
        from django.apps import apps
        from importlib import import_module

        Product.objects.all().delete()
        import_module("slips.migrations.0002_seed_products").seed(apps, None)
        self.assertTrue(Product.objects.filter(name="Lettuce").exists())
        call_command("load_products", file=str(path), stdout=open("/dev/null", "w"))

        self.assertEqual(Product.objects.get(name="Pickles").duration_value, 6)
        self.assertTrue(Product.objects.get(name="Ranch").active)
        self.assertTrue(Product.objects.get(name="Shredded Lettuce").active)
        self.assertFalse(Product.objects.get(name="Lettuce").active)  # hidden, not deleted
        self.assertEqual(Product.objects.filter(active=True).count(), 47)
