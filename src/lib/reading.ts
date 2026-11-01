/**
 * Readings of Japanese text as it is typed, for suggesting romaji slugs
 * (旅行 → ryokou). The IME shows the kana (りょこう) in composition updates
 * before it is converted, so each committed piece is remembered with the last
 * all-kana form it had. Text pasted or typed without an IME has no reading;
 * kanji without one are left out of the slug.
 */

const KANA = /^[ぁ-ゖァ-ヺーA-Za-z0-9\s'ー]+$/;

export type ReadingTracker = {
  onCompositionUpdate: (e: { data: string }) => void;
  onCompositionEnd: (e: { data: string }) => void;
  /** `text` with every remembered piece replaced by its kana. */
  readingOf: (text: string) => string;
};

export function createReadingTracker(): ReadingTracker {
  let kana = "";
  const pieces = new Map<string, string>();
  return {
    onCompositionUpdate: (e) => {
      if (KANA.test(e.data)) kana = e.data;
    },
    onCompositionEnd: (e) => {
      if (e.data && kana && e.data !== kana) pieces.set(e.data, kana);
      kana = "";
    },
    readingOf: (text) => {
      let out = text;
      // Longest first, so 東京都 wins over 東京.
      for (const [piece, reading] of [...pieces].sort((a, b) => b[0].length - a[0].length)) {
        out = out.split(piece).join(reading);
      }
      return out;
    },
  };
}

// Wāpuro-style romaji (as typed: おう → ou), which reads naturally in URLs.
const BASE: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "i", ゑ: "e", を: "o", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
  ゔ: "vu",
};
// Two-kana sounds (きゃ, しゅ, ふぁ …).
const COMBO: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo", しゃ: "sha", しゅ: "shu", しょ: "sho", しぇ: "she",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho", ちぇ: "che", にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo", ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo", じぇ: "je", びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo", ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
  てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du", うぃ: "wi", うぇ: "we", うぉ: "wo",
  ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
};

const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** Hiragana/katakana to romaji; other characters pass through. */
export function romanize(text: string): string {
  const s = toHiragana(text);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const pair = COMBO[s.slice(i, i + 2)];
    if (s[i] === "っ") {
      // Doubles the next consonant (きって → kitte, っち → tchi).
      const next = COMBO[s.slice(i + 1, i + 3)] ?? BASE[s[i + 1]] ?? "";
      out += next.startsWith("ch") ? "t" : (next[0] ?? "");
    } else if (s[i] === "ー") {
      // Long vowel mark: dropped (ラーメン → ramen).
    } else if (pair) {
      out += pair;
      i++;
    } else if (s[i] === "ん" && /^[aiueoy]/.test(BASE[s[i + 1]] ?? "")) {
      out += "n'";
    } else {
      out += BASE[s[i]] ?? s[i];
    }
  }
  return out.replace(/n'/g, "n-");
}
