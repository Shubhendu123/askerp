"""
AskERP — Dimension table generator
Generates synthetic CSVs for all 5 dimension tables to data/raw/
"""

import csv
import os
import random
from datetime import date, timedelta

from faker import Faker

# ── Setup ──────────────────────────────────────────────────────────────────────
fake = Faker()
Faker.seed(42)
random.seed(42)

RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
os.makedirs(RAW_DIR, exist_ok=True)


def write_csv(filename, fieldnames, rows):
    path = os.path.join(RAW_DIR, filename)
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return path


def random_date(start: date, end: date) -> date:
    delta = (end - start).days
    return start + timedelta(days=random.randint(0, delta))


def weighted_date(start: date, end: date, weights: list[tuple[date, date, float]]) -> date:
    """Pick a random date biased toward date ranges specified in weights list."""
    r = random.random()
    cumulative = 0.0
    for (s, e, w) in weights:
        cumulative += w
        if r <= cumulative:
            return random_date(s, e)
    return random_date(start, end)


# ── 1. dim_employee ────────────────────────────────────────────────────────────
print("Generating dim_employee...")

REGIONS = ["West", "East", "Central", "South"]
hire_start = date(2018, 1, 1)
hire_end = date(2024, 6, 1)

employees = []

# VP Sales
employees.append({
    "employee_id": 1,
    "employee_name": fake.name(),
    "role": "VP Sales",
    "region": "National",
    "manager_id": "",
    "hire_date": random_date(hire_start, hire_end),
    "status": "Active",
})

# 4 Sales Managers (one per region), manager_id = 1
manager_ids = {}
for i, region in enumerate(REGIONS, start=2):
    employees.append({
        "employee_id": i,
        "employee_name": fake.name(),
        "role": "Sales Manager",
        "region": region,
        "manager_id": 1,
        "hire_date": random_date(hire_start, hire_end),
        "status": "Active",
    })
    manager_ids[region] = i

# 25 Sales Reps spread across regions (6–7 per region)
rep_counts = {"West": 7, "East": 6, "Central": 6, "South": 6}
rep_id = 6
inactive_assigned = 0
for region, count in rep_counts.items():
    for _ in range(count):
        status = "Inactive" if inactive_assigned < 2 and rep_id > 20 else "Active"
        if status == "Inactive":
            inactive_assigned += 1
        employees.append({
            "employee_id": rep_id,
            "employee_name": fake.name(),
            "role": "Sales Rep",
            "region": region,
            "manager_id": manager_ids[region],
            "hire_date": random_date(hire_start, hire_end),
            "status": status,
        })
        rep_id += 1

# Build lookup: region → list of active rep employee_ids
REGION_REPS = {r: [] for r in REGIONS}
for e in employees:
    if e["role"] == "Sales Rep" and e["status"] == "Active":
        REGION_REPS[e["region"]].append(e["employee_id"])

emp_path = write_csv("dim_employee.csv", [
    "employee_id", "employee_name", "role", "region", "manager_id", "hire_date", "status"
], employees)
print(f"  ✓ {len(employees)} rows → {emp_path}")


# ── 2. dim_location ────────────────────────────────────────────────────────────
print("Generating dim_location...")

locations = [
    {"location_id": 1, "location_name": "Northwind HQ",                    "location_type": "HQ",        "region": "Central", "state": "IL", "city": "Chicago",     "capacity_units": 10000},
    {"location_id": 2, "location_name": "West Distribution Center",        "location_type": "Warehouse", "region": "West",    "state": "CA", "city": "Los Angeles",  "capacity_units": 50000},
    {"location_id": 3, "location_name": "East Distribution Center",        "location_type": "Warehouse", "region": "East",    "state": "NJ", "city": "Newark",       "capacity_units": 45000},
    {"location_id": 4, "location_name": "Central Distribution Center",     "location_type": "Warehouse", "region": "Central", "state": "TX", "city": "Dallas",       "capacity_units": 60000},
    {"location_id": 5, "location_name": "Atlanta Showroom",                "location_type": "Showroom",  "region": "South",   "state": "GA", "city": "Atlanta",      "capacity_units": 5000},
]

loc_path = write_csv("dim_location.csv", [
    "location_id", "location_name", "location_type", "region", "state", "city", "capacity_units"
], locations)
print(f"  ✓ {len(locations)} rows → {loc_path}")


# ── 3. dim_customer ────────────────────────────────────────────────────────────
print("Generating dim_customer...")

