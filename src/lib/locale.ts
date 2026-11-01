// Choices for the site's time zone and language (site info screen).

export type Choice = { value: string; label: string };

/**
 * Fixed UTC offsets in use somewhere in the world. Places with daylight
 * saving time are listed at their standard (winter) offset: the generator
 * uses a fixed offset, so DST is not followed.
 */
const OFFSETS: [string, string?][] = [
  ["-12:00"],
  ["-11:00", "米領サモア"],
  ["-10:00", "ハワイ"],
  ["-09:30", "マルキーズ諸島"],
  ["-09:00", "アラスカの標準時"],
  ["-08:00", "米国太平洋の標準時"],
  ["-07:00", "米国山岳部の標準時"],
  ["-06:00", "米国中部の標準時・メキシコシティ"],
  ["-05:00", "米国東部の標準時"],
  ["-04:00", "カナダ大西洋の標準時"],
  ["-03:30", "ニューファンドランドの標準時"],
  ["-03:00", "ブラジル（サンパウロ）・アルゼンチン"],
  ["-02:00"],
  ["-01:00", "アゾレス諸島の標準時"],
  ["+00:00", "英国の標準時・UTC"],
  ["+01:00", "ドイツ・フランスの標準時"],
  ["+02:00", "フィンランド・ギリシャの標準時"],
  ["+03:00", "モスクワ・トルコ"],
  ["+03:30", "イラン"],
  ["+04:00", "ドバイ"],
  ["+04:30", "アフガニスタン"],
  ["+05:00", "パキスタン"],
  ["+05:30", "インド"],
  ["+05:45", "ネパール"],
  ["+06:00", "バングラデシュ"],
  ["+06:30", "ミャンマー"],
  ["+07:00", "タイ・ベトナム・インドネシア西部"],
  ["+08:00", "中国・台湾・シンガポール・フィリピン"],
  ["+08:45", "オーストラリア西部の一部"],
  ["+09:00", "日本・韓国"],
  ["+09:30", "オーストラリア中部の標準時"],
  ["+10:00", "オーストラリア東部の標準時"],
  ["+10:30", "ロード・ハウ島"],
  ["+11:00", "ソロモン諸島"],
  ["+12:00", "ニュージーランドの標準時"],
  ["+12:45", "チャタム諸島の標準時"],
  ["+13:00", "トンガ"],
  ["+14:00", "キリバス（ライン諸島）"],
];

export const DEFAULT_OFFSET = "+09:00";

export const OFFSET_CHOICES: Choice[] = OFFSETS.map(([value, where]) => ({
  value,
  label: `UTC${value}${where ? `（${where}）` : ""}`,
}));

/** BCP 47 language tags for <html lang>. "jp" is a country code, not a language. */
export const LANGUAGE_CHOICES: Choice[] = [
  { value: "ja", label: "日本語（ja）" },
  { value: "en", label: "英語（en）" },
  { value: "zh-CN", label: "中国語・簡体字（zh-CN）" },
  { value: "zh-TW", label: "中国語・繁体字（zh-TW）" },
  { value: "ko", label: "韓国語（ko）" },
  { value: "fr", label: "フランス語（fr）" },
  { value: "de", label: "ドイツ語（de）" },
  { value: "es", label: "スペイン語（es）" },
  { value: "pt", label: "ポルトガル語（pt）" },
  { value: "it", label: "イタリア語（it）" },
  { value: "ru", label: "ロシア語（ru）" },
  { value: "th", label: "タイ語（th）" },
  { value: "vi", label: "ベトナム語（vi）" },
  { value: "id", label: "インドネシア語（id）" },
];

export const DEFAULT_LANGUAGE = "ja";

/** The choices, plus the current value if it isn't one of them (set by hand earlier). */
export const withCurrent = (choices: Choice[], current: string | undefined) =>
  current && !choices.some((c) => c.value === current)
    ? [...choices, { value: current, label: `${current}（現在の設定）` }]
    : choices;
