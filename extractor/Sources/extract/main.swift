// Reads one JSON job on stdin, OCRs any images with Vision, asks Apple's on-device
// model for market details, prints JSON on stdout.
// Input:  {"caption": "...", "postedAt": "2026-11-20", "images": ["/abs/a.jpg"], "pageText": "..."}
//   caption+images = an Instagram post; pageText = a market website (used to fill gaps).
// Output: {"ocrText": "...", "skipped": bool, "result": {"events": [MarketEvent]}}
//   skipped = the keyword pre-filter found no hint of an event, so the model never ran.
import Foundation
import FoundationModels
import Vision

struct Job: Decodable {
    var caption: String?
    var postedAt: String?
    var images: [String]?
    var pageText: String?
}

@Generable
struct EventDate: Codable {
    @Guide(description: "The date copied exactly as written, plus any weekday the text gives for it, e.g. \"Saturday, November 7th\", \"this Friday\", \"TONIGHT\", \"25 OCT\".")
    var asWritten: String
    @Guide(description: "Start time as 24-hour HH:MM, if stated")
    var startTime: String?
    @Guide(description: "End time as 24-hour HH:MM, if stated")
    var endTime: String?
}

@Generable
struct MarketEvent: Codable {
    @Guide(description: "Name of the market, festival or event")
    var marketName: String
    @Guide(description: "Who runs it, only if the text says who hosts or organizes it")
    var organizer: String?
    @Guide(description: "Name of the place hosting it, such as a brewery, park or farm; never a street address")
    var venueName: String?
    @Guide(description: "Street address of the venue, only as written")
    var address: String?
    @Guide(description: "City and state, only as written")
    var city: String?
    @Guide(description: "Every date this event happens")
    var dates: [EventDate]
    @Guide(description: "Vendor application or sign-up link, if any")
    var signupUrl: String?
    @Guide(description: "The event's own website, only if written out")
    var websiteUrl: String?
    @Guide(description: "How sure you are that the details are right, 0 to 1", .range(0.0...1.0))
    var confidence: Double
}

@Generable
struct Extraction: Codable {
    @Guide(description: "Every distinct market or vendor event the text promotes; empty if none")
    var events: [MarketEvent]
}

func ocr(_ path: String) async throws -> String {
    var request = RecognizeTextRequest()
    request.recognitionLevel = .accurate
    let observations = try await request.perform(on: URL(fileURLWithPath: path))
    return observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

if CommandLine.arguments.contains("--selftest") { dateSelfTest(); prefilterSelfTest(); exit(0) }

guard case .available = SystemLanguageModel.default.availability else {
    fail("Apple Intelligence model unavailable: \(SystemLanguageModel.default.availability)")
}

let input = FileHandle.standardInput.readDataToEndOfFile()
let job: Job
do { job = try JSONDecoder().decode(Job.self, from: input) } catch { fail("bad input JSON: \(error)") }

var ocrText = ""
for path in job.images ?? [] {
    do { ocrText += latinLookalikes(try await ocr(path)) + "\n" } catch { fail("OCR failed for \(path): \(error)") }
}

let postedAt = job.postedAt ?? String(ISO8601DateFormatter().string(from: Date()).prefix(10))
guard let posted = day(postedAt) else { fail("postedAt must be YYYY-MM-DD") }
func printJSON(_ output: [String: Any]) {
    FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]))
    print()
}

if (job.pageText ?? "").isEmpty, !looksLikeEvent((job.caption ?? "") + "\n" + ocrText) {
    printJSON(["ocrText": ocrText, "skipped": true, "result": ["events": []]])
    exit(0)
}

var prompt = "Leave a field empty rather than guess.\n"
if let caption = job.caption, !caption.isEmpty { prompt += "\nPost caption:\n\(caption)\n" }
if !ocrText.isEmpty { prompt += "\nText read from the post's images:\n\(ocrText)\n" }
// shortcut: hard cut to stay inside the on-device model's ~4k-token window; chunk pages if websites get truncated badly.
if let page = job.pageText, !page.isEmpty { prompt += "\nWebsite text:\n\(page.prefix(6000))\n" }
prompt = expandPlaceCodes(prompt)

let session = LanguageModelSession(instructions: """
    You extract local events where several vendors sell to the public: farmers markets, makers and craft markets, \
    holiday and night markets, pop-ups, fairs and festivals with vendors, from social media posts and websites. \
    An event only counts if several vendors or makers sell there. Not events: classes and workshops, menus, \
    order pickups, a single shop's sale or opening hours, photos with Santa, ads, and nationwide days like Small Business Saturday. \
    The account posting is usually a vendor attending, not the organizer. \
    A post may list several events; return each one separately with its own dates. \
    Businesses listed as vendors, sponsors or featured makers are not events. \
    Product launches, restocks, sales, giveaways and contest deadlines are not events. \
    On schedule graphics, each event's date is usually a day number and month next to its name; copy that, not the times. \
    Text read from images can contain errors: map-pin and calendar icons often appear as "8", "@" or "O". \
    Only use facts stated in the text.
    """)

do {
    let result = try await session.respond(to: String(prompt.prefix(9000)), generating: Extraction.self, options: GenerationOptions(sampling: .greedy)).content
    // Add the resolved date next to each date as written, and drop repeats the model emits.
    var events = try JSONSerialization.jsonObject(with: JSONEncoder().encode(result.events)) as! [[String: Any]]
    for i in events.indices {
        var seen = Set<String>()
        var dates = (events[i]["dates"] as! [[String: Any]]).compactMap { d -> [String: Any]? in
            var d = d
            let date = resolveDate(d["asWritten"] as? String ?? "", posted: posted)
            d["date"] = date ?? NSNull()
            let (start, end) = fixTimes(d["startTime"] as? String, d["endTime"] as? String)
            d["startTime"] = start ?? NSNull()
            d["endTime"] = end ?? NSNull()
            return seen.insert("\(date ?? d["asWritten"] as? String ?? "")|\(d["startTime"] ?? "")").inserted ? d : nil
        }
        // The model sometimes lists a time ("5-9pm") as its own date; keep unresolved ones only when nothing resolved.
        if dates.contains(where: { $0["date"] is String }) { dates.removeAll { !($0["date"] is String) } }
        events[i]["dates"] = dates
        for key in ["organizer", "venueName", "address", "city", "signupUrl", "websiteUrl"] {
            guard var v = (events[i][key] as? String)?.trimmingCharacters(in: .whitespaces) else { continue }
            // Pin icon read as "8"/"@" before a city: "8 Charlotte, NC". A street number is followed by a street, not "City,".
            v = v.replacing(/^[8@©O]\s+(?=[A-Z][a-z]+,)/, with: "")
            let junk = v.count < 3 || ["not specified", "none", "n/a", "unknown", "private event"].contains(v.lowercased())
            events[i][key] = junk ? nil : v
        }
    }
    printJSON(["ocrText": ocrText, "skipped": false, "result": ["events": events]])
} catch {
    fail("model failed: \(error)")
}
