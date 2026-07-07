// Knockoff: common product-title words. If a title *starts* with one of
// these (or a number/measurement), the listing has no brand up front,
// itself a strong junk signal on Amazon.
//
// Grouped into sections only for readability; order does not affect matching
// (all entries are loaded into a single normalized set). Keep a word out of
// this list if it is also a standalone brand name, since a title starting
// with it would then be read as unbranded.
var KO_GENERIC_WORDS = [
  // ── Articles, qualifiers & marketing puffery ──────────────────
  "a", "an", "the", "new", "upgraded", "updated", "improved", "premium",
  "professional", "pro", "heavy", "duty", "heavy-duty", "high", "quality",
  "mini", "small", "large", "big", "extra", "long", "short", "wide",
  "portable", "compact", "foldable", "folding", "collapsible", "adjustable",
  "universal", "multi", "multifunction", "multifunctional", "multipurpose",
  "genuine", "original", "authentic", "official", "certified", "organic",
  "natural", "eco", "eco-friendly", "reusable", "disposable", "washable",
  "ultra", "super", "max", "plus", "deluxe", "luxury", "classic", "modern",
  "vintage", "retro", "cute", "funny", "novelty", "creative", "diy",
  "handmade", "handcrafted", "custom", "personalized", "perfect", "best",
  "top", "great", "durable", "sturdy", "strong", "soft", "comfortable",
  "ergonomic", "lightweight", "slim", "thin", "thick", "double", "single",
  "dual", "triple", "extendable", "retractable", "removable", "flexible",
  "tough", "grip", "quick", "easy", "instant", "assorted", "variety",
  "compatible", "aftermarket", "refurbished", "renewed", "insulated",
  "padded", "breathable", "antibacterial", "hypoallergenic",

  // ── Protection & resistance ───────────────────────────────────
  "waterproof", "water", "resistant", "windproof", "dustproof", "shockproof",
  "anti-slip", "non-slip", "nonslip", "anti", "non",

  // ── Size, quantity & measurement ──────────────────────────────
  "set", "pack", "pcs", "piece", "pieces", "pair", "bulk", "kit", "bundle",
  "inch", "inches", "ft", "feet", "foot", "cm", "mm", "meter", "gallon",
  "quart", "oz", "lb", "lbs", "count", "ct", "value", "family", "size",
  "xs", "medium", "xl", "xxl", "xxxl", "diameter", "width",
  "length", "height", "capacity", "liter", "ml", "yard", "dozen", "gram",
  "ounce", "pound", "watt", "volt", "gb", "tb", "mah",

  // ── Materials & finishes ──────────────────────────────────────
  "magnetic", "stainless", "steel", "metal", "aluminum", "plastic",
  "cobalt", "titanium", "tungsten", "carbide", "alloy", "brass", "copper",
  "silicone", "rubber", "wooden", "wood", "bamboo", "leather", "glass",
  "carbon", "ceramic", "cotton", "microfiber", "mesh", "canvas", "nylon",
  "acrylic", "vinyl", "polyester", "wool", "denim", "suede", "zinc",
  "iron", "marble", "granite", "linen", "velvet", "faux", "foam",
  "latex", "gel", "fleece",

  // ── Colors ────────────────────────────────────────────────────
  "black", "white", "red", "blue", "green", "yellow", "orange", "purple",
  "pink", "gray", "grey", "silver", "gold", "brown", "clear", "transparent",
  "beige", "tan", "navy", "teal", "maroon", "burgundy", "khaki", "olive",
  "turquoise", "camo", "camouflage", "multicolor", "neon",

  // ── Audience & recipient ──────────────────────────────────────
  "men", "mens", "men's", "women", "womens", "women's", "kids", "kids'",
  "children", "childrens", "baby", "toddler", "adult", "unisex", "boys",
  "girls", "pet", "dog", "cat", "infant", "newborn", "teen", "senior",
  "puppy", "kitten",

  // ── Rooms, spaces & settings ──────────────────────────────────
  "kitchen", "bathroom", "bedroom", "office", "home", "outdoor", "indoor",
  "garden", "garage", "car", "auto", "travel", "camping", "hiking",
  "fishing", "hunting", "sports", "gym", "yoga", "running", "cycling",
  "bike", "bicycle", "motorcycle", "boat", "rv", "truck", "patio",
  "balcony", "closet", "pantry", "laundry", "nursery", "dorm", "workshop",
  "shed", "basement", "beach", "picnic", "gaming", "gardening",

  // ── Power & connectivity ──────────────────────────────────────
  "wireless", "wired", "bluetooth", "usb", "type-c", "rechargeable",
  "electric", "electronic", "digital", "smart", "automatic", "manual",
  "led", "solar", "battery", "batteries", "power", "powered", "cordless",
  "gas", "propane", "diesel", "hydraulic", "pneumatic", "air", "wifi",
  "dimmable", "voltage", "output", "fast",

  // ── Tools & hardware ──────────────────────────────────────────
  "screwdriver", "wrench", "hammer", "drill", "saw", "pliers", "knife",
  "scissors", "tape", "glue", "screws", "nails", "bolts", "nuts", "bits",
  "bit", "driver", "socket", "ratchet", "clamp", "vise", "level", "ruler",
  "tool", "tools", "hardware", "replacement", "spare", "repair", "sander",
  "grinder", "chisel", "mallet", "caulk", "sealant", "adhesive", "fastener",
  "washers", "anchor", "hinge", "bracket", "spring", "gasket", "file",
  "punch",

  // ── Device model words (accessory targets) ────────────────────
  "iphone", "ipad", "ipod", "airpods", "macbook", "imac", "galaxy", "pixel",
  "android", "chromebook",

  // ── Electronics & accessories ─────────────────────────────────
  "phone", "tablet", "laptop", "computer", "desktop", "monitor", "keyboard",
  "mouse", "headphones", "earbuds", "speaker", "charger", "charging",
  "cable", "cord", "adapter", "converter", "hub", "stand", "holder",
  "mount", "case", "cover", "sleeve", "protector", "screen", "camera",
  "webcam", "microphone", "mic", "router", "modem", "extender", "dongle",
  "splitter", "dock", "gamepad", "controller", "stylus", "projector",
  "printer", "scanner", "tripod", "gimbal", "headset", "soundbar",
  "remote", "antenna", "powerbank",

  // ── Storage & furniture ───────────────────────────────────────
  "storage", "organizer", "container", "box", "boxes", "bag", "bags",
  "basket", "bin", "rack", "shelf", "shelves", "hook", "hooks", "hanger",
  "hangers", "drawer", "cabinet", "table", "desk", "chair", "sofa", "bed",
  "mattress", "jar", "jars", "canister", "dispenser", "bucket", "tote",
  "crate", "stool", "bench", "nightstand", "dresser", "wardrobe",
  "bookshelf", "cart", "divider",

  // ── Home textiles & lighting ──────────────────────────────────
  "pillow", "blanket", "sheet", "sheets", "towel", "towels", "curtain",
  "curtains", "rug", "mat", "mats", "lamp", "light", "lights", "lighting",
  "bulb", "bulbs", "fan", "heater", "cooler", "cooling", "duvet",
  "comforter", "quilt", "pillowcase", "bedspread", "throw", "doormat",
  "tablecloth", "napkin", "lantern", "chandelier", "nightlight",
  "flashlight", "torch",

  // ── Kitchen & dining ──────────────────────────────────────────
  "bottle", "cup", "cups", "mug", "mugs", "plate", "plates", "bowl",
  "bowls", "pot", "pots", "pan", "pans", "lid", "lids", "tray", "utensil",
  "utensils", "spoon", "fork", "cutting", "board", "food", "coffee", "tea",
  "wine", "beer", "ice", "bbq", "grill", "grilling", "kettle", "tumbler",
  "flask", "straw", "funnel", "strainer", "colander", "whisk",
  "spatula", "tongs", "ladle", "grater", "peeler", "opener", "cutlery",
  "cookware", "bakeware", "skillet", "saucepan", "baking", "mixing",
  "measuring", "apron", "oven", "toaster", "blender", "mixer", "microwave",

  // ── Toys, gifts & occasions ───────────────────────────────────
  "toy", "toys", "game", "games", "puzzle", "gift", "gifts", "party",
  "birthday", "christmas", "halloween", "wedding", "graduation",
  "anniversary", "thanksgiving", "easter", "valentine", "stocking",
  "ornament", "balloon", "banner", "plush", "stuffed", "figurine",
  "collectible", "blocks",

  // ── Decor ─────────────────────────────────────────────────────
  "decor", "decoration", "decorations", "decorative", "wall", "art",
  "frame", "frames", "candle", "candles", "vase", "plant", "plants",
  "flower", "flowers", "artificial",

  // ── Apparel & accessories ─────────────────────────────────────
  "shirt", "t-shirt", "shirts", "pants", "shorts", "jacket", "coat",
  "hoodie", "sweater", "dress", "skirt", "socks", "shoes", "boots",
  "sandals", "slippers", "hat", "cap", "gloves", "scarf", "belt", "wallet",
  "watch", "jewelry", "necklace", "bracelet", "earrings", "ring", "rings",
  "sunglasses", "glasses", "backpack", "purse", "handbag", "luggage",
  "leggings", "jeans", "sweatpants", "sweatshirt", "tank", "cardigan",
  "blazer", "vest", "underwear", "swimsuit", "swimwear", "bikini",
  "pajamas", "romper", "jumpsuit", "uniform", "tie", "beanie", "visor",
  "mittens", "bandana", "jersey", "onesie", "robe", "bathrobe",

  // ── Personal care ─────────────────────────────────────────────
  "makeup", "hair", "skin", "face", "body", "hand", "nail", "brush",
  "brushes", "comb", "mirror", "razor", "soap", "shampoo", "lotion",
  "cream", "oil", "spray", "cleaner", "cleaning", "wipes", "conditioner",
  "serum", "moisturizer", "cleanser", "sunscreen", "deodorant", "perfume",
  "cologne", "fragrance", "toothbrush", "toothpaste", "floss", "tweezers",
  "trimmer", "straightener", "dryer", "sponge", "balm", "scrub", "mask",

  // ── Stationery & office ───────────────────────────────────────
  "paper", "pen", "pens", "pencil", "pencils", "marker", "markers",
  "notebook", "journal", "planner", "calendar", "sticker", "stickers",
  "label", "labels", "envelope", "envelopes", "folder", "folders",
  "binder", "clipboard", "stapler", "clip", "clips", "eraser",
  "highlighter", "crayons", "paint", "easel", "yarn", "thread", "needle",
  "pins", "buttons", "zipper", "ribbon", "beads", "glitter", "card",
  "poster", "whiteboard", "chalk", "ink", "cartridge", "refill",

  // ── Safety & medical ──────────────────────────────────────────
  "first", "aid", "medical", "safety", "emergency", "survival", "tactical",
  "security", "bandage", "gauze", "sanitizer", "disinfectant",
  "thermometer", "brace", "splint", "earplugs", "goggles", "respirator",
  "helmet", "reflective",

  // ── Grammar & connectors ──────────────────────────────────────
  "with", "for", "and", "or", "of", "in", "on", "by", "to", "from"
];
