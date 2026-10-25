from datetime import datetime, timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


class Product(models.Model):
    """A product that can go on a control slip, with its shelf-life rule."""

    class Group(models.TextChoices):
        PREP = "prep", "Prep Items"
        SAUCE = "sauce", "Sauces & Spreads"
        CHEESE = "cheese", "Cheese"
        FROZEN = "frozen", "Frozen"
        SEASONED = "seasoned", "Seasoned Chicken"
        MISC = "misc", "Misc. Items"

    class Basis(models.TextChoices):
        TIME_IN = "time_in", "From time in"
        DEFROST = "defrost", "From defrost start date"
        KILL = "kill", "From kill date"

    class Unit(models.TextChoices):
        HOURS = "hours", "Hours"
        DAYS = "days", "Days"
        WEEKS = "weeks", "Weeks"

    name = models.CharField(max_length=80)
    note = models.CharField(
        max_length=80, blank=True, help_text='Shown under the name, e.g. "Walk-in Cooler".'
    )
    group = models.CharField(max_length=10, choices=Group.choices, default=Group.PREP)
    basis = models.CharField(max_length=10, choices=Basis.choices, default=Basis.TIME_IN)
    duration_value = models.PositiveIntegerField(default=1)
    duration_unit = models.CharField(max_length=5, choices=Unit.choices, default=Unit.DAYS)
    sort_order = models.PositiveIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return f"{self.name} ({self.note})" if self.note else self.name

    @property
    def duration(self):
        unit = {"hours": "hours", "days": "days", "weeks": "weeks"}[self.duration_unit]
        return timedelta(**{unit: self.duration_value})

    @property
    def rule_key(self):
        """Products with the same rule key always get the same pull time."""
        return (self.basis, self.duration_value, self.duration_unit)

    @property
    def shelf_life_label(self):
        unit = self.get_duration_unit_display().lower()
        if self.duration_value == 1:
            unit = unit.rstrip("s")
        label = f"{self.duration_value} {unit}"
        if self.basis == self.Basis.DEFROST:
            label += " from defrost"
        elif self.basis == self.Basis.KILL:
            label += " from kill date"
        return label

    def pull_at(self, time_in, defrost_start=None, kill_date=None):
        """Work out when product made at `time_in` must be pulled.

        Defrost- and kill-based items count from that date, at the same
        time of day as the time in (e.g. kill 06/10, in 2:45 PM, 4 days
        -> pull 10/10 2:45 PM), which is how the paper slips are filled.
        """
        if self.basis == self.Basis.TIME_IN:
            start = time_in
        else:
            day = defrost_start if self.basis == self.Basis.DEFROST else kill_date
            if day is None:
                raise ValueError(f"{self.name} needs a {self.get_basis_display().lower()}.")
            local_in = timezone.localtime(time_in)
            start = timezone.make_aware(datetime.combine(day, local_in.time().replace(microsecond=0)))
        return start + self.duration


class Slip(models.Model):
    products = models.ManyToManyField(Product, related_name="slips")
    time_in = models.DateTimeField(default=timezone.now)
    initials = models.CharField(max_length=10)
    defrost_start = models.DateField(null=True, blank=True)
    kill_date = models.DateField(null=True, blank=True)
    # Snapshotted when the slip is created, so later product edits
    # don't silently move the pull time of food already on the shelf.
    pull_at = models.DateTimeField()
    shelf_life_label = models.CharField(max_length=60, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)
    discarded_at = models.DateTimeField(null=True, blank=True)
    discarded_by = models.CharField(max_length=10, blank=True)

    class Meta:
        ordering = ["pull_at"]

    def __str__(self):
        names = ", ".join(p.name for p in self.products.all())
        return f"{names} - pull {timezone.localtime(self.pull_at):%d/%m %I:%M %p}"
