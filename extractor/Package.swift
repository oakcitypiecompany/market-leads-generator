// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "extract",
    platforms: [.macOS(.v26)],
    targets: [.executableTarget(name: "extract")]
)
