#if canImport(SwiftUI)
import SwiftUI

public struct DSCard<Content: View>: View {
    public let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        content
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
