//! Minimal date handling for the schema's `YYYY-MM-DDTHH:MM:SSZ` strings.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LocalTime {
    pub year: i64,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
    pub offset_minutes: i64,
}

/// The current UTC time as `YYYY-MM-DDTHH:MM:SSZ`.
pub fn now_utc() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// Parses `+09:00` / `-05:30` / `Z`.
pub fn parse_offset(s: &str) -> Option<i64> {
    if s == "Z" || s.is_empty() {
        return Some(0);
    }
    let (sign, rest) = match s.as_bytes().first()? {
        b'+' => (1, &s[1..]),
        b'-' => (-1, &s[1..]),
        _ => return None,
    };
    let (h, m) = rest.split_once(':').unwrap_or((rest, "0"));
    Some(sign * (h.parse::<i64>().ok()? * 60 + m.parse::<i64>().ok()?))
}

/// Converts a UTC timestamp to local time at a fixed offset.
pub fn to_local(utc: &str, offset_minutes: i64) -> Option<LocalTime> {
    let b = utc.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let num = |r: std::ops::Range<usize>| utc.get(r)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, s) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let secs = days_from_civil(y, mo, d) * 86400 + h * 3600 + mi * 60 + s + offset_minutes * 60;
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    let (year, month, day) = civil_from_days(days);
    Some(LocalTime {
        year,
        month,
        day,
        hour: (rem / 3600) as u32,
        minute: (rem % 3600 / 60) as u32,
        second: (rem % 60) as u32,
        offset_minutes,
    })
}

impl LocalTime {
    /// RFC 3339 with the local offset, e.g. `2026-10-26T21:00:00+09:00`.
    pub fn rfc3339(&self) -> String {
        let o = self.offset_minutes;
        let sign = if o < 0 { '-' } else { '+' };
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{sign}{:02}:{:02}",
            self.year,
            self.month,
            self.day,
            self.hour,
            self.minute,
            self.second,
            o.abs() / 60,
            o.abs() % 60
        )
    }

    /// RFC 2822, for RSS.
    pub fn rfc2822(&self) -> String {
        const DAYS: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
        const MONTHS: [&str; 12] = [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ];
        let weekday = DAYS
            [days_from_civil(self.year, self.month as i64, self.day as i64).rem_euclid(7) as usize];
        let o = self.offset_minutes;
        format!(
            "{weekday}, {:02} {} {:04} {:02}:{:02}:{:02} {}{:02}{:02}",
            self.day,
            MONTHS[self.month as usize - 1],
            self.year,
            self.hour,
            self.minute,
            self.second,
            if o < 0 { '-' } else { '+' },
            o.abs() / 60,
            o.abs() % 60
        )
    }

    /// strftime subset: %Y %m %d %H %M %S %-m %-d.
    pub fn format(&self, fmt: &str) -> String {
        let mut out = String::new();
        let mut chars = fmt.chars();
        while let Some(c) = chars.next() {
            if c != '%' {
                out.push(c);
                continue;
            }
            match chars.next() {
                Some('Y') => out += &format!("{:04}", self.year),
                Some('m') => out += &format!("{:02}", self.month),
                Some('d') => out += &format!("{:02}", self.day),
                Some('H') => out += &format!("{:02}", self.hour),
                Some('M') => out += &format!("{:02}", self.minute),
                Some('S') => out += &format!("{:02}", self.second),
                Some('-') => match chars.next() {
                    Some('m') => out += &self.month.to_string(),
                    Some('d') => out += &self.day.to_string(),
                    Some(o) => {
                        out.push_str("%-");
                        out.push(o)
                    }
                    None => out.push_str("%-"),
                },
                Some('%') => out.push('%'),
                Some(o) => {
                    out.push('%');
                    out.push(o)
                }
                None => out.push('%'),
            }
        }
        out
    }
}

// Howard Hinnant's civil date algorithms.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_to_local() {
        let t = to_local("2026-12-31T20:30:00Z", 540).unwrap();
        assert_eq!(
            (t.year, t.month, t.day, t.hour, t.minute),
            (2027, 1, 1, 5, 30)
        );
        assert_eq!(t.rfc3339(), "2027-01-01T05:30:00+09:00");
        assert_eq!(t.rfc2822(), "Fri, 01 Jan 2027 05:30:00 +0900");
        assert_eq!(t.format("%Y年%-m月%-d日"), "2027年1月1日");
    }

    #[test]
    fn parses_offsets() {
        assert_eq!(parse_offset("+09:00"), Some(540));
        assert_eq!(parse_offset("-05:30"), Some(-330));
        assert_eq!(parse_offset("Z"), Some(0));
        assert_eq!(parse_offset("x"), None);
    }
}
