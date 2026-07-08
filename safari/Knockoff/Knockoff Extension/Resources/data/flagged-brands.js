// Knockoff: seed blocklist of known pseudo-brands / trademark-squat brands.
// Many of these were banned from Amazon in the 2021 review-abuse purge
// (Aukey, Mpow, RavPower, TaoTronics, VicTsing...) or are prolific
// gibberish-name sellers. The heuristic scorer catches the long tail;
// this list guarantees the notorious ones.
var KO_FLAGGED_BRANDS = [
  // 2021 Amazon review-abuse ban wave
  "Atmoko", "Aukey", "Austor", "HOMASY", "Homitt", "Mpow", "OMORC", "RavPower",
  "Sable", "Tacklife", "TaoTronics", "TopElek", "Vava", "Victony", "VicTsing",
  "Vtin",
  // Prolific pseudo-brands
  "Acouto", "Aeun", "Ailun", "AIRAJ", "Airshi", "Alomejor", "Annadue", "Aramox",
  "AUXITO", "BEAMTECH", "Bediffer", "Blackview", "BORDSTRACT", "BOVKE",
  "Chiciris", "Cougar Motor", "Cubot", "Dilwe", "Dioche", "Doact", "DODOCOOL",
  "Doogee", "DOSS", "DOZAWA", "EBTOOLS", "EHEYCIGA", "Ejoyous", "Emoshayoga",
  "Entatial", "Eosnow", "Fahren", "Fdit", "Fintie", "Fockety", "Gedourain",
  "GOOACC", "HAOBAIMEI", "Hilitand", "HOLIFE", "HORUSDY", "Hztyyier", "Jectse",
  "Keenso", "KKmoon", "LASFIT", "LATTOOK", "LETSCOM", "LK", "MAGT", "Mgaxyff",
  "Mkeke", "MoKo", "MOSFiATA", "Naola", "Naroote", "NOCOEX", "Okuyonic",
  "OMOTON", "ORIA", "Oukitel", "Oumefar", "Pilipane", "Plyisty", "ProCase",
  "Pwshymi", "Qiilu", "QWORK", "Salutuy", "SEALIGHT", "Septpenta", "Shanrya",
  "Sonew", "SPYMINNPOO", "Suchinm", "Syncwire", "SZHLUX", "Tbest", "TEKPREM",
  "TiMOVO", "Tnfeeon", "Trianium", "Ulefone", "UMIDIGI", "VANKYO", "VGEBY",
  "Vikye", "Walfront", "WNPETHOME", "Xhuangtech", "YITAMOTOR", "Ymiko", "Yosoo",
  "Yosooo", "Zerone", "Zyyini"
];
