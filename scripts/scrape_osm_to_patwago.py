"""Scrape OSM Jamaica businesses -> PatWaGo PostgreSQL.

Reads /tmp/ja_osm.json (Overpass API dump), maps to PatWaGo vendor schema,
dedupes against existing vendors by slug, inserts via psql inside the
patwago-db container using parameterized INSERTs through a temp SQL file
with escaped values.
"""
import json
import re
import subprocess
import unicodedata
from collections import Counter

OSM_FILE = "/tmp/ja_osm.json"
INSERT_CHUNK = 250  # rows per INSERT batch


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:80] or "vendor"


# OSM tag -> PatWaGo vendor_category mapping
# PatWaGo categories: water_sports, adventure, food, tours, transport, events, wellness, crafts
def map_category(tags: dict) -> str | None:
    t = tags
    am = t.get("amenity", "")
    tour = t.get("tourism", "")
    shop = t.get("shop", "")
    # Food
    if am in ("restaurant", "cafe", "fast_food", "pub", "bar", "ice_cream", "food_court"):
        return "food"
    # Lodging -> tours (closest fit; we have no lodging cat) ... actually put hotels under tours
    if tour in ("hotel", "guest_house", "hostel", "apartment", "chalet", "motel"):
        return "tours"
    # Attractions -> tours
    if tour in ("attraction", "viewpoint", "artwork", "museum", "gallery", "theme_park", "zoo", "aquarium"):
        return "tours"
    if tour in ("information", "picnic_site", "camp_site", "caravan_site"):
        return "tours"
    # Shops -> crafts (souvenirs/clothes/jewelry/art) or food (food shops)
    food_shops = {"bakery", "butcher", "beverages", "alcohol", "greengrocer", "confectionery", "seafood", "deli"}
    craft_shops = {"jewelry", "souvenir", "art", "crafts", "gift", "clothes", "fashion", "shoes", "leather", "hunting?no"}
    if shop in food_shops:
        return "food"
    if shop in craft_shops:
        return "crafts"
    if shop == "supermarket" or shop == "convenience" or shop == "variety_store" or shop == "wholesale" or shop == "mall":
        return "crafts"  # general retail -> crafts bucket
    if shop in ("mobile_phone", "electronics", "computer", "hardware", "car", "car_repair", "car_parts", "tyres", "optician", "photo", "books", "beauty", "hairdresser", "furniture", "sports", "toys", "florist", "pet", "stationery", "laundry", "newsagent", "tobacco", "travel_agency"):
        # service/retail -> transport (travel) or crafts (general). Use crafts as catch-all retail.
        if shop == "travel_agency":
            return "transport"
        return "crafts"
    # wellness: spa, gym
    if am in ("spa", "gym", "fitness_centre", "massage", "alternative_medicine", "hospital", "clinic", "pharmacy", "dentist", "doctors"):
        return "wellness"
    if tour in ("spa",):
        return "wellness"
    # transport
    if am in ("fuel", "car_rental", "car_wash", "parking", "bus_station", "taxi", "ferry_terminal", "bicycle_rental"):
        return "transport"
    # events
    if am in ("events_venue", "nightclub", "casino", "cinema", "theatre", "arts_centre", "community_centre"):
        return "events"
    # adventure: dive_centre, surf school, etc.
    if am in ("dive_centre", "boat_rental", "boat_sharing", "marina", "slipway"):
        return "water_sports"
    if shop == "sports" and any(k in str(t.get("name", "")).lower() for k in ("dive", "surf", "kayak", "raft")):
        return "water_sports"
    return None


def build_description(tags: dict, category: str) -> str:
    name = tags.get("name", "")
    parts = [f"{name}"]
    am = tags.get("amenity", "")
    tour = tags.get("tourism", "")
    shop = tags.get("shop", "")
    kind = am or tour or shop
    if kind:
        parts.append(f"a {kind.replace('_', ' ')}")
    cuisine = tags.get("cuisine")
    if cuisine:
        parts.append(f"serving {cuisine}")
    desc = tags.get("description")
    if desc:
        parts.append(desc)
    city = tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village")
    street = tags.get("addr:street")
    if city:
        loc = city
        if street:
            loc = f"{street}, {city}"
        parts.append(f"located in {loc}")
    text = " ".join(parts[:3])
    if len(text) > 280:
        text = text[:277] + "..."
    return text


def phone_norm(tags: dict) -> str:
    p = tags.get("phone") or tags.get("contact:phone") or tags.get("phone:mobile")
    if not p:
        return ""
    return p.split(";")[0].strip()


