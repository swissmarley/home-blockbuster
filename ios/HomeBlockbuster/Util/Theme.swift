import SwiftUI

enum Theme {
    static let red = Color(red: 0xE5 / 255, green: 0x09 / 255, blue: 0x14 / 255)
    static let background = Color(red: 0x14 / 255, green: 0x14 / 255, blue: 0x14 / 255)
    static let surface = Color(white: 0.16)
    static let surfaceHigh = Color(white: 0.22)
    static let secondaryText = Color(white: 0.70)
    static let tertiaryText = Color(white: 0.50)
    static let match = Color(red: 0.27, green: 0.83, blue: 0.40)
}

/// Primary white "Play" button.
struct PrimaryButtonStyle: ButtonStyle {
    var fill: Color = .white
    var foreground: Color = .black
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .bold))
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(foreground)
            .background(fill.opacity(configuration.isPressed ? 0.75 : 1), in: RoundedRectangle(cornerRadius: 6))
    }
}

/// Dark grey secondary button.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(.white)
            .background(Color.white.opacity(configuration.isPressed ? 0.12 : 0.2), in: RoundedRectangle(cornerRadius: 6))
    }
}

/// Icon-over-label action ("My List", "Rate").
struct IconActionLabel: View {
    let systemImage: String
    let title: String
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: systemImage).font(.system(size: 22))
            Text(title).font(.caption).foregroundStyle(Theme.secondaryText)
        }
        .frame(minWidth: 64)
        .contentShape(Rectangle())
    }
}

struct Wordmark: View {
    var size: CGFloat = 28
    var body: some View {
        Text("HOME BLOCKBUSTER")
            .font(.system(size: size, weight: .black, design: .default))
            .kerning(-0.5)
            .foregroundStyle(Theme.red)
            .scaleEffect(x: 0.86, y: 1.08)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}
