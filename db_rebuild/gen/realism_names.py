"""
AskERP — D-038 realism pass: deterministic entity name banks.

Pure, side-effect-free functions — no DB connection, no I/O. Shared by:
  - db_rebuild/gen/generate_mro_v2.py   (future full regenerations)
  - db_rebuild/patch_realism_names.py   (patches the currently-loaded live
    data in place, without regenerating 18 months of transactional history —
    same additive-patch pattern as db_rebuild/patch_otif.py / D-034)

Callers must pass a dedicated `rng` (e.g. np.random.default_rng(42)) seeded
SEPARATELY from the generator's main stream, so name assignment never shifts
the main stream's draw sequence — every other generated column stays
byte-identical to pre-D-038 generations.

Region/segment grouping is processed in sorted-key order (not row order) —
still a pure, deterministic function of (input array, seed), just not tied
to iteration order of the input.
"""
import itertools

# ---------- shared uniqueness helpers ----------

def _unique_from_flat(rng, candidates, n, used):
    """Deterministically shuffle `candidates`, return first n not already in
    `used` (added to `used` as picked). Raises if the bank is too small —
    fail loud rather than silently reuse a name."""
    order = rng.permutation(len(candidates))
    out = []
    for i in order:
        name = candidates[i]
        if name not in used:
            used.add(name)
            out.append(name)
            if len(out) == n:
                return out
    raise ValueError(f"name bank exhausted: need {n}, bank size {len(candidates)}, {len(used)} already used")


def _unique_from_bank(rng, parts, n, used, sep=" "):
    """Cartesian product of word-list `parts`, then _unique_from_flat."""
    candidates = [sep.join(p) for p in itertools.product(*parts)]
    return _unique_from_flat(rng, candidates, n, used)


# ---------- suppliers: region-flavored ----------

DOMESTIC_GEO = {
    "Midwest":   ["Great Lakes", "Heartland", "Prairie", "Badger", "Buckeye", "Midland", "Cornbelt", "Lakeshore"],
    "South":     ["Lonestar", "Bayou", "Delta", "Magnolia", "Piney Woods", "Gulf Plains", "Ozark", "Red River"],
    "Southeast": ["Gulf Coast", "Peachtree", "Palmetto", "Carolina", "Tidewater", "Lowcountry", "Sunbelt", "Piedmont"],
    "West":      ["Sierra", "Pacific Rim", "Cascade", "Mojave", "Summit Ridge", "Redwood", "Rockies", "Highdesert"],
    "Northeast": ["Keystone", "Empire State", "Bay State", "Granite State", "Yankee", "Hudson Valley", "Berkshire", "Allegheny"],
}
SUPPLIER_BUSINESS_WORDS = [
    "Fastener", "Industrial", "Abrasives", "Safety Products", "Electrical",
    "Hardware", "Tool", "Equipment", "Machine Works", "Bearing & Belt",
    "Welding", "Cutting Tools",
]
SUPPLIER_SUFFIXES = ["Co.", "Inc.", "Supply", "Corp.", "Group", "Ltd."]

APAC_CITIES = ["Shenzhen", "Taichung", "Osaka", "Busan", "Yokohama", "Guangzhou", "Kaohsiung", "Nagoya", "Ningbo", "Hsinchu"]
APAC_WORDS = ["Precision Hardware", "Tool Works", "Industrial Trading", "Metal Works",
              "Precision Components", "Fastener Manufacturing", "Industrial Supply Co."]

EU_DE_PREFIX = ["Rheinland", "Bayern", "Schwarzwald", "Ruhrtal", "Nordsee", "Sachsen"]
EU_DE_WORDS = ["Werkzeuge GmbH", "Industriebedarf GmbH", "Praezisionstechnik GmbH", "Maschinenbau GmbH"]
EU_IT_PREFIX = ["Brescia", "Torino", "Bergamo", "Vicenza", "Modena", "Padova"]
EU_IT_WORDS = ["Utensili S.r.l.", "Meccanica S.r.l.", "Ferramenta S.r.l.", "Componenti S.r.l."]
EU_NORD_PREFIX = ["Nordfast", "Baltic", "Vasteras", "Jyvaskyla", "Trondheim", "Aarhus"]
EU_NORD_WORDS = ["AB", "Industri AB", "Verktyg AB", "Components AB"]


