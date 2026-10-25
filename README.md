# Product Control Slips

A one-page Django app that replaces the paper Product Control Slips. It shows every slip on one board with coloured borders (green = fresh, amber = pull within 2 hours, red = expired). It works out pull times automatically and prints slips onto US Letter paper.

## Setup (first time)

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate            # creates the database with the default products
.venv/bin/python manage.py load_products      # one time: feeds the timings from product_timings.json
.venv/bin/python manage.py createsuperuser    # the admin username + password
.venv/bin/python manage.py runserver 0.0.0.0:8000
```

Open http://localhost:8000 (or the computer's IP from a tablet on the same Wi-Fi) and sign in.

## Daily use

- **+ New Slip**: tap the product(s), type your initials, then **Save & Print**. Time in defaults to now.
  - Frozen items ask for the **defrost start date** and seasoned chicken asks for the **kill date**.
  - **How many slips** prints one slip per pan (e.g. 6 pans of Spicy Dark).
  - Products with the same shelf life (e.g. HBBQ, H Garlic, S'Hot) can share one slip.
- **Click a slip** to see it exactly as it prints, then Print / Discard / Replace & reprint.
- **Tick several slips** (or **Select expired**) to print, discard or replace them together.
- **Replace & reprint**: discards the old slip, makes a fresh one starting now, and prints it.
- **History (7 days)**: discarded slips, with who discarded them. They can be put back on the board.

## Printing

**Print settings** (any user; saved per computer/tablet, so each printer can have its own):

| Layout | Per page | Paper |
|---|---|---|
| Full form | 3 | US Letter, landscape; cut into 3 strips |
| Compact | 8 | US Letter, portrait; cut into 8 |
| Labels | 10 | 2" × 4" sticker sheets (Avery 5163 / 8163); set **Start at label #** to use a part-used sheet |

**Print tray**
- **Save to tray** keeps new slips in the tray, so you can print a full page at once with **Print tray → Print now**.
- **Save & Print now** prints straight away.
- After printing, the app asks if it printed OK. Answer OK to empty the tray, or Cancel to keep the slips for another try.
- **Add to tray** queues existing slips for a reprint.

**Replacing a slip**
- **Replace & reprint** makes a fresh slip and prints it straight away.
- **Replace & save** makes a fresh slip and puts it in the tray instead.

In the browser print dialog, set margins to "Default" (or "None" for labels), scale to 100%, and turn off "Headers and footers".

## Products & shelf life (admin)

Use the **Products** button (admin users only) to rename products, change shelf lives, add new products or hide old ones. Each product has a rule:

| Counted from | Example |
|---|---|
| Time in | Lettuce: 1 day, Strawberry Syrup: 12 hours, Pulled Chicken (Freezer): 4 weeks |
| Defrost start | Frozen chicken: 7 days total, thawing included |
| Kill date | Seasoned chicken: Dark/White 4 days, Wings 3 days |

Changes only affect **new** slips. Slips already on the board keep the pull time printed on them. The full Django admin is also at `/admin/`.

## Sharing timings between computers

The product list and timings live in each computer's own database (`db.sqlite3`, which is not in git). To share them through the repo:

```bash
# On the computer whose timings you want to share:
.venv/bin/python manage.py export_products     # writes product_timings.json
git add product_timings.json && git commit -m "Update product timings" && git push

# On the other computer, once after cloning (or to reset to the shared list):
git pull
.venv/bin/python manage.py load_products
```

`load_products` makes the product list match the file. It adds and updates products, hides any that aren't in the file (they're never deleted), and never touches slips. After that, the admin on that computer can change anything in the Products screen.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `STORE_TIME_ZONE` | `America/Toronto` | Store's time zone, used for all pull times |
| `DJANGO_SECRET_KEY` | dev key | **Set this in production** |
| `DJANGO_DEBUG` | `1` | Set to `0` in production |
| `DJANGO_ALLOWED_HOSTS` | `*` | Comma-separated host names |
| `SQLITE_PATH` | `db.sqlite3` | Database file location |

## Tests

```bash
.venv/bin/python manage.py test slips
```
