#!/usr/bin/env bash
# ==============================================================================
# DesignSync — Xcode Build-Phase Token Compliance Linter
#
# Add this script to your Xcode target's "Build Phases" -> "New Run Script Phase"
# It emits native Xcode warnings / errors directly in the editor and Issue Navigator:
#   <file>:<line>: warning: <message>
# ==============================================================================

# Search root: Xcode provides $SRCROOT, otherwise defaults to current directory
SEARCH_DIR="${SRCROOT:-.}"

echo "Running DesignSync Token Audit on: $SEARCH_DIR"

VIOLATIONS=0

# Scan all Swift files (excluding Pods, DerivedData, .build, StyleDictionary.swift)
while IFS= read -r file; do
    # Skip auto-generated files or DesignSync's own token definition file
    if [[ "$file" == *"StyleDictionary.swift"* ]] || [[ "$file" == *".build/"* ]] || [[ "$file" == *"DerivedData/"* ]]; then
        continue
    fi

    # 1. Flag Hardcoded Hex / RGB / Hex-like Color literals
    grep -n -E 'Color\(hex:|Color\(red:|UIColor\(red:|#[0-9a-fA-F]{3,8}' "$file" | while IFS=: read -r line_num line_content; do
        echo "$file:$line_num: warning: [DesignSync] Hardcoded color found: '$line_content'. Use semantic 'Color.ds...' token instead."
    done

    # 2. Flag Primitive Radii used on Buttons
    grep -n -E '\.cornerRadius\((StyleDictionarySize\.)?dimensionRadius(Md|Sm|Pill|Full)' "$file" | while IFS=: read -r line_num line_content; do
        echo "$file:$line_num: warning: [DesignSync] Primitive radius used: '$line_content'. For buttons, use semantic 'StyleDictionarySize.componentButtonBaseRadius'."
    done

    # 3. Flag Primitive Accent colors on Buttons
    grep -n -E '\.background\((Color\.)?dsAccentBase\)' "$file" | while IFS=: read -r line_num line_content; do
        echo "$file:$line_num: warning: [DesignSync] Primitive accent color on button background. Use semantic 'Color.dsButtonFilledBackgroundDefault'."
    done

    # 4. Flag Hardcoded Numeric Corner Radii (e.g. .cornerRadius(8), .cornerRadius(4))
    grep -n -E '\.cornerRadius\([0-9]+(\.[0-9]+)?\)' "$file" | while IFS=: read -r line_num line_content; do
        echo "$file:$line_num: warning: [DesignSync] Hardcoded corner radius found: '$line_content'. Use a semantic token (e.g. 'StyleDictionarySize.componentButtonBaseRadius' or 'StyleDictionarySize.componentHudCardRadius')."
    done

done < <(find "$SEARCH_DIR" -name "*.swift" -type f)

echo "DesignSync Token Audit completed."
exit 0
