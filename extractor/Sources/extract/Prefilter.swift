import Foundation

// Cheap check before the model: posts with no hint of an event (flavor drops, holidays, thank-yous) are skipped.
// Website text (pageText) always goes to the model; it was searched for because it's a market.
private func hints() -> some RegexComponent { /(?i)\b(markets?|pop[- ]?ups?|vendors?|booths?|festivals?|fairs?|bazaars?|find us|come see us|join us|see you|stop by|we'll be|we will be|tonight|this (mon|tues|wednes|thurs|fri|satur|sun)day|(mon|tues|wednes|thurs|fri|satur|sun)day|(jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.? ?\d{1,2}(st|nd|rd|th)?\b|\d{1,2}(st|nd|rd|th)? ?(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)\b|\d{1,2}\/\d{1,2}\b|\d{1,2} ?(am|pm)\b)/ }

func looksLikeEvent(_ text: String) -> Bool { text.contains(hints()) }

func prefilterSelfTest() {
    let yes = ["Join us TONIGHT", "Fall Makers Market", "NOVEMBER 7TH", "Saturday 10-2", "25 OCT", "pop-up this weekend", "12/6 at the brewery", "11am - 4pm"]
    let no = ["New lemon chess pie just dropped. Order online!", "HAPPY NATIONAL KINDNESS DAY, SWEET FRIENDS!", "Our toffee lineup is stacked"]
    for t in yes { precondition(looksLikeEvent(t), "prefilter missed: \(t)") }
    for t in no { precondition(!looksLikeEvent(t), "prefilter let through: \(t)") }
    print("prefilter self-test passed (\(yes.count + no.count) cases)")
}