INDUSTRIES = ["Hospitality", "Corporate", "Healthcare", "Education", "Government", "Retail"]
INDUSTRY_WEIGHTS = [0.25, 0.25, 0.15, 0.15, 0.10, 0.10]

REGION_POOL = ["West"] * 53 + ["East"] * 37 + ["Central"] * 30 + ["South"] * 30
random.shuffle(REGION_POOL)

STATE_BY_REGION = {
    "West":    ["CA", "WA", "OR", "NV", "AZ", "CO", "UT"],
    "East":    ["NY", "MA", "PA", "CT", "NJ", "VA", "MD"],
    "Central": ["IL", "TX", "MN", "MO", "OH", "MI", "WI"],
    "South":   ["GA", "FL", "NC", "TN", "AL", "SC", "LA"],
}

CITY_BY_STATE = {
    "CA": "Los Angeles", "WA": "Seattle", "OR": "Portland", "NV": "Las Vegas",
    "AZ": "Phoenix", "CO": "Denver", "UT": "Salt Lake City",
    "NY": "New York", "MA": "Boston", "PA": "Philadelphia", "CT": "Hartford",
    "NJ": "Newark", "VA": "Richmond", "MD": "Baltimore",
    "IL": "Chicago", "TX": "Dallas", "MN": "Minneapolis", "MO": "St. Louis",
    "OH": "Columbus", "MI": "Detroit", "WI": "Milwaukee",
    "GA": "Atlanta", "FL": "Miami", "NC": "Charlotte", "TN": "Nashville",
    "AL": "Birmingham", "SC": "Columbia", "LA": "New Orleans",
}

ENTERPRISE_PREFIXES = [
    "Hilton", "Marriott", "Mayo Clinic", "Kaiser", "Stanford University",
    "University of Texas", "Hyatt", "Sheraton", "Johns Hopkins", "Geisinger",
    "Intermountain", "CommonSpirit", "Advocate Health", "HCA Healthcare",
    "Four Seasons", "Omni Hotels", "Loews Hotels", "Kimpton", "IHG",
    "Deloitte", "PwC", "McKinsey", "KPMG", "Accenture",
    "Wells Fargo", "JPMorgan Chase", "Bank of America", "Citigroup",
    "Target Corporation", "Walmart", "Costco", "Home Depot", "Lowe's",
]

ENTERPRISE_SUFFIXES = [
    "Procurement", "Facilities Division", "Corporate Services",
    "Global Operations", "Real Estate Group", "Workspace Solutions",
    "Campus Operations", "National Accounts",
]

def enterprise_name(i):
    prefix = ENTERPRISE_PREFIXES[i % len(ENTERPRISE_PREFIXES)]
    suffix = ENTERPRISE_SUFFIXES[i % len(ENTERPRISE_SUFFIXES)]
    return f"{prefix} {suffix}"

MIDMARKET_ADJECTIVES = [
    "Pacific", "Atlantic", "Lakeside", "Summit", "Riverside", "Coastal",
    "Midwest", "Prairie", "Skyline", "Harbor", "Pinnacle", "Highline",
]

MIDMARKET_NOUNS = [
    "Properties", "Hospitality Group", "Health System", "Education Partners",
    "Medical Group", "Clinic Network", "Hotel Group", "Campus Services",
    "Corporate Interiors", "Workspace Group", "Realty Partners", "Facilities Co",
]

def midmarket_name(i):
    adj = MIDMARKET_ADJECTIVES[i % len(MIDMARKET_ADJECTIVES)]
    noun = MIDMARKET_NOUNS[i % len(MIDMARKET_NOUNS)]
    return f"{adj} {noun}"

SMB_TYPES = [
    "Dental Associates", "Law Offices", "Medical Practice", "Consulting Group",
    "Accounting Firm", "Veterinary Clinic", "Chiropractic Center", "Eye Care",
    "Financial Advisors", "Insurance Agency", "Real Estate Office", "CPA Group",
]

def smb_name():
    last = fake.last_name()
    typ = random.choice(SMB_TYPES)
    return f"{last} {typ}"

# Date weighting: 60% 2022–2023, 40% rest
cust_start = date(2020, 1, 1)
cust_end = date(2024, 12, 31)
date_weights = [
    (date(2022, 1, 1), date(2023, 12, 31), 0.60),
    (date(2020, 1, 1), date(2021, 12, 31), 0.20),
    (date(2024, 1, 1), date(2024, 12, 31), 0.20),
]

customers = []
cust_id = 1
west_enterprise_ids = []

segments = (
    [("Enterprise", 30)] +
    [("Mid-Market", 60)] +
    [("SMB", 60)]
)

