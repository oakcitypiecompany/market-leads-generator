import Foundation

// The on-device model copies dates as written; this turns them into real dates, because the
// small model gets weekday math wrong ("this Friday" from a Tuesday).
let eastern = TimeZone(identifier: "America/New_York")!
var cal: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = eastern; return c }

func day(_ s: String) -> Date? {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = eastern
    f.dateFormat = "yyyy-MM-dd"
    return f.date(from: s)
}

func ymd(_ d: Date) -> String {
    let c = cal.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
}

private let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
private let monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
private let weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

func resolveDate(_ written: String, posted: Date) -> String? {
    let t = written.lowercased()
    if t.contains("today") || t.contains("tonight") { return ymd(posted) }
    if t.contains("tomorrow") { return ymd(cal.date(byAdding: .day, value: 1, to: posted)!) }

    let words = t.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
    let weekday = words.compactMap { w in weekdays.firstIndex { w.hasPrefix($0) && (w.count == 3 || w.hasSuffix("day") || w == "tues" || w == "thurs") } }.first

    var month: Int?, dayNum: Int?
    for (i, w) in words.enumerated() {
        if month == nil, let m = months.firstIndex(where: { w == $0 || w == monthNames[months.firstIndex(of: $0)!] || (w == "sept" && $0 == "sep") }) {
            month = m + 1
            // "November 7th" or "7 Nov" / "11-OCT"
            let neighbours = [i + 1, i - 1].filter { $0 >= 0 && $0 < words.count }.map { words[$0] }
            dayNum = neighbours.lazy.compactMap { Int($0.prefix { $0.isNumber }) }.first { (1...31).contains($0) }
        }
    }
    if month == nil, let slash = t.firstMatch(of: /(\d{1,2})\/(\d{1,2})/) { month = Int(slash.1); dayNum = Int(slash.2) }

    if let month, let dayNum, (1...12).contains(month) {
        // Year that puts the date nearest after the post (markets are announced up to ~10 months ahead).
        let postedYear = cal.component(.year, from: posted)
        let candidates = [postedYear - 1, postedYear, postedYear + 1].compactMap {
            cal.date(from: DateComponents(year: $0, month: month, day: dayNum))
        }.filter { $0.timeIntervalSince(posted) > -60 * 86400 && $0.timeIntervalSince(posted) < 300 * 86400 }
        guard var date = candidates.first else { return nil }
        // OCR misreads like "NOVEMBER 2TH" next to "Saturday": take the nearest day in that month that is a Saturday.
        if let weekday, cal.component(.weekday, from: date) - 1 != weekday {
            let options = (-6...6).compactMap { cal.date(byAdding: .day, value: $0, to: date) }
                .filter { cal.component(.weekday, from: $0) - 1 == weekday && cal.component(.month, from: $0) == month }
            if let best = options.min(by: { abs($0.timeIntervalSince(date)) < abs($1.timeIntervalSince(date)) }) { date = best }
        }
        return ymd(date)
    }
    // A bare day number from a schedule graphic ("7"): next date with that day, from a week before the post.
    if weekday == nil, words.count == 1, let n = Int(words[0]), (1...31).contains(n) {
        let from = cal.date(byAdding: .day, value: -7, to: posted)!
        return (0...62).lazy.compactMap { cal.date(byAdding: .day, value: $0, to: from) }
            .first { cal.component(.day, from: $0) == n }.map(ymd)
    }
    if let weekday {
        // "this Friday" / "Saturday": next one on or after the post date ("next Saturday" too; posts rarely mean +7).
        let today = cal.component(.weekday, from: posted) - 1
        return ymd(cal.date(byAdding: .day, value: (weekday - today + 7) % 7, to: posted)!)
    }
    return nil
}

