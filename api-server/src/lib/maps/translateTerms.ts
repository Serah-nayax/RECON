import { logger } from "../logger.js";

// Local-language search terms. Google ranks places by the words people use where they are:
// in Paris "salle d'arcade" finds most venues, and in Japan "ゲームセンター" finds places that
// "arcade" never lists. The term as typed is always searched too (see localiseTerms), so a
// missing or imperfect translation only means fewer extra places, never fewer than before.
// Free and offline: a built-in dictionary.

type Lang =
  | "de" | "fr" | "es" | "it" | "nl" | "pt" | "pl" | "cs" | "sv" | "da" | "no" | "fi"
  | "el" | "hu" | "ro" | "tr" | "ru" | "uk" | "he" | "ar" | "ja" | "ko" | "zh" | "zh-TW"
  | "zh-HK" | "th" | "vi" | "id";

/** Lowercase, accents kept, "go-kart" = "go kart", single spaces. */
function normalise(term: string): string {
  return term.normalize("NFC").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

type Entry = Partial<Record<Lang, string>>;

// Missing languages are deliberate: no common local word (German "Spielhalle" and Czech "herna"
// mean gambling halls), or English is what people use there. Entries can be shared by synonyms.
const ARCADE: Entry = {
  fr: "salle d'arcade", es: "salón recreativo", it: "sala giochi", nl: "speelhal", pt: "fliperama",
  pl: "salon gier", sv: "spelhall", fi: "pelihalli", hu: "játékterem", tr: "oyun salonu",
  ru: "игровой зал", uk: "ігровий зал", he: "מתחם משחקים", ar: "صالة ألعاب", ja: "ゲームセンター",
  ko: "오락실", zh: "电玩城", "zh-TW": "電子遊戲場", "zh-HK": "遊戲機中心", th: "เกมเซ็นเตอร์",
  vi: "trung tâm trò chơi", id: "arena permainan", el: "αίθουσα ηλεκτρονικών παιχνιδιών",
};
const GAME_ROOM: Entry = {
  ...ARCADE, fr: "salle de jeux", es: "sala de juegos", pt: "sala de jogos",
};
const GAME_CENTER: Entry = { ...ARCADE, ko: "게임센터", id: "game center" };
const FEC: Entry = {
  de: "Freizeitcenter", fr: "centre de loisirs", es: "centro de ocio familiar", it: "centro divertimenti",
  nl: "familie entertainment centrum", pt: "centro de entretenimento familiar", pl: "centrum rozrywki",
  cs: "zábavní centrum", sv: "aktivitetscenter", da: "aktivitetscenter", no: "aktivitetssenter",
  fi: "elämyskeskus", hu: "szórakoztató központ", ro: "centru de distracții", tr: "eğlence merkezi",
  ru: "семейный развлекательный центр", uk: "розважальний центр", he: "מרכז בילוי משפחתי",
  ar: "مركز ترفيه عائلي", ja: "アミューズメント施設", zh: "家庭娱乐中心", "zh-TW": "家庭娛樂中心",
  "zh-HK": "家庭娛樂中心", vi: "khu vui chơi giải trí", id: "pusat hiburan keluarga",
};
const ENTERTAINMENT_CENTER: Entry = {
  ...FEC, es: "centro de ocio", pt: "centro de entretenimento", nl: "entertainmentcentrum",
  ru: "развлекательный центр", he: "מרכז בידור", ar: "مركز ترفيهي", zh: "娱乐中心", "zh-TW": "娛樂中心",
  "zh-HK": "娛樂中心", id: "pusat hiburan",
};
const INDOOR_PLAYGROUND: Entry = {
  de: "Indoorspielplatz", fr: "parc de jeux intérieur", es: "parque infantil cubierto",
  it: "parco giochi al coperto", nl: "indoor speeltuin", pt: "parque infantil coberto", pl: "sala zabaw",
  cs: "dětské zábavní centrum", sv: "lekland", da: "legeland", no: "lekeland", fi: "sisäleikkipuisto",
  el: "παιδότοπος", hu: "játszóház", ro: "loc de joacă", tr: "kapalı oyun alanı",
  ru: "детская игровая комната", uk: "дитяча ігрова кімната", he: "משחקייה", ar: "منطقة ألعاب أطفال",
  ja: "室内遊び場", ko: "키즈카페", zh: "室内儿童乐园", "zh-TW": "室內遊樂場", "zh-HK": "室內遊樂場",
  th: "สนามเด็กเล่นในร่ม", vi: "khu vui chơi trẻ em", id: "taman bermain anak",
};
const BOWLING: Entry = {
  de: "Bowling", fr: "bowling", es: "bolera", it: "bowling", nl: "bowlingbaan", pt: "boliche",
  pl: "kręgielnia", cs: "bowling", sv: "bowlinghall", da: "bowlingcenter", no: "bowlinghall",
  fi: "keilahalli", el: "μπόουλινγκ", hu: "bowling", ro: "bowling", tr: "bowling salonu", ru: "боулинг",
  uk: "боулінг", he: "באולינג", ar: "بولينج", ja: "ボウリング場", ko: "볼링장", zh: "保龄球馆",
  "zh-TW": "保齡球館", "zh-HK": "保齡球場", th: "โบว์ลิ่ง", vi: "bowling", id: "bowling",
};
const TRAMPOLINE: Entry = {
  de: "Trampolinpark", fr: "trampoline park", es: "parque de trampolines", it: "parco trampolini",
  nl: "trampolinepark", pt: "parque de trampolins", pl: "park trampolin", cs: "trampolínový park",
  sv: "trampolinpark", da: "trampolinpark", no: "trampolinepark", fi: "trampoliinipuisto",
  el: "πάρκο τραμπολίνων", hu: "trambulinpark", ro: "parc de trambuline", tr: "trambolin park",
  ru: "батутный центр", uk: "батутний центр", he: "פארק טרמפולינות", ar: "حديقة الترامبولين",
  ja: "トランポリンパーク", ko: "트램폴린 파크", zh: "蹦床公园", "zh-TW": "彈跳床樂園", "zh-HK": "彈床公園",
  th: "แทรมโพลีน", vi: "công viên bạt nhún", id: "trampolin park",
};
const LASER_TAG: Entry = {
  de: "Lasertag", fr: "laser game", it: "laser game", nl: "lasergame", cs: "laser game", sv: "laserdome",
  fi: "lasertag", hu: "lézerharc", tr: "lazer tag", ru: "лазертаг", uk: "лазертаг", he: "לייזר טאג",
  ar: "ليزر تاج", ja: "レーザータグ", ko: "레이저태그", zh: "激光枪战", "zh-TW": "雷射槍戰",
  "zh-HK": "激光槍戰",
};
const GO_KART: Entry = {
  de: "Kartbahn", fr: "karting", es: "karting", it: "go kart", nl: "karting", pt: "kart", pl: "gokarty",
  cs: "motokáry", sv: "gokart", da: "gokart", no: "gokart", fi: "karting", el: "καρτ", hu: "gokart",
  ro: "karting", tr: "go kart pisti", ru: "картинг", uk: "картинг", he: "קארטינג", ar: "كارتينج",
  ja: "ゴーカート", ko: "고카트", zh: "卡丁车", "zh-TW": "卡丁車", "zh-HK": "卡丁車", th: "โกคาร์ท",
  vi: "đua xe go kart", id: "gokart",
};
const MINI_GOLF: Entry = {
  de: "Minigolf", fr: "minigolf", es: "minigolf", it: "minigolf", nl: "midgetgolf", pt: "minigolfe",
  pl: "minigolf", cs: "minigolf", sv: "minigolf", da: "minigolf", no: "minigolf", fi: "minigolf",
  el: "μίνι γκολφ", hu: "minigolf", ro: "minigolf", tr: "mini golf", ru: "мини-гольф", uk: "міні-гольф",
  he: "מיני גולף", ar: "ميني جولف", ja: "パターゴルフ", ko: "미니골프", zh: "迷你高尔夫",
  "zh-TW": "迷你高爾夫", "zh-HK": "迷你高爾夫", th: "มินิกอล์ฟ",
};
const ESCAPE_ROOM: Entry = {
  de: "Escape Room", fr: "escape game", es: "escape room", it: "escape room", nl: "escaperoom",
  pl: "escape room", cs: "úniková hra", fi: "pakohuone", el: "escape room", hu: "szabaduló szoba",
  tr: "kaçış oyunu", ru: "квест комната", uk: "квест кімната", he: "חדר בריחה", ar: "غرفة الهروب",
  ja: "脱出ゲーム", ko: "방탈출", zh: "密室逃脱", "zh-TW": "密室逃脫", "zh-HK": "密室逃脫",
};
const BILLIARDS: Entry = {
  de: "Billard", fr: "billard", es: "billar", it: "biliardo", nl: "biljart", pt: "bilhar", pl: "bilard",
  cs: "kulečník", sv: "biljard", da: "billard", no: "biljard", fi: "biljardi", el: "μπιλιάρδο",
  hu: "biliárd", ro: "biliard", tr: "bilardo salonu", ru: "бильярдный клуб", uk: "більярдний клуб",
  he: "ביליארד", ar: "بلياردو", ja: "ビリヤード", ko: "당구장", zh: "台球厅", "zh-TW": "撞球場",
  "zh-HK": "桌球室", th: "สนุกเกอร์", vi: "bida", id: "biliar",
};
const BARCADE: Entry = {
  fr: "bar arcade", es: "bar arcade", it: "bar giochi arcade", nl: "arcade bar", pt: "bar arcade",
  ja: "ゲームバー", ko: "게임 바", ru: "бар с игровыми автоматами",
};
const PINBALL: Entry = {
  de: "Flipper", fr: "flipper", es: "pinball", it: "flipper", nl: "flipperkast", pt: "pinball",
  ja: "ピンボール", ko: "핀볼", zh: "弹珠台", "zh-TW": "彈珠台", "zh-HK": "彈珠機",
};
const VR_ARCADE: Entry = {
  de: "VR Arcade", fr: "salle de réalité virtuelle", es: "realidad virtual", it: "realtà virtuale",
  nl: "VR arcade", pt: "realidade virtual", pl: "wirtualna rzeczywistość", ru: "VR клуб", uk: "VR клуб",
  he: "מציאות מדומה", ja: "VR施設", ko: "VR 게임장", zh: "VR体验馆", "zh-TW": "VR體驗館",
  "zh-HK": "VR體驗館", tr: "sanal gerçeklik",
};
const CLAW: Entry = {
  fr: "machine à pince", ja: "クレーンゲーム", ko: "인형뽑기", zh: "娃娃机", "zh-TW": "夾娃娃機",
  "zh-HK": "夾公仔機",
};
const AMUSEMENT_PARK: Entry = {
  de: "Freizeitpark", fr: "parc d'attractions", es: "parque de atracciones", it: "parco divertimenti",
  nl: "pretpark", pt: "parque de diversões", pl: "park rozrywki", cs: "zábavní park", sv: "nöjespark",
  da: "forlystelsespark", no: "fornøyelsespark", fi: "huvipuisto", el: "λούνα παρκ", hu: "vidámpark",
  ro: "parc de distracții", tr: "lunapark", ru: "парк аттракционов", uk: "парк атракціонів",
  he: "לונה פארק", ar: "مدينة ملاهي", ja: "遊園地", ko: "놀이공원", zh: "游乐园", "zh-TW": "遊樂園",
  "zh-HK": "遊樂場", th: "สวนสนุก", vi: "công viên giải trí", id: "taman hiburan",
};

const DICTIONARY: Record<string, Entry> = {
  "arcade": ARCADE,
  "arcades": ARCADE,
  "amusement arcade": GAME_ROOM,
  "video arcade": ARCADE,
  "game arcade": ARCADE,
  "gaming arcade": ARCADE,
  "game room": GAME_ROOM,
  "game center": GAME_CENTER,
  "game centre": GAME_CENTER,
  "gaming center": GAME_CENTER,
  "family entertainment center": FEC,
  "family entertainment centre": FEC,
  "fec": FEC,
  "entertainment center": ENTERTAINMENT_CENTER,
  "entertainment centre": ENTERTAINMENT_CENTER,
  "amusement center": ENTERTAINMENT_CENTER,
  "amusement centre": ENTERTAINMENT_CENTER,
  "entertainment restaurant": ENTERTAINMENT_CENTER,
  "indoor playground": INDOOR_PLAYGROUND,
  "indoor play area": INDOOR_PLAYGROUND,
  "soft play": INDOOR_PLAYGROUND,
  "bowling": BOWLING,
  "bowling alley": BOWLING,
  "bowling center": BOWLING,
  "trampoline park": TRAMPOLINE,
  "laser tag": LASER_TAG,
  "laser game": LASER_TAG,
  "go kart": GO_KART,
  "go karts": GO_KART,
  "go kart track": GO_KART,
  "go karting": GO_KART,
  "karting": GO_KART,
  "mini golf": MINI_GOLF,
  "minigolf": MINI_GOLF,
  "escape room": ESCAPE_ROOM,
  "escape game": ESCAPE_ROOM,
  "billiards": BILLIARDS,
  "pool hall": BILLIARDS,
  "barcade": BARCADE,
  "beercade": BARCADE,
  "arcade bar": BARCADE,
  "pinball": PINBALL,
  "pinball arcade": PINBALL,
  "vr arcade": VR_ARCADE,
  "virtual reality": VR_ARCADE,
  "claw machine": CLAW,
  "crane game": CLAW,
  "amusement park": AMUSEMENT_PARK,
};

// Languages people search in, per country (ISO code). Countries with several languages get
// each of them (Belgium: French and Dutch). English-speaking countries are absent: the term
// as typed is searched anyway.
const COUNTRY_LANGS: Record<string, Lang[]> = {
  de: ["de"], at: ["de"], li: ["de"], ch: ["de", "fr", "it"],
  fr: ["fr"], mc: ["fr"], lu: ["fr", "de"], be: ["fr", "nl"],
  ma: ["fr", "ar"], dz: ["fr", "ar"], tn: ["fr", "ar"], sn: ["fr"], ci: ["fr"],
  es: ["es"], mx: ["es"], ar: ["es"], cl: ["es"], co: ["es"], pe: ["es"], ve: ["es"], ec: ["es"],
  bo: ["es"], py: ["es"], uy: ["es"], cr: ["es"], pa: ["es"], do: ["es"], gt: ["es"], hn: ["es"],
  sv: ["es"], ni: ["es"], cu: ["es"],
  it: ["it"], sm: ["it"], nl: ["nl"], pt: ["pt"], br: ["pt"], ao: ["pt"], mz: ["pt"],
  pl: ["pl"], cz: ["cs"], se: ["sv"], dk: ["da"], no: ["no"], fi: ["fi"], gr: ["el"], cy: ["el", "tr"],
  hu: ["hu"], ro: ["ro"], md: ["ro"], tr: ["tr"], ru: ["ru"], by: ["ru"], kz: ["ru"], ua: ["uk"],
  il: ["he"], sa: ["ar"], ae: ["ar"], qa: ["ar"], kw: ["ar"], bh: ["ar"], om: ["ar"], jo: ["ar"],
  eg: ["ar"], iq: ["ar"], lb: ["ar", "fr"],
  jp: ["ja"], kr: ["ko"], cn: ["zh"], tw: ["zh-TW"], hk: ["zh-HK"], mo: ["zh-HK"], sg: ["zh"],
  my: ["zh"], th: ["th"], vn: ["vi"], id: ["id"],
};

// When the area is free text without a resolved country (OpenStreetMap unreachable).
const COUNTRY_NAME_LANGS: Array<[RegExp, Lang[]]> = [
  [/\b(germany|deutschland|austria|österreich)\b/i, ["de"]],
  [/\b(switzerland|schweiz|suisse)\b/i, ["de", "fr", "it"]],
  [/\b(belgium|belgique|belgië)\b/i, ["fr", "nl"]],
  [/\b(france|luxembourg|monaco)\b/i, ["fr"]],
  [/\b(spain|españa|mexico|méxico|argentina|chile|colombia|peru|perú)\b/i, ["es"]],
  [/\b(italy|italia)\b/i, ["it"]],
  [/\b(netherlands|nederland|holland)\b/i, ["nl"]],
  [/\b(portugal|brazil|brasil)\b/i, ["pt"]],
  [/\b(poland|polska)\b/i, ["pl"]],
  [/\b(japan|japon|日本)\b/i, ["ja"]],
  [/\b(south korea|korea|corée)\b/i, ["ko"]],
  [/\b(israel|israël)\b/i, ["he"]],
  [/\b(turkey|türkiye|turquie)\b/i, ["tr"]],
];

const areaCountryCache = new Map<string, string | null>();

/** Country of a free-text area, from OpenStreetMap (free). Null when unknown or unreachable. */
async function areaCountry(area: string): Promise<string | null> {
  const key = area.toLowerCase().trim();
  if (areaCountryCache.has(key)) return areaCountryCache.get(key)!;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(area)}&format=json&limit=1&addressdetails=1`,
      { headers: { "User-Agent": "Recon-Maps-Search/1.0" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ address?: { country_code?: string } }>;
    const code = data[0]?.address?.country_code?.toLowerCase() ?? null;
    areaCountryCache.set(key, code);
    return code;
  } catch (err) {
    logger.warn({ area, err: err instanceof Error ? err.message : String(err) }, "Area country lookup failed");
    return null; // not cached: retry on the next search
  }
}

async function areaLanguages(area: string, countryCode?: string): Promise<Lang[]> {
  if (countryCode) return COUNTRY_LANGS[countryCode.toLowerCase()] ?? [];
  const fromText = COUNTRY_NAME_LANGS.find(([rx]) => rx.test(area))?.[1];
  if (fromText) return fromText;
  const code = await areaCountry(area);
  return code ? COUNTRY_LANGS[code] ?? [] : [];
}

/**
 * The English synonyms of a term in the dictionary ("laser tag" → "laser game"), whatever the
 * area: a drawn area has no country, so no translation, but "Laser Games" still names a laser tag
 * venue. Only used to sort places; never searched.
 */
export function termSynonyms(term: string): string[] {
  const entry = DICTIONARY[normalise(term)];
  if (!entry) return [];
  return Object.keys(DICTIONARY).filter(
    (key) => DICTIONARY[key] === entry && key !== normalise(term) && key.length >= 4,
  );
}

/**
 * Every term to search in the area: each term's local-language versions (one per language
 * spoken there), then the term as typed. In Japan "laser tag, go-kart track" becomes
 * レーザータグ, laser tag, ゴーカート, go-kart track.
 *
 * @param countryCode ISO country of the area when already known (resolved OpenStreetMap area).
 */
export async function localiseTerms(terms: string[], area: string, countryCode?: string): Promise<string[]> {
  const langs = await areaLanguages(area, countryCode);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const key = normalise(t);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(t.trim());
    }
  };
  for (const term of terms) {
    const entry = DICTIONARY[normalise(term)];
    const local = langs.map((lang) => entry?.[lang]).filter((t): t is string => !!t);
    for (const t of local) add(t);
    add(term);
    const added = local.filter((t) => normalise(t) !== normalise(term));
    if (added.length) logger.info({ area, term, local: added }, "Search term localised");
    else if (langs.length && !entry) logger.info({ area, term, langs }, "No local term known: searching the term as typed");
  }
  return out;
}
