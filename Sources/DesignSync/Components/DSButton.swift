#if canImport(SwiftUI)
import SwiftUI

public struct DSButton: View {
    public enum Style {
        case filled
        case outline
        case nav
    }

    public let title: String
    public let style: Style
    public let action: () -> Void

    public init(_ title: String, style: Style = .filled, action: @escaping () -> Void = {}) {
        self.title = title
        self.style = style
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Text(title)
                .font(.dsButton)
                .padding(.horizontal, style == .nav ? 14 : 20)
                .padding(.vertical, style == .nav ? 8 : StyleDictionarySize.componentButtonBasePadding)
                .frame(maxWidth: style == .nav ? nil : .infinity)
                .foregroundColor(foregroundColor)
                .background(backgroundColor)
                .cornerRadius(StyleDictionarySize.componentButtonBaseRadius)
                .overlay(
                    Group {
                        if style == .outline {
                            RoundedRectangle(cornerRadius: StyleDictionarySize.componentButtonBaseRadius)
                                .stroke(Color.dsButtonOutlineBorder, lineWidth: 1)
                        }
                    }
                )
        }
    }

    private var foregroundColor: Color {
        switch style {
        case .filled:
            return Color.dsButtonFilledForeground
        case .outline:
            return Color.dsButtonOutlineForegroundDefault
        case .nav:
            return Color.dsButtonNavForeground
        }
    }

    private var backgroundColor: Color {
        switch style {
        case .filled:
            return Color.dsButtonFilledBackgroundDefault
        case .outline:
            return Color.clear
        case .nav:
            return Color.dsButtonNavBackground
        }
    }
}
#endif
