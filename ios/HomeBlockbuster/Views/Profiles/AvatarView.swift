import SwiftUI

/// The same avatars as the web app ("smile-blue", "cool-slate", "kids-rainbow"…), drawn natively.
struct AvatarView: View {
    let id: String
    /// In the avatar's 100×100 design space.
    var cornerRadius: CGFloat = 6

    static let all = [
        "smile-blue", "smile-yellow", "smile-red", "smile-green", "smile-purple", "smile-teal",
        "grin-orange", "grin-pink", "grin-blue", "wink-red", "wink-green", "cool-slate", "cool-purple",
        "wow-yellow", "wow-teal", "kids-rainbow",
    ]

    private static let colors: [String: Color] = [
        "blue": Color(hex: 0x2F6FE4), "yellow": Color(hex: 0xF2B705), "red": Color(hex: 0xE2262F),
        "green": Color(hex: 0x23A55A), "purple": Color(hex: 0x7A4BE0), "teal": Color(hex: 0x12A6A8),
        "orange": Color(hex: 0xF07318), "pink": Color(hex: 0xE3408E), "slate": Color(hex: 0x56657D),
    ]

    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height) / 100
            ZStack {
                if id == "kids-rainbow" {
                    LinearGradient(colors: [Color(hex: 0xFF5F6D), Color(hex: 0xFFC371), Color(hex: 0x47CF73), Color(hex: 0x3A8DDE)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                    Text("kids")
                        .font(.system(size: 34 * s, weight: .black))
                        .kerning(-1 * s)
                        .foregroundStyle(.white)
                } else {
                    Self.colors[color] ?? Self.colors["blue"]!
                    Canvas { ctx, size in
                        ctx.scaleBy(x: size.width / 100, y: size.height / 100)
                        ctx.fill(SVGPath.path("M0 0h100v46C70 36 30 60 0 50z"), with: .color(.white.opacity(0.07)))
                        drawFace(&ctx)
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius * s))
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }

    private var face: String {
        let f = String(id.split(separator: "-").first ?? "smile")
        return ["smile", "grin", "wink", "cool", "wow"].contains(f) ? f : "smile"
    }
    private var color: String { String(id.split(separator: "-").last ?? "blue") }

    private func drawFace(_ ctx: inout GraphicsContext) {
        let white = GraphicsContext.Shading.color(.white)
        let eye = { (x: CGFloat) in Path(roundedRect: CGRect(x: x, y: 33, width: 9, height: 17), cornerRadius: 4.5) }
        let smile = SVGPath.path("M26 60 Q50 84 74 60")
        let round = StrokeStyle(lineWidth: 8, lineCap: .round)
        switch face {
        case "grin":
            ctx.fill(Path(ellipseIn: CGRect(x: 28, y: 34, width: 12, height: 12)), with: white)
            ctx.fill(Path(ellipseIn: CGRect(x: 60, y: 34, width: 12, height: 12)), with: white)
            var mouth = Path()
            mouth.move(to: CGPoint(x: 26, y: 57))
            mouth.addLine(to: CGPoint(x: 74, y: 57))
            mouth.addArc(center: CGPoint(x: 50, y: 57), radius: 24, startAngle: .degrees(0), endAngle: .degrees(180), clockwise: false)
            mouth.closeSubpath()
            ctx.fill(mouth, with: white)
        case "wink":
            ctx.stroke(SVGPath.path("M27 43 Q33.5 35 40 43"), with: white, style: StrokeStyle(lineWidth: 6, lineCap: .round))
            ctx.fill(eye(62), with: white)
            ctx.stroke(smile, with: white, style: round)
        case "cool":
            ctx.fill(SVGPath.path("M20 36h60v4c0 7-5 12-12 12h-4c-6 0-10-4-11-9h-6c-1 5-5 9-11 9h-4c-7 0-12-5-12-12z"), with: .color(Color(hex: 0x111111)))
            ctx.stroke(SVGPath.path("M31 66 Q50 78 69 66"), with: white, style: StrokeStyle(lineWidth: 7, lineCap: .round))
        case "wow":
            for x in [34.0, 66.0] {
                ctx.fill(Path(ellipseIn: CGRect(x: x - 7, y: 33, width: 14, height: 14)), with: white)
                ctx.fill(Path(ellipseIn: CGRect(x: x - 3, y: 38, width: 6, height: 6)), with: .color(.black.opacity(0.55)))
            }
            ctx.fill(Path(ellipseIn: CGRect(x: 41, y: 57, width: 18, height: 22)), with: white)
        default:
            ctx.fill(eye(29), with: white)
            ctx.fill(eye(62), with: white)
            ctx.stroke(smile, with: white, style: round)
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}
