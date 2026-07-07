// Knockoff: seed blocklist of known pseudo-brands / trademark-squat brands.
// Many of these were banned from Amazon in the 2021 review-abuse purge
// (Aukey, Mpow, RavPower, TaoTronics, VicTsing...) or are prolific
// gibberish-name sellers. The heuristic scorer catches the long tail;
// this list guarantees the notorious ones.
var KO_FLAGGED_BRANDS = [
  // 2021 Amazon review-abuse ban wave
  "Aukey", "Mpow", "RavPower", "TaoTronics", "VicTsing", "Vava",
  "Atmoko", "HOMASY", "OMORC", "TopElek", "Victony", "Tacklife",
  "Austor", "Homitt", "Sable", "Vtin",
  // Prolific pseudo-brands
  "LATTOOK", "DOZAWA", "HORUSDY", "SZHLUX", "QWORK", "AIRAJ",
  "WNPETHOME", "EHEYCIGA",
  "TEKPREM", "ORIA", "HOLIFE", "MOSFiATA", "OMOTON", "LETSCOM",
  "VANKYO", "DOSS", "DODOCOOL", "BOVKE", "MoKo", "Fintie", "TiMOVO",
  "ProCase", "Ailun", "Mkeke", "Trianium", "LK", "Syncwire",
  "UMIDIGI", "Blackview", "Oukitel", "Doogee", "Cubot", "Ulefone",
  "HAOBAIMEI", "GOOACC", "NOCOEX", "YITAMOTOR", "AUXITO", "LASFIT",
  "SEALIGHT", "Fahren", "Cougar Motor", "BEAMTECH",
  "KKmoon", "Walfront", "Zerone", "Fdit", "Hilitand", "Mgaxyff",
  "Ejoyous", "Qiilu", "Yosoo", "Dioche", "EBTOOLS", "VGEBY",
  "Tbest", "Alomejor", "Dilwe", "Pwshymi", "Jectse", "Ymiko",
  "Fockety", "Naroote", "Septpenta", "Shanrya", "SPYMINNPOO",
  "BORDSTRACT", "MAGT", "Pilipane", "Vikye", "Doact", "Sonew",
  "Okuyonic", "Zyyini", "Salutuy", "Emoshayoga", "Gedourain",
  "Airshi", "Yosooo", "Annadue", "Bediffer", "Eosnow", "Chiciris",
  "Hztyyier", "Aeun", "Naola", "Entatial", "Plyisty", "Aramox",
  "Keenso", "Suchinm", "Acouto", "Xhuangtech", "Oumefar", "Tnfeeon"
];
