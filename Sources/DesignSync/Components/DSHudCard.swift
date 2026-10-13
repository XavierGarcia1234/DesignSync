#if canImport(SwiftUI)
import SwiftUI

public struct DSHudCard: View {
    public let number: String
    public let status: String
    public let title: String
    public let subtitle: String

    public init(number: String, status: String, title: String, subtitle: String) {
        self.number = number
        self.status = status
        self.title = title
        self.subtitle = subtitle
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(number)
                    .font(.dsMonoXs)
                    .foregroundColor(Color.dsHudCardNumberForeground)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.dsHudCardNumberBackground)
                    .cornerRadius(StyleDictionarySize.componentHudCardNumberRadius)
                Spacer()
                Text(status)
                    .font(.dsMonoXs)
                    .tracking(StyleDictionarySize.typographyLetterSpacingWide)
                    .foregroundColor(Color.dsHudCardCategoryForeground)
            }

            Text(title)
                .font(.dsHeading2)
                .foregroundColor(Color.dsInkPrimary)

            Text(subtitle)
                .font(.dsBodySm)
                .foregroundColor(Color.dsInkMuted)
        }
        .padding(16)
        .background(Color.dsBackgroundRaised)
        .cornerRadius(StyleDictionarySize.componentHudCardRadius)
        .overlay(
            RoundedRectangle(cornerRadius: StyleDictionarySize.componentHudCardRadius)
                .stroke(Color.dsBorderLine, lineWidth: 1)
        )
    }
}
#endif
