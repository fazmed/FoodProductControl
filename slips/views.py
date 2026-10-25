import json
from datetime import date, datetime, timedelta

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .models import Product, Slip

MAX_QUANTITY = 20


class BadRequest(Exception):
    pass


def api(view):
    """Wrap a JSON view: login required, JSON body parsed, errors as JSON."""

    @login_required
    def wrapper(request, *args, **kwargs):
        try:
            if request.method == "POST":
                try:
                    request.json = json.loads(request.body or "{}")
                except json.JSONDecodeError:
                    raise BadRequest("Invalid JSON.")
            return view(request, *args, **kwargs)
        except BadRequest as e:
            return JsonResponse({"error": str(e)}, status=400)

    wrapper.__name__ = view.__name__
    return wrapper


def staff_only(request):
    if not request.user.is_staff:
        raise BadRequest("Only an admin can change products.")


def product_json(p):
    return {
        "id": p.id,
        "name": p.name,
        "note": p.note,
        "group": p.group,
        "basis": p.basis,
        "duration_value": p.duration_value,
        "duration_unit": p.duration_unit,
        "sort_order": p.sort_order,
        "active": p.active,
        "shelf_life": p.shelf_life_label,
    }


def slip_json(s):
    return {
        "id": s.id,
        "product_ids": [p.id for p in s.products.all()],
        "time_in": timezone.localtime(s.time_in).isoformat(),
        "pull_at": timezone.localtime(s.pull_at).isoformat(),
        "initials": s.initials,
        "defrost_start": s.defrost_start.isoformat() if s.defrost_start else None,
        "kill_date": s.kill_date.isoformat() if s.kill_date else None,
        "shelf_life": s.shelf_life_label,
        "printed_at": timezone.localtime(s.printed_at).isoformat() if s.printed_at else None,
        "discarded_at": timezone.localtime(s.discarded_at).isoformat() if s.discarded_at else None,
        "discarded_by": s.discarded_by,
    }


def slips_queryset():
    """Slips on the board, plus the last 7 days of discarded ones (history)."""
    cond = Q(discarded_at__isnull=True) | Q(discarded_at__gte=timezone.now() - timedelta(days=7))
    return Slip.objects.filter(cond).prefetch_related("products").order_by("pull_at")


@login_required
def board(request):
    data = {
        "products": [product_json(p) for p in Product.objects.all()],
        "slips": [slip_json(s) for s in slips_queryset()],
        "groups": [{"key": k, "label": v} for k, v in Product.Group.choices],
        "is_admin": request.user.is_staff,
        "username": request.user.get_username(),
    }
    return render(request, "slips/board.html", {"data": data})


@api
@require_GET
def slip_list(request):
    return JsonResponse({"slips": [slip_json(s) for s in slips_queryset()]})


def parse_date(value, label):
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise BadRequest(f"{label} is not a valid date.")


@api
@require_POST
def slip_create(request):
    body = request.json
    initials = (body.get("initials") or "").strip().upper()
    if not initials:
        raise BadRequest("Initials are required.")

    ids = body.get("product_ids") or []
    products = list(Product.objects.filter(id__in=ids, active=True))
    if not products or len(products) != len(set(ids)):
        raise BadRequest("Pick at least one product.")

    time_in = timezone.now().replace(second=0, microsecond=0)
    if body.get("time_in"):
        try:
            time_in = datetime.fromisoformat(body["time_in"])
        except ValueError:
            raise BadRequest("Time in is not valid.")
        if timezone.is_naive(time_in):
            time_in = timezone.make_aware(time_in)

    defrost_start = parse_date(body.get("defrost_start"), "Defrost start date")
    kill_date = parse_date(body.get("kill_date"), "Kill date")

    try:
        quantity = int(body.get("quantity") or 1)
    except (TypeError, ValueError):
        raise BadRequest("Quantity must be a number.")
    if not 1 <= quantity <= MAX_QUANTITY:
        raise BadRequest(f"Quantity must be between 1 and {MAX_QUANTITY}.")

    # Products only share a slip when they always expire together;
    # otherwise each one gets its own slip.
    if body.get("combine") and len({p.rule_key for p in products}) == 1:
        batches = [products]
    else:
        batches = [[p] for p in products]

    created = []
    with transaction.atomic():
        for batch in batches:
            first = batch[0]
            try:
                pull_at = first.pull_at(time_in, defrost_start, kill_date)
            except ValueError as e:
                raise BadRequest(str(e))
            for _ in range(quantity):
                slip = Slip.objects.create(
                    time_in=time_in,
                    initials=initials,
                    defrost_start=defrost_start if first.basis == Product.Basis.DEFROST else None,
                    kill_date=kill_date if first.basis == Product.Basis.KILL else None,
                    pull_at=pull_at,
                    shelf_life_label=first.shelf_life_label,
                    created_by=request.user,
                )
                slip.products.set(batch)
                created.append(slip)
    return JsonResponse({"slips": [slip_json(s) for s in created]}, status=201)