def build_supplier_names(regions, rng, used=None):
    """regions: array-like of region strings, one per supplier (any order).
    Returns a list of unique names, same length/order as `regions`."""
    used = used if used is not None else set()
    out = [None] * len(regions)
    for region in sorted(set(regions)):
        idxs = [i for i, r in enumerate(regions) if r == region]
        n = len(idxs)
        if region == "Import-APAC":
            names = _unique_from_bank(rng, [APAC_CITIES, APAC_WORDS], n, used)
        elif region == "Import-EU":
            candidates = (
                [f"{p} {w}" for p, w in itertools.product(EU_DE_PREFIX, EU_DE_WORDS)] +
                [f"{p} {w}" for p, w in itertools.product(EU_IT_PREFIX, EU_IT_WORDS)] +
                [f"{p} {w}" for p, w in itertools.product(EU_NORD_PREFIX, EU_NORD_WORDS)]
            )
            names = _unique_from_flat(rng, candidates, n, used)
        else:
            geo = DOMESTIC_GEO[region]
            names = _unique_from_bank(rng, [geo, SUPPLIER_BUSINESS_WORDS, SUPPLIER_SUFFIXES], n, used)
        for idx, name in zip(idxs, names):
            out[idx] = name
    return out


# ---------- customers: segment-flavored ----------

CUSTOMER_BANKS = {
    "Manufacturing": {
        "prefix": ["Meridian", "Vulcan", "Titan", "Ironclad", "Summit", "Apex", "Cornerstone",
                   "Sterling", "Anchor", "Forge", "Keystone", "Atlas"],
        "noun": ["Assembly Works", "Metal Fabrication", "Manufacturing", "Machine Works",
                 "Industrial Products", "Precision Components"],
        "suffix": ["Inc.", "Corp.", "LLC", "Group"],
    },
    "Construction": {
        "prefix": ["TriState", "Summit", "Cornerstone", "Bedrock", "Granite", "Crossroad",
                   "Highline", "Ironstone", "Northbridge", "Redstone", "Bluestone", "Anchorpoint",
                   "Crestline", "Foxhollow", "Riverbend", "Sawtooth"],
        "noun": ["Mechanical Contractors", "Builders Group", "Construction Co.",
                 "General Contractors", "Site Services", "Structural Contractors", "Civil Works"],
        "suffix": None,
    },
    "Facilities": {
        "prefix": ["Northgate", "Cascade", "Crestview", "Parkside", "Harborview", "Fairview",
                   "Westbrook", "Brightwater", "Millbrook", "Oakhurst", "Southridge", "Lakeview",
                   "Elmwood", "Silverleaf", "Broadmoor", "Windmere"],
        "noun": ["Property Services", "Facilities Management", "Building Services", "Maintenance Group",
                 "Facility Solutions", "Site Operations", "Property Group"],
        "suffix": None,
    },
    "Government": {
        "prefix": ["Harris County", "Lakewood", "Fairview", "Riverside", "Cedar Falls",
                   "Union County", "Franklin County", "Westbrook", "Eastgate", "Meadowbrook",
                   "Clearwater County", "Oakridge", "Pinecrest", "Millbrook County"],
        "noun": ["Public Works", "Municipal Utilities", "Department of Transportation",
                 "Water Authority", "School District Facilities",
                 "Parks & Recreation", "Sanitation Department"],
        "suffix": None,
    },
}


def build_customer_names(segments, rng, used=None):
    """segments: array-like of segment strings, one per customer (any order).
    Returns a list of unique names, same length/order as `segments`."""
    used = used if used is not None else set()
    out = [None] * len(segments)
    for seg in sorted(set(segments)):
        idxs = [i for i, s in enumerate(segments) if s == seg]
        n = len(idxs)
        bank = CUSTOMER_BANKS[seg]
        parts = [bank["prefix"], bank["noun"]]
        if bank["suffix"]:
            parts.append(bank["suffix"])
        names = _unique_from_bank(rng, parts, n, used)
        for idx, name in zip(idxs, names):
            out[idx] = name
    return out


# ---------- employees: ordinary, diverse, no celebrities ----------

FIRST_NAMES = [
    "James", "Maria", "Wei", "Fatima", "David", "Aisha", "Robert", "Yuki", "Carlos", "Priya",
    "Michael", "Elena", "Ahmed", "Sarah", "Daniel", "Grace", "Marcus", "Linda", "Jose", "Ingrid",
    "Kevin", "Chen", "Omar", "Rachel", "Anthony", "Nadia", "Brian", "Sofia", "Tyrone", "Hana",
]
LAST_NAMES = [
    "Nguyen", "Garcia", "Patel", "Johnson", "Kowalski", "Okafor", "Martinez", "Larsen", "Kim", "Torres",
    "Williams", "Chen", "Rossi", "Ibrahim", "Novak", "Anderson", "Reyes", "Schmidt", "Osei", "Park",
    "Thompson", "Silva", "Hassan", "Murphy", "Diaz", "Petrov", "Nakamura", "Brown", "Alvarez", "Singh",
]


def build_employee_names(n, rng, used=None):
    used = used if used is not None else set()
    candidates = [f"{f} {l}" for f, l in itertools.product(FIRST_NAMES, LAST_NAMES)]
    return _unique_from_flat(rng, candidates, n, used)
