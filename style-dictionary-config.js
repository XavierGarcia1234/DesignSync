module.exports = {
  // Style Dictionary v4 natively supports DTCG standard format
  source: ['tokens.json'],
  hooks: {
    transforms: {
      'custom/size/swift': {
        type: 'value',
        transitive: true,
        filter: (token) => (token.$type || token.type) === 'dimension',
        transform: (token) => {
          const val = String(token.$value !== undefined ? token.$value : token.value);
          if (val.startsWith('CGFloat(')) return val;
          const first = val.split(' ')[0].trim();
          if (first.endsWith('px')) {
            return `CGFloat(${parseFloat(first).toFixed(2)})`;
          }
          if (first.endsWith('rem') || first.endsWith('em')) {
            return `CGFloat(${(parseFloat(first) * 16).toFixed(2)})`;
          }
          if (first.endsWith('%')) {
            return `CGFloat(999.00)`;
          }
          const num = parseFloat(first);
          return `CGFloat(${isNaN(num) ? '0.00' : num.toFixed(2)})`;
        }
      }
    },
    transformGroups: {
      'ios-swift-custom': [
        'attribute/cti',
        'name/camel',
        'color/UIColorSwift',
        'content/swift/literal',
        'asset/swift/literal',
        'custom/size/swift'
      ]
    },
    formats: {
      'ios-swift/extended': ({ dictionary }) => {
        const colorTokens = dictionary.allTokens.filter(t => (t.$type || t.type) === 'color');
        const sizeTokens = dictionary.allTokens.filter(t => (t.$type || t.type) === 'dimension');
        const fontTokens = dictionary.allTokens.filter(t => (t.$type || t.type) === 'fontFamily');

        const colorLines = colorTokens.map(t => {
          const varName = t.path.slice(1).map((part, idx) => idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join('');
          return `    public static let ${varName || t.name} = ${t.$value}`;
        }).join('\n');

        const sizeLines = sizeTokens.map(t => {
          const varName = t.path.map((part, idx) => idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join('');
          return `    public static let ${varName} = ${t.$value}`;
        }).join('\n');

        const fontLines = fontTokens.map(t => {
          const name = t.path[t.path.length - 1];
          const cleanName = (t.$value || t.value).split(',')[0].replace(/['"]/g, '').trim();
          return `    public static let ${name} = "${cleanName}"`;
        }).join('\n');

        const swiftColorLines = colorTokens.map(t => {
          const varName = t.path.slice(1).map((part, idx) => idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join('');
          const dsName = 'ds' + (varName.charAt(0).toUpperCase() + varName.slice(1));
          return `    static let ${dsName} = Color(StyleDictionaryColor.${varName || t.name})`;
        }).join('\n');

        const btnFontToken = dictionary.allTokens.find(t => t.name === 'componentButtonBaseTypography');
        const btnFontFamily = btnFontToken ? (btnFontToken.$value || btnFontToken.value).split(',')[0].replace(/['"]/g, '').trim() : 'JetBrains Mono';
        const isBtnMono = btnFontFamily.toLowerCase().includes('mono');

        const tagFontToken = dictionary.allTokens.find(t => t.name === 'componentTagBaseTypography');
        const tagFontFamily = tagFontToken ? (tagFontToken.$value || tagFontToken.value).split(',')[0].replace(/['"]/g, '').trim() : 'JetBrains Mono';
        const isTagMono = tagFontFamily.toLowerCase().includes('mono');

        return `//
// StyleDictionary.swift
//
// Do not edit directly, this file was auto-generated.
//

import UIKit
#if canImport(SwiftUI)
import SwiftUI
#endif

public struct StyleDictionaryColor {
${colorLines}
}

public struct StyleDictionarySize {
${sizeLines}
}

public struct StyleDictionaryFont {
${fontLines}
}

#if canImport(SwiftUI)
public extension Color {
${swiftColorLines}
}

public extension Font {
    // Dynamic Font Family loaders (with system fallback)
    static func dsDisplay(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font.custom(StyleDictionaryFont.display, size: size).weight(weight)
    }
    static func dsBody(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font.custom(StyleDictionaryFont.body, size: size).weight(weight)
    }
    static func dsMono(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font.custom(StyleDictionaryFont.mono, size: size).monospaced().weight(weight)
    }

    // Pre-composed Component & Semantic Typography
    static let dsHeading1 = Font.custom(StyleDictionaryFont.display, size: 24).weight(.bold)
    static let dsHeading2 = Font.custom(StyleDictionaryFont.display, size: 18).weight(.bold)
    static let dsButton = Font.custom("${btnFontFamily}", size: StyleDictionarySize.componentButtonBaseFontSize)${isBtnMono ? '.monospaced()' : ''}.weight(.semibold)
    static let dsTag = Font.custom("${tagFontFamily}", size: StyleDictionarySize.componentTagBaseFontSize)${isTagMono ? '.monospaced()' : ''}.weight(.medium)
    static let dsBodySm = Font.custom(StyleDictionaryFont.body, size: StyleDictionarySize.typographyFontSizeSm)
    static let dsBodyXs = Font.custom(StyleDictionaryFont.body, size: StyleDictionarySize.typographyFontSizeXs)
    static let dsMonoSm = Font.custom(StyleDictionaryFont.mono, size: StyleDictionarySize.typographyFontSizeSm).monospaced().weight(.medium)
    static let dsMonoXs = Font.custom(StyleDictionaryFont.mono, size: StyleDictionarySize.typographyFontSizeXs).monospaced().weight(.bold)
}
#endif
`;
      }
    }
  },
  platforms: {
    // 1. Compile to CSS Variables in dist/css/
    css: {
      transformGroup: 'css',
      buildPath: 'dist/css/',
      files: [{
        destination: 'variables.css',
        format: 'css/variables',
        options: {
          outputReferences: true // Keeps the CSS variables linked instead of resolving them
        }
      }]
    },
    // 2. Compile to iOS Swift classes (Swift Package Manager convention)
    ios: {
      transformGroup: 'ios-swift-custom',
      buildPath: 'Sources/DesignSync/',
      files: [{
        destination: 'StyleDictionary.swift',
        format: 'ios-swift/extended'
      }]
    },
    // 3. Compile to clean JS / TS module tokens in dist/js/
    js: {
      transformGroup: 'js',
      buildPath: 'dist/js/',
      files: [
        {
          destination: 'tokens.js',
          format: 'javascript/es6'
        },
        {
          destination: 'tokens.d.ts',
          format: 'typescript/es6-declarations'
        }
      ]
    }
  }
};