ent_i = 0
mm_i = 0
region_pool_idx = 0

for segment, count in segments:
    for j in range(count):
        region = REGION_POOL[region_pool_idx]
        region_pool_idx += 1
        state = random.choice(STATE_BY_REGION[region])
        city = CITY_BY_STATE[state]
        industry = random.choices(INDUSTRIES, weights=INDUSTRY_WEIGHTS)[0]

        if segment == "Enterprise":
            name = enterprise_name(ent_i); ent_i += 1
            credit_limit = round(random.uniform(250_000, 1_000_000), 2)
            payment_terms = random.choice(["Net 45", "Net 60"])
        elif segment == "Mid-Market":
            name = midmarket_name(mm_i); mm_i += 1
            credit_limit = round(random.uniform(50_000, 250_000), 2)
            payment_terms = "Net 30"
        else:
            name = smb_name()
            credit_limit = round(random.uniform(10_000, 50_000), 2)
            payment_terms = random.choice(["Net 15", "Net 30"])

        reps = REGION_REPS.get(region, [])
        acct_mgr = random.choice(reps) if reps else 5

        created = weighted_date(cust_start, cust_end, date_weights)

        # Status — assign churned later to West Enterprise
        status = "Active"

        customers.append({
            "customer_id": cust_id,
            "customer_name": name,
            "customer_segment": segment,
            "industry": industry,
            "region": region,
            "state": state,
            "city": city,
            "credit_limit": credit_limit,
            "payment_terms": payment_terms,
            "account_manager_id": acct_mgr,
            "created_date": created,
            "status": status,
        })

        if segment == "Enterprise" and region == "West":
            west_enterprise_ids.append(cust_id)

        cust_id += 1

# Assign 2 churned (West Enterprise), 3 Inactive (any)
churned = west_enterprise_ids[:2]
inactive_cands = [c["customer_id"] for c in customers if c["customer_id"] not in churned]
inactive = random.sample(inactive_cands, 3)

for c in customers:
    if c["customer_id"] in churned:
        c["status"] = "Churned"
    elif c["customer_id"] in inactive:
        c["status"] = "Inactive"

cust_path = write_csv("dim_customer.csv", [
    "customer_id", "customer_name", "customer_segment", "industry",
    "region", "state", "city", "credit_limit", "payment_terms",
    "account_manager_id", "created_date", "status"
], customers)
print(f"  ✓ {len(customers)} rows → {cust_path}")


# ── 4. dim_item ────────────────────────────────────────────────────────────────
print("Generating dim_item...")

SUPPLIERS = [
    "Patagonia Furniture Works", "Northwoods Manufacturing", "Stellar Industries",
    "Cascade Contract Furnishings", "Ironwood Collective", "BluePeak Furniture Co",
    "Meridian Supply Group", "Summit Commercial Interiors",
]

CATEGORY_CONFIG = {
    "Office Seating":    {"prefix": "SEA", "count": 20, "cost_range": (150, 900),  "margin_range": (2.2, 3.0)},
    "Office Desks":      {"prefix": "DSK", "count": 15, "cost_range": (200, 1200), "margin_range": (2.0, 2.8)},
    "Conference Tables": {"prefix": "CNF", "count": 10, "cost_range": (600, 2000), "margin_range": (2.5, 3.5)},
    "Outdoor Furniture": {"prefix": "OUT", "count": 15, "cost_range": (100, 800),  "margin_range": (2.2, 3.2)},
    "Storage":           {"prefix": "STR", "count": 12, "cost_range": (80, 600),   "margin_range": (2.0, 2.8)},
    "Lighting":          {"prefix": "LGT", "count": 8,  "cost_range": (50, 400),   "margin_range": (2.5, 3.5)},
}

SUBCATEGORY = {
    "Office Seating":    ["Executive Chairs", "Task Chairs", "Guest Chairs", "Lounge Seating", "Stools"],
    "Office Desks":      ["Standing Desks", "L-Shape Desks", "Writing Desks", "Benching Systems", "Corner Desks"],
    "Conference Tables": ["Boardroom Tables", "Training Tables", "Collaborative Tables", "Modular Tables"],
    "Outdoor Furniture": ["Lounge Sets", "Dining Sets", "Benches", "Adirondack Sets", "Shade Structures"],
    "Storage":           ["Filing Cabinets", "Bookcases", "Credenzas", "Mobile Pedestals", "Wall Units"],
    "Lighting":          ["Desk Lamps", "Floor Lamps", "Pendant Lights", "Task Lighting", "Accent Lighting"],
}