@api
@require_POST
def slip_discard(request):
    ids = request.json.get("ids") or []
    initials = (request.json.get("initials") or "").strip().upper()
    count = Slip.objects.filter(id__in=ids, discarded_at__isnull=True).update(
        discarded_at=timezone.now(), discarded_by=initials
    )
    return JsonResponse({"discarded": count})


@api
@require_POST
def slip_restore(request):
    ids = request.json.get("ids") or []
    count = Slip.objects.filter(id__in=ids).update(discarded_at=None, discarded_by="")
    return JsonResponse({"restored": count})


@api
@require_POST
def slip_printed(request):
    """Mark slips printed (out of the print tray), or `printed: false` to put them back in."""
    ids = request.json.get("ids") or []
    printed = request.json.get("printed", True)
    count = Slip.objects.filter(id__in=ids).update(printed_at=timezone.now() if printed else None)
    return JsonResponse({"updated": count})


PRODUCT_FIELDS = ("name", "note", "group", "basis", "duration_value", "duration_unit", "sort_order", "active")


def apply_product_fields(product, body):
    for field in PRODUCT_FIELDS:
        if field in body:
            setattr(product, field, body[field])
    product.name = (product.name or "").strip()
    product.note = (product.note or "").strip()
    if not product.name:
        raise BadRequest("Product name is required.")
    if product.group not in Product.Group.values:
        raise BadRequest("Unknown group.")
    if product.basis not in Product.Basis.values:
        raise BadRequest("Unknown shelf-life rule.")
    if product.duration_unit not in Product.Unit.values:
        raise BadRequest("Unknown time unit.")
    try:
        product.duration_value = int(product.duration_value)
        product.sort_order = int(product.sort_order or 0)
    except (TypeError, ValueError):
        raise BadRequest("Shelf life must be a number.")
    if product.duration_value < 1:
        raise BadRequest("Shelf life must be at least 1.")
    product.active = bool(product.active)
    product.save()
    return product


@api
@require_POST
def product_create(request):
    staff_only(request)
    product = apply_product_fields(Product(), request.json)
    return JsonResponse({"product": product_json(product)}, status=201)


@api
@require_POST
def product_update(request, pk):
    staff_only(request)
    product = apply_product_fields(get_object_or_404(Product, pk=pk), request.json)
    return JsonResponse({"product": product_json(product)})


@api
@require_POST
def product_delete(request, pk):
    """Delete a product for good. Refused while slips on the board still use it."""
    staff_only(request)
    product = get_object_or_404(Product, pk=pk)
    in_use = product.slips.filter(discarded_at__isnull=True).count()
    if in_use:
        raise BadRequest(
            f"{product} is on {in_use} slip{'s' if in_use > 1 else ''} on the board. "
            "Discard those slips first, or untick Active to hide the product instead."
        )
    product.delete()  # discarded slips in history just lose the link
    return JsonResponse({"deleted": pk})
