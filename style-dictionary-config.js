module.exports = {
  // Style Dictionary v4 natively supports DTCG standard format
  source: ['tokens.json'],
  hooks: {
    formats: {
      'ios-swift/extended': ({ dictionary }) => {
        const colorTokens = dictionary.allTokens.filter(t => (t.$type || t.type) === 'color');
        const sizeTokens = dictionary.allTokens.filter(t => (t.$type || t.type) === 'dimension');

        const colorLines = colorTokens.map(t => {
          const varName = t.path.slice(1).map((part, idx) => idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join('');
          return `    public static let ${varName || t.name} = ${t.$value}`;
        }).join('\n');

        const sizeLines = sizeTokens.map(t => {
          const varName = t.path.map((part, idx) => idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join('');
          return `    public static let ${varName} = ${t.$value}`;
        }).join('\n');

        const swiftUILines = colorTokens.map(t => {
          const varName = t.path.slice(1).map((part, idx) => idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join('');
          const dsName = 'ds' + (varName.charAt(0).toUpperCase() + varName.slice(1));
          return `    static let ${dsName} = Color(StyleDictionaryColor.${varName || t.name})`;
        }).join('\n');

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

#if canImport(SwiftUI)
public extension Color {
${swiftUILines}
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
      transformGroup: 'ios-swift',
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