MATERIALS = {
    "Office Seating":    ["Upholstered", "Upholstered", "Upholstered", "Metal", "Mixed"],
    "Office Desks":      ["Wood", "Metal", "Mixed", "Wood", "Metal"],
    "Conference Tables": ["Wood", "Mixed", "Metal", "Wood"],
    "Outdoor Furniture": ["Metal", "Plastic", "Mixed", "Wood", "Metal"],
    "Storage":           ["Metal", "Wood", "Metal", "Mixed"],
    "Lighting":          ["Metal", "Mixed", "Plastic", "Metal"],
}

NAME_PARTS = {
    "Office Seating": {
        "nouns": ["Aspen", "Summit", "Meridian", "Atlas", "Crest", "Zenith", "Apex", "Vantage", "Pinnacle", "Cascade"],
        "styles": ["Executive", "Task", "Guest", "Lounge", "Ergonomic", "Pro", "Elite", "Flex", "Comfort", "Active"],
        "suffixes": ["Chair", "Seat", "Stool", "Rocker", "Recliner"],
    },
    "Office Desks": {
        "nouns": ["Horizon", "Harbor", "Skyline", "Vega", "Nova", "Ridge", "Plateau", "Cove", "Mesa", "Alto"],
        "styles": ["Standing", "L-Shape", "Corner", "Executive", "Compact", "Modular", "Flex", "Pro", "Bench", "Studio"],
        "suffixes": ["Desk", "Workstation", "Station", "Surface"],
    },
    "Conference Tables": {
        "nouns": ["Cascade", "Grandeur", "Summit", "Boardroom", "Forum", "Council", "Apex", "Titan", "Prestige", "Legacy"],
        "styles": ["Executive", "Oval", "Rectangular", "Boat-Shape", "Round", "Modular"],
        "suffixes": ["Table", "Conference Table", "Boardroom Table"],
    },
    "Outdoor Furniture": {
        "nouns": ["Terrace", "Arbor", "Patio", "Garden", "Canopy", "Soleil", "Veranda", "Courtyard", "Breeze", "Oasis"],
        "styles": ["Lounge", "Dining", "Conversation", "Relaxed", "Classic", "Modern", "Coastal"],
        "suffixes": ["Set", "Chair", "Table", "Bench", "Sofa"],
    },
    "Storage": {
        "nouns": ["Vault", "Archive", "Order", "Haven", "Depot", "Stockton", "Reserve", "Module", "Keeper", "Cache"],
        "styles": ["Mobile", "Wall-Mount", "Lateral", "Vertical", "Modular", "Open", "Closed", "Compact"],
        "suffixes": ["Cabinet", "Bookcase", "Credenza", "Pedestal", "Unit", "Shelf"],
    },
    "Lighting": {
        "nouns": ["Lumen", "Aura", "Solaris", "Lumis", "Glint", "Beacon", "Prism", "Halo", "Arc", "Glow"],
        "styles": ["Task", "Ambient", "Accent", "Directional", "Adjustable", "Dimmable"],
        "suffixes": ["Lamp", "Light", "Pendant", "Fixture", "Sconce"],
    },
}

SIZE_HINTS = {
    "Office Seating":    ["", "- Standard", "- XL", "- Petite", "- Wide"],
    "Office Desks":      ["48in", "60in", "72in", "30x60", "24x48", "66in"],
    "Conference Tables": ["6-Person", "8-Person", "10-Person", "12-Person", "14-Person", "16-Person"],
    "Outdoor Furniture": ["2-Piece", "3-Piece", "4-Piece", "5-Piece", ""],
    "Storage":           ["2-Drawer", "3-Drawer", "4-Drawer", "5-Shelf", "6-Shelf", ""],
    "Lighting":          ["", "- 18in", "- 24in", "- Adjustable", "- LED"],
}

items = []
item_id = 1
sku_counters = {cat: 100 for cat in CATEGORY_CONFIG}
used_names = set()

