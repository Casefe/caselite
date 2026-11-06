import Foundation
import Vision
import ImageIO

// 只接收宿主渲染的当前页 PNG；不接受路径、URL、Shell 或网络参数。
struct Block: Codable { let text: String; let box: [Double]; let confidence: Float }
do {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard data.count <= 32 * 1024 * 1024,
          let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          image.width * image.height <= 9_000_000 else { exit(2) }
    let request = VNRecognizeTextRequest()
    request.revision = VNRecognizeTextRequestRevision3
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image).perform([request])
    let blocks: [Block] = (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return Block(text: candidate.string, box: [box.minX, box.minY, box.width, box.height], confidence: candidate.confidence)
    }
    FileHandle.standardOutput.write(try JSONEncoder().encode(blocks))
} catch { exit(1) }