def main():
    with open(OSM_FILE) as f:
        data = json.load(f)
    elements = data["elements"]
    print(f"Loaded {len(elements)} OSM elements")

    rows = []
    seen_slugs = set()
    seen_names = set()
    skipped_no_cat = 0
    skipped_dup = 0

    for e in elements:
        tags = e.get("tags", {})
        name = tags.get("name", "").strip()
        if not name:
            continue
        if name.lower() in seen_names:
            skipped_dup += 1
            continue
        cat = map_category(tags)
        if cat is None:
            skipped_no_cat += 1
            continue
        slug = slugify(name)
        # ensure unique slug within this batch
        base = slug
        i = 2
        while slug in seen_slugs:
            slug = f"{base}-{i}"
            i += 1
        seen_slugs.add(slug)
        seen_names.add(name.lower())
        desc = build_description(tags, cat)
        phone = phone_norm(tags)
        rows.append({
            "name": name,
            "slug": slug,
            "category": cat,
            "description": desc,
            "phone": phone,
            "lat": float(e["lat"]),
            "lng": float(e["lon"]),
        })

    print(f"Prepared {len(rows)} vendors")
    print(f"Skipped: no-category={skipped_no_cat}, duplicate-name={skipped_dup}")

    cat_counts = Counter(r["category"] for r in rows)
    for k, v in cat_counts.most_common():
        print(f"  {k}: {v}")

    # Fetch existing slugs from DB to avoid collisions
    res = subprocess.run(
        ["docker", "exec", "-e", "PGPASSWORD=patwago2026", "patwago-db",
         "psql", "-U", "patwago", "-d", "patwago", "-t", "-A", "-F", "|",
         "-c", "SELECT slug FROM vendors;"],
        capture_output=True, text=True, check=False,
    )
    existing = set(line.strip() for line in res.stdout.splitlines() if line.strip())
    print(f"Existing slugs in DB: {len(existing)}")

    fresh = []
    for r in rows:
        if r["slug"] in existing:
            continue
        existing.add(r["slug"])
        fresh.append(r)
    print(f"After dedup vs DB: {len(fresh)} new vendors to insert")

    # Build INSERT statements in batches. Escape single quotes.
    def esc(s: str) -> str:
        return s.replace("'", "''")

    batch_count = 0
    inserted = 0
    for start in range(0, len(fresh), INSERT_CHUNK):
        batch = fresh[start:start + INSERT_CHUNK]
        stmt_parts = [
            "BEGIN;",
            "INSERT INTO vendors "
            "(name, slug, category, description, phone, location_address, "
            " location_lat, location_lng, location, verified, tier) VALUES",
        ]
        values_parts = []
        for r in batch:
            # build point: ST_SetSRID(ST_MakePoint(lng, lat),4326)::geography
            v = (
                f"('{esc(r['name'])}','{esc(r['slug'])}','{r['category']}',"
                f"'{esc(r['description'])}','{esc(r['phone'])}',"
                f"'',{r['lat']},{r['lng']},"
                f"ST_SetSRID(ST_MakePoint({r['lng']},{r['lat']}),4326)::geography,"
                f"false,'free')"
            )
            values_parts.append(v)
        stmt_parts.append(",".join(values_parts) + ";")
        stmt_parts.append("COMMIT;")
        sql = "\n".join(stmt_parts)

        # write SQL to temp file, then pipe to psql via docker exec
        sqlfile = f"/tmp/insert_batch_{batch_count}.sql"
        with open(sqlfile, "w") as f:
            f.write(sql)

        # copy file into container, run it
        run = subprocess.run(
            ["docker", "exec", "-i", "-e", "PGPASSWORD=patwago2026", "patwago-db",
             "psql", "-U", "patwago", "-d", "patwago", "-v", "ON_ERROR_STOP=1", "-f", "/dev/stdin"],
            input=sql, capture_output=True, text=True, check=False,
        )
        if run.returncode != 0:
            print(f"Batch {batch_count} FAILED: {run.stderr[:500]}")
            # try row-by-row fallback for this batch
            for r in batch:
                v = (
                    f"('{esc(r['name'])}','{esc(r['slug'])}','{r['category']}',"
                    f"'{esc(r['description'])}','{esc(r['phone'])}',"
                    f"'',{r['lat']},{r['lng']},"
                    f"ST_SetSRID(ST_MakePoint({r['lng']},{r['lat']}),4326)::geography,"
                    f"false,'free')"
                )
                sql = (
                    "INSERT INTO vendors "
                    "(name, slug, category, description, phone, location_address, "
                    " location_lat, location_lng, location, verified, tier) VALUES "
                    + v + ";"
                )
                run2 = subprocess.run(
                    ["docker", "exec", "-i", "-e", "PGPASSWORD=patwago2026", "patwago-db",
                     "psql", "-U", "patwago", "-d", "patwago", "-v", "ON_ERROR_STOP=1", "-c", sql],
                    input=sql, capture_output=True, text=True, check=False,
                )
                if run2.returncode == 0:
                    inserted += 1
                else:
                    print(f"  row failed: {r['slug']} -> {run2.stderr[:200]}")
        else:
            inserted += len(batch)
        batch_count += 1
        if batch_count % 2 == 0:
            print(f"  ...inserted so far: {inserted}")

    print(f"\nDONE. Inserted {inserted} new vendors.")

    # Final verification
    res = subprocess.run(
        ["docker", "exec", "-e", "PGPASSWORD=patwago2026", "patwago-db",
         "psql", "-U", "patwago", "-d", "patwago", "-c",
         "SELECT count(*) AS total FROM vendors; SELECT category, count(*) FROM vendors GROUP BY category ORDER BY count(*) DESC;"],
        capture_output=True, text=True, check=False,
    )
    print(res.stdout)


if __name__ == "__main__":
    main()