// Vision sometimes returns Cyrillic letters that look Latin ("ОСТ" for OCT), which breaks month matching.
func latinLookalikes(_ s: String) -> String {
    let map: [Character: Character] = ["А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "К": "K", "М": "M", "О": "O", "Р": "P", "Т": "T", "Х": "X", "З": "3", "І": "I",
                                       "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "т": "t", "к": "k", "м": "m", "н": "h", "і": "i"]
    return String(s.map { map[$0] ?? $0 })
}

// The model reads "11-5pm" as 23:00-05:00 or "9-2pm" as 21:00-14:00. Markets run in daytime and evening,
// so an end before the start means the hours need shifting. Anything that isn't HH:MM is dropped.
func fixTimes(_ start: String?, _ end: String?) -> (String?, String?) {
    func hm(_ t: String?) -> (Int, Int)? {
        guard let t, let m = t.wholeMatch(of: /(\d{1,2}):(\d{2})/), let h = Int(m.1), let mi = Int(m.2), h < 24, mi < 60 else { return nil }
        return (h, mi)
    }
    guard var s = hm(start) else { return (nil, hm(end).map { String(format: "%02d:%02d", $0.0, $0.1) }) }
    guard var e = hm(end) else { return (String(format: "%02d:%02d", s.0, s.1), nil) }
    if e.0 * 60 + e.1 <= s.0 * 60 + s.1 {
        if s.0 >= 12 { s.0 -= 12 }                                  // 23:00-05:00 -> 11:00-05:00, 21:00-14:00 -> 09:00-14:00
        if e.0 < 12, e.0 * 60 + e.1 <= s.0 * 60 + s.1 { e.0 += 12 }  // 11:00-05:00 -> 11:00-17:00
    }
    let f = { (t: (Int, Int)) in String(format: "%02d:%02d", t.0, t.1) }
    return (f(s), f(e))
}

func dateSelfTest() {
    let tue = day("2026-11-10")!
    let cases: [(String, Date, String?)] = [
        ("this Friday", tue, "2026-11-13"),
        ("Friday 5-9pm", tue, "2026-11-13"),
        ("TONIGHT", tue, "2026-11-10"),
        ("tomorrow", tue, "2026-11-11"),
        ("Tuesday", tue, "2026-11-10"),
        ("Saturday, November 2TH", day("2026-11-06")!, "2026-11-07"),
        ("NOVEMBER 7TH", day("2026-11-06")!, "2026-11-07"),
        ("11-OCT", day("2026-10-21")!, "2026-10-11"),
        ("25 OCT", day("2026-10-21")!, "2026-10-25"),
        ("Sept. 13th", day("2026-09-10")!, "2026-09-13"),
        ("January 10", day("2026-12-01")!, "2027-01-10"),
        ("12/6", day("2026-11-20")!, "2026-12-06"),
        ("soon", tue, nil),
        ("7", day("2026-11-02")!, "2026-11-07"),
        ("1", day("2026-11-02")!, "2026-11-01"),
        ("1", day("2026-11-20")!, "2026-12-01"),
        ("31", day("2026-10-28")!, "2026-10-31"),
        (latinLookalikes("25 ОСТ"), day("2026-10-21")!, "2026-10-25"),
        ("Fall Makers Market Saturday", day("2026-11-06")!, "2026-11-07"),
    ]
    for (text, posted, want) in cases {
        let got = resolveDate(text, posted: posted)
        precondition(got == want, "resolveDate(\"\(text)\") = \(got ?? "nil"), want \(want ?? "nil")")
    }
    for (a, b, want) in [("23:00", "05:00", ("11:00", "17:00")), ("21:00", "14:00", ("09:00", "14:00")), ("11:00", "14:00", ("11:00", "14:00")),
                         ("17:00", "21:00", ("17:00", "21:00")), ("N/A", "N/A", ("", "")), ("10:00", "4:00", ("10:00", "16:00"))] {
        let got = fixTimes(a, b)
        precondition((got.0 ?? "", got.1 ?? "") == want, "fixTimes(\(a), \(b)) = \(got), want \(want)")
    }
    print("date self-test passed (\(cases.count) cases)")
}
