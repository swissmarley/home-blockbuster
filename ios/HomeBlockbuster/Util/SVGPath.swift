import SwiftUI

/// Tiny SVG path-data parser (M/m, L/l, H/h, V/v, C/c, S/s, Q/q, Z/z), enough for the app's logo and avatars.
enum SVGPath {
    static func path(_ data: String) -> Path {
        var path = Path()
        var tokens = tokenize(data)[...]
        var current = CGPoint.zero
        var start = CGPoint.zero
        var lastControl: CGPoint?
        var command: Character = "M"

        func number() -> CGFloat {
            guard case let .number(n)? = tokens.first else { return 0 }
            tokens.removeFirst()
            return n
        }
        func hasNumber() -> Bool {
            if case .number? = tokens.first { return true }
            return false
        }

        while !tokens.isEmpty {
            if case let .command(c)? = tokens.first {
                command = c
                tokens.removeFirst()
            } else if !hasNumber() {
                tokens.removeFirst()
                continue
            }
            let relative = command.isLowercase
            let base = relative ? current : .zero
            switch command.uppercased().first! {
            case "M":
                current = CGPoint(x: base.x + number(), y: base.y + number())
                start = current
                path.move(to: current)
                command = relative ? "l" : "L"
                lastControl = nil
            case "L":
                current = CGPoint(x: base.x + number(), y: base.y + number())
                path.addLine(to: current)
                lastControl = nil
            case "H":
                current = CGPoint(x: (relative ? current.x : 0) + number(), y: current.y)
                path.addLine(to: current)
                lastControl = nil
            case "V":
                current = CGPoint(x: current.x, y: (relative ? current.y : 0) + number())
                path.addLine(to: current)
                lastControl = nil
            case "C":
                let c1 = CGPoint(x: base.x + number(), y: base.y + number())
                let c2 = CGPoint(x: base.x + number(), y: base.y + number())
                let end = CGPoint(x: base.x + number(), y: base.y + number())
                path.addCurve(to: end, control1: c1, control2: c2)
                lastControl = c2
                current = end
            case "S":
                let c1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let c2 = CGPoint(x: base.x + number(), y: base.y + number())
                let end = CGPoint(x: base.x + number(), y: base.y + number())
                path.addCurve(to: end, control1: c1, control2: c2)
                lastControl = c2
                current = end
            case "Q":
                let c = CGPoint(x: base.x + number(), y: base.y + number())
                let end = CGPoint(x: base.x + number(), y: base.y + number())
                path.addQuadCurve(to: end, control: c)
                lastControl = nil
                current = end
            case "Z":
                path.closeSubpath()
                current = start
                lastControl = nil
                // Z takes no arguments; a following number would repeat the previous command.
                if hasNumber() { command = "L" }
            default:
                _ = number()
            }
        }
        return path
    }

    private enum Token {
        case command(Character)
        case number(CGFloat)
    }

    private static func tokenize(_ s: String) -> [Token] {
        var out: [Token] = []
        var buffer = ""
        func flush() {
            if !buffer.isEmpty, let v = Double(buffer) { out.append(.number(CGFloat(v))) }
            buffer = ""
        }
        for ch in s {
            if ch.isLetter && ch != "e" && ch != "E" {
                flush()
                out.append(.command(ch))
            } else if ch == "-" {
                if let last = buffer.last, last == "e" || last == "E" {
                    buffer.append(ch)
                } else {
                    flush()
                    buffer.append(ch)
                }
            } else if ch == "." {
                if buffer.contains(".") && !(buffer.contains("e") || buffer.contains("E")) {
                    flush()
                }
                buffer.append(ch)
            } else if ch.isNumber || ch == "e" || ch == "E" {
                buffer.append(ch)
            } else {
                flush()
            }
        }
        flush()
        return out
    }
}

/// The red "B" mark from the web app, drawn in a 64×64 box.
struct LogoMark: Shape {
    static let data =
        "M17 8h17c8.2 0 12.6 4.4 12.6 11 0 4.4-2 7.7-5.6 9.5 4.8 1.7 7.7 5.6 7.7 11 0 8.4-5.2 16.5-15 16.5H17V8zm11 8.6v11h4.4c3.1 0 4.7-2 4.7-5.5s-1.6-5.5-4.7-5.5H28zm0 19v12h5.4c3.4 0 5.1-2.2 5.1-6s-1.7-6-5.1-6H28z"
    private static let base = SVGPath.path(data)

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 64
        return Self.base.applying(
            CGAffineTransform(translationX: rect.midX - 32 * scale, y: rect.midY - 32 * scale).scaledBy(x: scale, y: scale)
        )
    }
}
