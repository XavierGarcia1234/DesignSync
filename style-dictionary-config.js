module.exports = {
  // Style Dictionary v4 natively supports DTCG standard format
  // It handles $value, $type, etc. automatically.
  source: ['tokens.json'],
  platforms: {
    // 1. Compile to CSS Variables for the web component library
    css: {
      transformGroup: 'css',
      buildPath: './',
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
        format: 'ios-swift/class.swift'
      }]
    },
    // 3. Compile to React Native / JS theme object
    js: {
      transformGroup: 'js',
      buildPath: 'build/js/',
      files: [{
        destination: 'tokens.js',
        format: 'javascript/module'
      }]
    }
  }
};
