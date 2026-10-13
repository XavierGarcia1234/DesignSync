#if canImport(SwiftUI)
import SwiftUI

public struct DSTag: View {
    public enum Variant {
        case `default`
        case blue
        case orange
        case purple
        case red
    }

    public let text: String
    public let variant: Variant
    public let isFilled: Bool

    public init(_ text: String, variant: Variant = .default, isFilled: Bool = false) {
        self.text = text
        self.variant = variant
        self.isFilled = isFilled
    }

    public var body: some View {
        Text(text.uppercased())
            .font(.dsTag)
            .tracking(StyleDictionarySize.typographyLetterSpacingWide)
            .foregroundColor(foregroundColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(backgroundColor)
            .cornerRadius(StyleDictionarySize.componentTagBaseRadius)
            .overlay(
                RoundedRectangle(cornerRadius: StyleDictionarySize.componentTagBaseRadius)
                    .stroke(borderColor, lineWidth: 1)
            )
    }

    private var foregroundColor: Color {
        if isFilled {
            return Color.dsInkInverse
        }
        switch variant {
        case .default:
            return Color.dsTagBaseForegroundDefault
        case .blue:
            return Color.dsTagsBlue
        case .orange:
            return Color.dsTagsOrange
        case .purple:
            return Color.dsTagsPurple
        case .red:
            return Color.dsTagsRed
        }
    }

    private var backgroundColor: Color {
        if !isFilled { return Color.clear }
        switch variant {
        case .default:
            return Color.dsAccentBase
        case .blue:
            return Color.dsTagsBlue
        case .orange:
            return Color.dsTagsOrange
        case .purple:
            return Color.dsTagsPurple
        case .red:
            return Color.dsTagsRed
        }
    }

    private var borderColor: Color {
        switch variant {
        case .default:
            return Color.dsTagBaseBorderDefault
        case .blue:
            return Color.dsTagsBlue
        case .orange:
            return Color.dsTagsOrange
        case .purple:
            return Color.dsTagsPurple
        case .red:
            return Color.dsTagsRed
        }
    }
}
#endif