for category, cfg in CATEGORY_CONFIG.items():
    parts = NAME_PARTS[category]
    sizes = SIZE_HINTS[category]
    subcats = SUBCATEGORY[category]
    mats = MATERIALS[category]

    for i in range(cfg["count"]):
        # Build a unique name
        attempts = 0
        while True:
            noun = parts["nouns"][i % len(parts["nouns"])]
            style = parts["styles"][(i + attempts) % len(parts["styles"])]
            suffix = parts["suffixes"][i % len(parts["suffixes"])]
            size = sizes[(i + attempts) % len(sizes)]
            name = f"{noun} {style} {suffix}"
            if size:
                name += f" - {size.lstrip('- ').strip()}"
            if name not in used_names:
                used_names.add(name)
                break
            attempts += 1

        prefix = cfg["prefix"]
        sku_num = sku_counters[category]
        sku = f"{prefix}-{sku_num:05d}"
        sku_counters[category] += random.randint(1, 50)

        cost = round(random.uniform(*cfg["cost_range"]), 2)
        margin = random.uniform(*cfg["margin_range"])
        price = round(cost * margin, 2)

        material = mats[i % len(mats)]
        subcat = subcats[i % len(subcats)]
        supplier = SUPPLIERS[i % len(SUPPLIERS)]
        lead_time = random.randint(7, 45)
        status = "Discontinued" if item_id in [8, 23, 41, 57, 72] else "Active"

        items.append({
            "item_id": item_id,
            "sku": sku,
            "item_name": name,
            "category": category,
            "subcategory": subcat,
            "material": material,
            "unit_cost": cost,
            "unit_price": price,
            "supplier": supplier,
            "lead_time_days": lead_time,
            "status": status,
        })
        item_id += 1

item_path = write_csv("dim_item.csv", [
    "item_id", "sku", "item_name", "category", "subcategory", "material",
    "unit_cost", "unit_price", "supplier", "lead_time_days", "status"
], items)
print(f"  ✓ {len(items)} rows → {item_path}")


# ── 5. dim_date ────────────────────────────────────────────────────────────────
print("Generating dim_date...")

US_HOLIDAYS_2023 = {
    date(2023, 1, 1), date(2023, 1, 16), date(2023, 2, 20), date(2023, 5, 29),
    date(2023, 7, 4), date(2023, 9, 4), date(2023, 11, 23), date(2023, 12, 25),
}
US_HOLIDAYS_2024 = {
    date(2024, 1, 1), date(2024, 1, 15), date(2024, 2, 19), date(2024, 5, 27),
    date(2024, 7, 4), date(2024, 9, 2), date(2024, 11, 28), date(2024, 12, 25),
}
US_HOLIDAYS_2025 = {
    date(2025, 1, 1), date(2025, 1, 20), date(2025, 2, 17), date(2025, 5, 26),
    date(2025, 7, 4), date(2025, 9, 1), date(2025, 11, 27), date(2025, 12, 25),
}
ALL_HOLIDAYS = US_HOLIDAYS_2023 | US_HOLIDAYS_2024 | US_HOLIDAYS_2025

MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

dates = []
current = date(2023, 1, 1)
end = date(2025, 12, 31)
while current <= end:
    dates.append({
        "date_id": int(current.strftime("%Y%m%d")),
        "date": current,
        "day_of_week": current.strftime("%A"),
        "day_of_month": current.day,
        "month": current.month,
        "month_name": MONTH_NAMES[current.month],
        "quarter": (current.month - 1) // 3 + 1,
        "year": current.year,
        "is_weekend": current.weekday() >= 5,
        "is_holiday": current in ALL_HOLIDAYS,
    })
    current += timedelta(days=1)

date_path = write_csv("dim_date.csv", [
    "date_id", "date", "day_of_week", "day_of_month", "month", "month_name",
    "quarter", "year", "is_weekend", "is_holiday"
], dates)
print(f"  ✓ {len(dates)} rows → {date_path}")


# ── Summary ────────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("GENERATION COMPLETE")
print("=" * 60)

files = {
    "dim_employee.csv": employees,
    "dim_location.csv": locations,
    "dim_customer.csv": customers,
    "dim_item.csv": items,
    "dim_date.csv": dates,
}

print(f"\n{'File':<25} {'Rows':>6}  {'Size':>10}")
print("-" * 45)
total_rows = 0
for fname, rows in files.items():
    fpath = os.path.join(RAW_DIR, fname)
    size = os.path.getsize(fpath)
    print(f"{fname:<25} {len(rows):>6}  {size/1024:>8.1f} KB")
    total_rows += len(rows)
print("-" * 45)
print(f"{'TOTAL':<25} {total_rows:>6}")

print("\n── Sample rows ──────────────────────────────────────────")
import csv as _csv

for fname in files:
    fpath = os.path.join(RAW_DIR, fname)
    print(f"\n{fname}:")
    with open(fpath) as f:
        reader = _csv.DictReader(f)
        for i, row in enumerate(reader):
            if i >= 3:
                break
            print(f"  {dict(row)}")
