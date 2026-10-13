import PackagePlugin
import Foundation

@main
struct TokenLinterPlugin: CommandPlugin {
    func performCommand(context: PluginContext, arguments: [String]) throws {
        print("═══════════════════════════════════════════════════════")
        print("🔍 DesignSync Token Compliance Audit (SPM Plugin)")
        print("═══════════════════════════════════════════════════════")
        
        let fileManager = FileManager.default
        let rootURL = URL(fileURLWithPath: context.package.directory.string)
        
        guard let enumerator = fileManager.enumerator(at: rootURL, includingPropertiesForKeys: [.isRegularFileKey]) else {
            print("Unable to scan files.")
            return
        }
        
        var violations = 0
        while let fileURL = enumerator.nextObject() as? URL {
            guard fileURL.pathExtension == "swift",
                  !fileURL.path.contains("StyleDictionary.swift"),
                  !fileURL.path.contains(".build"),
                  !fileURL.path.contains("DerivedData") else {
                continue
            }
            
            let content = (try? String(contentsOf: fileURL, encoding: .utf8)) ?? ""
            let lines = content.components(separatedBy: .newlines)
            
            for (idx, line) in lines.enumerated() {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("//") || trimmed.hasPrefix("/*") { continue }
                
                let lineNum = idx + 1
                let fileName = fileURL.lastPathComponent
                
                // 1. Primitive radius check
                if line.range(of: #"\.cornerRadius\(.*dimensionRadius(Md|Sm|Pill|Full)"#, options: .regularExpression) != nil {
                    print("⚠️ [WARNING] \(fileName):\(lineNum): Primitive radius used. Use 'StyleDictionarySize.componentButtonBaseRadius'.")
                    violations += 1
                }
                
                // 2. Primitive accent on button
                if line.range(of: #"\.background\(.*dsAccentBase"#, options: .regularExpression) != nil {
                    print("⚠️ [WARNING] \(fileName):\(lineNum): Primitive accent on button background. Use 'Color.dsButtonFilledBackgroundDefault'.")
                    violations += 1
                }
                
                // 3. Hardcoded corner radius
                if line.range(of: #"\.cornerRadius\([0-9]+"#, options: .regularExpression) != nil {
                    print("⚠️ [WARNING] \(fileName):\(lineNum): Hardcoded numeric corner radius. Use semantic 'componentButtonBaseRadius' or 'componentHudCardRadius'.")
                    violations += 1
                }
            }
        }
        
        if violations == 0 {
            print("✅ 100% Token Compliant! No design token violations found.")
        } else {
            print("\n📋 Audit completed with \(violations) violation(s).")
        }
    }
}
