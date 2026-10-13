#!/usr/bin/env node
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema
} = require("@modelcontextprotocol/sdk/types.js");
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Automatically anchor working directory to the DesignSync project root
const PROJECT_ROOT = process.env.DESIGN_SYNC_ROOT || __dirname;
try {
  process.chdir(PROJECT_ROOT);
} catch (err) {
  console.error("Could not set working directory to", PROJECT_ROOT, err);
}

function resolveProjectPath(filePath) {
  if (!filePath) return PROJECT_ROOT;
  if (path.isAbsolute(filePath)) {
    if (filePath.startsWith(PROJECT_ROOT)) {
      return filePath;
    }
    // If passed with a leading slash like "/tokens.json", treat it as project-relative
    const stripped = filePath.replace(/^[/\\]+/, '');
    return path.resolve(PROJECT_ROOT, stripped);
  }
  return path.resolve(PROJECT_ROOT, filePath);
}

const runInProject = (cmd) => execPromise(cmd, { cwd: PROJECT_ROOT });

function inferTokenType(tokenPath, value) {
  const val = String(value || '').trim().toLowerCase();
  const p = (tokenPath || '').toLowerCase();
  if (val.startsWith('#') || val.startsWith('rgb') || val.startsWith('hsl') || val.includes('{color.')) {
    return 'color';
  }
  if (val.includes('{dimension.') || val.includes('{spacing.') || val.includes('{radius.') || /^\d+(\.\d+)?(px|rem|em|%|vh|vw)$/i.test(val)) {
    return 'dimension';
  }
  if (val.includes('{typography.') || val.includes('{font') || p.includes('font') || p.includes('typography')) {
    return 'typography';
  }
  if (p.includes('color') || p.includes('background') || p.includes('border') || p.includes('foreground') || p.includes('ink')) {
    return 'color';
  }
  if (p.includes('spacing') || p.includes('radius') || p.includes('size') || p.includes('padding') || p.includes('margin') || p.includes('width') || p.includes('height')) {
    return 'dimension';
  }
  if (p.includes('opacity')) {
    return 'number';
  }
  if (p.includes('duration') || val.endsWith('s') || val.endsWith('ms')) {
    return 'duration';
  }
  return 'string';
}

async function syncStyleCssPreview(tokenPath, newValue, lightValue) {
  try {
    const stylePath = resolveProjectPath('style.css');
    let css = await fs.readFile(stylePath, 'utf8');
    
    if (tokenPath === 'color.accent.base') {
      if (newValue) {
        css = css.replace(/(--accent:\s*)(#[a-fA-F0-9]+|[^\s;]+)(;)/, `$1${newValue}$3`);
      }
      if (lightValue) {
        css = css.replace(/(\[data-theme="light"\][\s\S]*?--accent:\s*)(#[a-fA-F0-9]+|[^\s;]+)(;)/, `$1${lightValue}$3`);
      }
    } else if (tokenPath === 'color.accent.hover') {
      if (newValue) {
        css = css.replace(/(--accent-hover:\s*)(#[a-fA-F0-9]+|[^\s;]+)(;)/, `$1${newValue}$3`);
      }
      if (lightValue) {
        css = css.replace(/(\[data-theme="light"\][\s\S]*?--accent-hover:\s*)(#[a-fA-F0-9]+|[^\s;]+)(;)/, `$1${lightValue}$3`);
      }
    } else if (tokenPath === 'color.accent.ink') {
      if (newValue) {
        css = css.replace(/(--accent-ink:\s*)(#[a-fA-F0-9]+|[^\s;]+)(;)/, `$1${newValue}$3`);
      }
      if (lightValue) {
        css = css.replace(/(\[data-theme="light"\][\s\S]*?--accent-ink:\s*)(#[a-fA-F0-9]+|[^\s;]+)(;)/, `$1${lightValue}$3`);
      }
    }
    
    await fs.writeFile(stylePath, css, 'utf8');
  } catch (_) {}
}

function getTokenCodeFormats(tokenPath, tokenType) {
  const parts = tokenPath.split('.');
  // Style Dictionary kebab-cases token paths: e.g. color.accent.base -> --color-accent-base
  const cssVar = '--' + parts.map(p => p.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()).join('-');
  // JS exports use PascalCase: e.g. ColorAccentBase
  const jsExport = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  
  const resolvedType = tokenType || inferTokenType(tokenPath, '');
  
  if (resolvedType === 'dimension') {
    const sizeVar = parts.map((part, idx) => idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join('');
    return {
      css: `var(${cssVar})`,
      cssVar: cssVar,
      js: jsExport,
      swift: `StyleDictionarySize.${sizeVar}`,
      swiftUI: `StyleDictionarySize.${sizeVar}`
    };
  } else if (resolvedType === 'fontFamily' || resolvedType === 'typography') {
    const fontName = parts[parts.length - 1];
    return {
      css: `var(${cssVar})`,
      cssVar: cssVar,
      js: jsExport,
      swift: `StyleDictionaryFont.${fontName}`,
      swiftUI: `Font.custom(StyleDictionaryFont.${fontName}, size: ...)`
    };
  } else {
    // Color or fallback
    const swiftPart = parts.slice(1).map((p, i) => i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1)).join('');
    const swiftVar = swiftPart ? `StyleDictionaryColor.${swiftPart}` : `StyleDictionaryColor.${parts[0]}`;
    const swiftUIVar = swiftPart ? `Color.ds${swiftPart.charAt(0).toUpperCase() + swiftPart.slice(1)}` : `Color.ds${parts[0]}`;

    return {
      css: `var(${cssVar})`,
      cssVar: cssVar,
      js: jsExport,
      swift: swiftVar,
      swiftUI: swiftUIVar
    };
  }
}

async function registerTokensInTokensJson(tokensInput) {
  if (!tokensInput) return { tokensAdded: [], buildOutput: "" };
  
  const tokensFile = resolveProjectPath('tokens.json');
  const rawJson = await fs.readFile(tokensFile, 'utf8');
  let tokensData = JSON.parse(rawJson);

  let tokenList = [];
  if (Array.isArray(tokensInput)) {
    tokenList = tokensInput;
  } else if (typeof tokensInput === 'object' && tokensInput !== null) {
    for (const [key, val] of Object.entries(tokensInput)) {
      if (typeof val === 'string' || typeof val === 'number') {
        tokenList.push({ path: key, value: String(val) });
      } else if (typeof val === 'object' && val !== null) {
        tokenList.push({
          path: val.path || key,
          value: val.$value !== undefined ? String(val.$value) : val.value !== undefined ? String(val.value) : undefined,
          lightValue: val.lightValue || (val.$extensions && val.$extensions.mode && val.$extensions.mode.light),
          type: val.$type || val.type,
          description: val.$description || val.description
        });
      }
    }
  }

  const addedSummaries = [];

  for (const item of tokenList) {
    if (!item.path || item.value === undefined) continue;
    const tokenPath = item.path;
    const value = String(item.value);
    const lightValue = item.lightValue;
    const tokenType = item.type || inferTokenType(tokenPath, value);
    const description = item.description;

    const keys = tokenPath.split('.');
    let current = tokensData;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (i === keys.length - 1) {
        if (!current[key] || typeof current[key] !== 'object') {
          current[key] = {};
        }
        current[key].$type = tokenType;
        current[key].$value = value;
        if (lightValue !== undefined) {
          if (!current[key].$extensions) current[key].$extensions = {};
          if (!current[key].$extensions.mode) current[key].$extensions.mode = {};
          current[key].$extensions.mode.light = lightValue;
        }
        if (description) {
          current[key].$description = description;
        }
      } else {
        if (!current[key] || typeof current[key] !== 'object') {
          current[key] = {};
        }
        current = current[key];
      }
    }

    const codeFmt = getTokenCodeFormats(tokenPath, tokenType);
    addedSummaries.push({
      path: tokenPath,
      type: tokenType,
      value,
      lightValue,
      description,
      codeFmt
    });
  }

  if (addedSummaries.length > 0) {
    await fs.writeFile(tokensFile, JSON.stringify(tokensData, null, 2), 'utf8');
    const { stdout } = await runInProject('npx style-dictionary build -c style-dictionary-config.js');
    return { tokensAdded: addedSummaries, buildOutput: stdout };
  }

  return { tokensAdded: [], buildOutput: "" };
}

const server = new Server(
  { name: "design-sync", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Define the available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_file",
        description: "Read the current state of a token JSON or component HTML/CSS file.",
        inputSchema: {
          type: "object",
          properties: {
            filepath: { type: "string", description: "Relative path to the file (e.g., 'tokens.json', 'style.css', 'components.html')" }
          },
          required: ["filepath"]
        }
      },
      {
        name: "write_file",
        description: "Write or update content in a project file (such as style.css, components.html, or tokens.json). Useful when styling components with design tokens or applying layout changes.",
        inputSchema: {
          type: "object",
          properties: {
            filepath: { type: "string", description: "Relative path to the file (e.g., 'style.css')" },
            content: { type: "string", description: "Full content to write to the file" }
          },
          required: ["filepath", "content"]
        }
      },
      {
        name: "add_token",
        description: "Add a brand new design token to tokens.json (DTCG standard format). Supports specifying default/dark mode value as well as an optional light mode value ($extensions.mode.light). Automatically compiles tokens to CSS variables, Swift, and JS/TS.",
        inputSchema: {
          type: "object",
          properties: {
            tokenPath: { type: "string", description: "Dot-notation path for the new token (e.g., 'component.button.filled.border' or 'color.brand.primary')" },
            value: { type: "string", description: "Token value or reference alias (e.g., '{color.ink.primary}', '#bff549', '1px', '{dimension.spacing.button}')" },
            lightValue: { type: "string", description: "Optional matching value for light mode ($extensions.mode.light)" },
            type: { type: "string", description: "Optional DTCG token type ('color', 'dimension', 'typography', 'number', 'duration', etc.). If omitted, automatically inferred." },
            description: { type: "string", description: "Optional description explaining how or where this token is used." }
          },
          required: ["tokenPath", "value"]
        }
      },
      {
        name: "update_token",
        description: "Modify a design token's value across themes. Supports updating default/dark mode ($value) as well as light mode ($extensions.mode.light). When changing brand or theme colors, you can ask the designer if they'd like to update both dark and light modes, and update both together using 'newValue' and 'lightValue', or specify 'mode' ('dark', 'light', or 'both'). Automatically rebuilds all compiled token files.",
        inputSchema: {
          type: "object",
          properties: {
            tokenPath: { type: "string", description: "Dot-notation path to the token (e.g., 'color.accent.base' or 'component.button.filled.border')" },
            newValue: { type: "string", description: "The new value for the token (default / dark mode, or both if mode='both')" },
            lightValue: { type: "string", description: "Optional matching value for light mode ($extensions.mode.light)" },
            mode: { type: "string", description: "Optional mode to update: 'dark', 'light', or 'both' (default is 'both' if lightValue is provided, otherwise 'dark')" },
            newType: { type: "string", description: "Optional new DTCG token type (e.g., 'color', 'dimension')" },
            description: { type: "string", description: "Optional updated description for the token" }
          },
          required: ["tokenPath", "newValue"]
        }
      },
      {
        name: "remove_token",
        description: "Delete an existing design token from tokens.json by its dot-notation path. Automatically rebuilds all compiled token files.",
        inputSchema: {
          type: "object",
          properties: {
            tokenPath: { type: "string", description: "Dot-notation path to the token to remove (e.g., 'component.button.filled.border')" }
          },
          required: ["tokenPath"]
        }
      },
      {
        name: "list_tokens",
        description: "List or search design tokens in tokens.json. Filter by category prefix (e.g., 'component.button', 'color', 'typography') or keyword.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Optional filter or search term (e.g., 'button', 'color', 'spacing')" }
          }
        }
      },
      {
        name: "get_compiled_tokens",
        description: "Get the exact code variable names and syntax generated by Style Dictionary for any token (e.g. '--color-accent-base' or 'StyleDictionaryColor.accentBase'), or view the compiled variables.css / tokens.js files. Use this whenever asked what CSS variable or code name a token maps to.",
        inputSchema: {
          type: "object",
          properties: {
            tokenPath: { type: "string", description: "Optional specific token path to look up (e.g., 'color.accent.base' or 'component.button.filled.border')" },
            format: { type: "string", description: "Optional format to view full compiled file: 'css', 'js', 'swift', or 'all'" }
          }
        }
      },
      {
        name: "build_tokens",
        description: "Runs Style Dictionary to compile the tokens.json file into CSS variables, Swift, and React/JS formats.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "sync_latest_tokens",
        description: "Pull the latest design tokens and component styles from git to ensure you are designing with the newest updates.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "commit_to_git",
        description: "Stage, branch, and commit design changes to git. If on main/master, automatically creates a dedicated review branch so designers don't have to name or manage branches manually.",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "Commit message describing the design changes (e.g., 'Update button border and primary color')" },
            branch: { type: "string", description: "Optional custom branch name. If omitted, a branch is automatically generated from the message (e.g., 'tokens/update-button-border-1011')" }
          },
          required: ["message"]
        }
      },
      {
        name: "audit_tokens",
        description: "Audit client codebases (Swift/iOS, React/TS, CSS) for design token compliance. Scans for hardcoded values (colors, font sizes, corner radii) and checks for primitive-vs-semantic token anti-patterns (e.g. using primitive 'dimensionRadiusMd' instead of 'componentButtonBaseRadius'). Can run in audit-only or auto-fix mode.",
        inputSchema: {
          type: "object",
          properties: {
            targetPath: { type: "string", description: "Path to the consumer project directory or file to audit (e.g. '../DesignSyncShowcase' or absolute path)" },
            autoFix: { type: "boolean", description: "If true, automatically updates source files with recommended semantic tokens (default: false)" }
          },
          required: ["targetPath"]
        }
      },
      {
        name: "list_components",
        description: "List all prebuilt design system components (e.g. DSButton, DSCard, DSTag, DSHudCard) available for developers in the Swift package.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "add_component",
        description: "Export a brand new prebuilt component (e.g. 'DSAvatar', 'DSBadge', 'DSHeader') to the design system Swift package. CRITICAL: tokens.json is the single source of truth. If the component or feature introduces any new design tokens (such as colors, dimensions, radii, padding, spacing, or typography styles), provide them in 'tokens'. The tool will automatically log and register them into tokens.json (DTCG format), compile them to CSS variables, JS tokens, and iOS Swift (StyleDictionary.swift), write the SwiftUI component to Sources/DesignSync/Components/<name>.swift referencing the compiled tokens, and validate that 'swift build' compiles with zero errors.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Component name in PascalCase (e.g., 'DSAvatar', 'DSBadge', 'DSHeader')" },
            code: { type: "string", description: "Complete SwiftUI component code" },
            description: { type: "string", description: "Optional description of the component purpose, parameters, and design intent" },
            tokens: {
              type: "array",
              description: "Optional list of new design tokens to register in tokens.json (DTCG standard) for this component. Each item specifies: path (e.g. 'component.badge.background.default'), value (e.g. '#6366f1' or alias '{color.accent.base}'), lightValue (optional), type ('color', 'dimension', 'typography', etc.), and description.",
              items: {
                type: "object",
                properties: {
                  path: { type: "string", description: "Dot-notation token path (e.g. 'component.badge.radius' or 'component.badge.background.default')" },
                  value: { type: "string", description: "Default or dark mode token value or alias" },
                  lightValue: { type: "string", description: "Optional light mode value ($extensions.mode.light)" },
                  type: { type: "string", description: "DTCG token type ('color', 'dimension', 'typography', 'fontFamily', etc.)" },
                  description: { type: "string", description: "Description for documentation" }
                },
                required: ["path", "value"]
              }
            }
          },
          required: ["name", "code"]
        }
      },
      {
        name: "update_component",
        description: "Update an existing prebuilt SwiftUI component in the design system. Can also add or update tokens in tokens.json if the component updates require new colors, radii, or type styles. Validates the Swift package compiles cleanly.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Component name (e.g., 'DSButton', 'DSCard')" },
            code: { type: "string", description: "Updated SwiftUI component code" },
            tokens: {
              type: "array",
              description: "Optional new or updated design tokens to sync into tokens.json for this component."
            }
          },
          required: ["name", "code"]
        }
      },
      {
        name: "remove_component",
        description: "Remove a prebuilt component from the design system package.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Component name to delete (e.g., 'DSAvatar')" }
          },
          required: ["name"]
        }
      }
    ]
  };
});

// Implement the tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "read_file": {
        const { filepath } = request.params.arguments;
        const fullPath = resolveProjectPath(filepath);
        const content = await fs.readFile(fullPath, 'utf8');
        return { content: [{ type: "text", text: content }] };
      }

      case "write_file": {
        const { filepath, content } = request.params.arguments;
        const fullPath = resolveProjectPath(filepath);
        await fs.writeFile(fullPath, content, 'utf8');
        return { 
          content: [{ 
            type: "text", 
            text: `Successfully wrote ${content.length} characters to '${filepath}'.` 
          }] 
        };
      }

      case "add_token": {
        const { tokenPath, value, lightValue, type, description } = request.params.arguments;
        const tokensFile = resolveProjectPath('tokens.json');
        
        const rawJson = await fs.readFile(tokensFile, 'utf8');
        let tokens = JSON.parse(rawJson);
        
        const tokenType = type || inferTokenType(tokenPath, value);
        
        const keys = tokenPath.split('.');
        let current = tokens;
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          if (i === keys.length - 1) {
            if (!current[key] || typeof current[key] !== 'object') {
              current[key] = {};
            }
            current[key].$type = tokenType;
            current[key].$value = value;
            if (lightValue !== undefined) {
              if (!current[key].$extensions) current[key].$extensions = {};
              if (!current[key].$extensions.mode) current[key].$extensions.mode = {};
              current[key].$extensions.mode.light = lightValue;
            }
            if (description) {
              current[key].$description = description;
            }
          } else {
            if (!current[key] || typeof current[key] !== 'object') {
              current[key] = {};
            }
            current = current[key];
          }
        }
        
        await fs.writeFile(tokensFile, JSON.stringify(tokens, null, 2));
        const { stdout } = await runInProject('npx style-dictionary build -c style-dictionary-config.js');
        await syncStyleCssPreview(tokenPath, value, lightValue);
        
        const codeFmt = getTokenCodeFormats(tokenPath, tokenType);
        return { 
          content: [{ 
            type: "text", 
            text: `Successfully added token '${tokenPath}' ($type: "${tokenType}", $value: "${value}"${lightValue ? `, light: "${lightValue}"` : ''})${description ? ` - "${description}"` : ''}.\n\nCode mappings for developers:\n• CSS Variable: var(${codeFmt.cssVar}) (dist/css/variables.css)\n• iOS Swift: ${codeFmt.swift} / ${codeFmt.swiftUI}\n• React / JS: ${codeFmt.js}\n\nStyle Dictionary Build Output:\n${stdout}` 
          }] 
        };
      }

      case "update_token": {
        const { tokenPath, newValue, lightValue, mode, newType, description } = request.params.arguments;
        const tokensFile = resolveProjectPath('tokens.json');
        
        // 1. Read and parse the current DTCG JSON
        const rawJson = await fs.readFile(tokensFile, 'utf8');
        let tokens = JSON.parse(rawJson);
        
        // 2. Traverse the object using the dot-notation path
        const keys = tokenPath.split('.');
        let current = tokens;
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          if (i === keys.length - 1) {
            if (!current[key] || typeof current[key] !== 'object') {
              current[key] = { $type: newType || inferTokenType(tokenPath, newValue) };
            }
            if (newType) current[key].$type = newType;
            if (description !== undefined) current[key].$description = description;

            if (mode === 'light') {
              if (!current[key].$extensions) current[key].$extensions = {};
              if (!current[key].$extensions.mode) current[key].$extensions.mode = {};
              current[key].$extensions.mode.light = newValue;
            } else {
              current[key].$value = newValue;
              if (lightValue !== undefined) {
                if (!current[key].$extensions) current[key].$extensions = {};
                if (!current[key].$extensions.mode) current[key].$extensions.mode = {};
                current[key].$extensions.mode.light = lightValue;
              } else if (mode === 'both') {
                if (!current[key].$extensions) current[key].$extensions = {};
                if (!current[key].$extensions.mode) current[key].$extensions.mode = {};
                current[key].$extensions.mode.light = newValue;
              }
            }
          } else {
            if (!current[key] || typeof current[key] !== 'object') {
              current[key] = {};
            }
            current = current[key];
          }
        }
        
        // 3. Save the JSON back to disk
        await fs.writeFile(tokensFile, JSON.stringify(tokens, null, 2));
        
        // 4. Automatically run Style Dictionary to rebuild the CSS/Swift/JS files
        const { stdout } = await runInProject('npx style-dictionary build -c style-dictionary-config.js');
        
        // 5. Sync live showcase stylesheet
        await syncStyleCssPreview(tokenPath, newValue, lightValue || (mode === 'both' ? newValue : null));

        const updatedThemes = [];
        if (mode === 'light') {
          updatedThemes.push(`Light Mode: ${newValue}`);
        } else {
          updatedThemes.push(`Dark / Base: ${newValue}`);
          if (lightValue !== undefined) {
            updatedThemes.push(`Light Mode: ${lightValue}`);
          } else if (mode === 'both') {
            updatedThemes.push(`Light Mode: ${newValue}`);
          }
        }

        const codeFmt = getTokenCodeFormats(tokenPath, newType);
        return { 
          content: [{ 
            type: "text", 
            text: `Successfully updated token '${tokenPath}' (${updatedThemes.join(', ')}).\n\nCode mappings for developers:\n• CSS Variable: var(${codeFmt.cssVar}) (dist/css/variables.css)\n• iOS Swift: ${codeFmt.swift} / ${codeFmt.swiftUI}\n• React / JS: ${codeFmt.js}\n\nStyle Dictionary Build Output:\n${stdout}` 
          }] 
        };
      }

      case "remove_token": {
        const { tokenPath } = request.params.arguments;
        const tokensFile = resolveProjectPath('tokens.json');
        
        const rawJson = await fs.readFile(tokensFile, 'utf8');
        let tokens = JSON.parse(rawJson);
        
        const keys = tokenPath.split('.');
        let current = tokens;
        const stack = [];
        for (let i = 0; i < keys.length - 1; i++) {
          if (!current[keys[i]]) {
            return { content: [{ type: "text", text: `Token path '${tokenPath}' not found.` }], isError: true };
          }
          stack.push({ obj: current, key: keys[i] });
          current = current[keys[i]];
        }

        const lastKey = keys[keys.length - 1];
        if (current[lastKey] === undefined) {
          return { content: [{ type: "text", text: `Token '${tokenPath}' not found.` }], isError: true };
        }

        delete current[lastKey];

        // Clean up empty parent objects
        for (let i = stack.length - 1; i >= 0; i--) {
          const { obj, key } = stack[i];
          if (obj[key] && typeof obj[key] === 'object' && Object.keys(obj[key]).length === 0) {
            delete obj[key];
          }
        }

        await fs.writeFile(tokensFile, JSON.stringify(tokens, null, 2));
        const { stdout } = await runInProject('npx style-dictionary build -c style-dictionary-config.js');

        return {
          content: [{
            type: "text",
            text: `Successfully removed token '${tokenPath}'.\n\nStyle Dictionary Build Output:\n${stdout}`
          }]
        };
      }

      case "list_tokens": {
        const { query } = request.params.arguments || {};
        const tokensFile = resolveProjectPath('tokens.json');
        const rawJson = await fs.readFile(tokensFile, 'utf8');
        const tokens = JSON.parse(rawJson);
        
        const flatTokens = [];
        function extractTokens(obj, currentPath = []) {
          for (const [key, val] of Object.entries(obj)) {
            if (key.startsWith('$')) continue;
            const newPath = [...currentPath, key];
            if (val && typeof val === 'object') {
              if (val.$value !== undefined || val.value !== undefined) {
                flatTokens.push({
                  path: newPath.join('.'),
                  type: val.$type || val.type || 'unknown',
                  value: val.$value || val.value,
                  description: val.$description || val.description || ''
                });
              }
              extractTokens(val, newPath);
            }
          }
        }
        extractTokens(tokens);

        let filtered = flatTokens;
        if (query) {
          const q = query.toLowerCase();
          filtered = flatTokens.filter(t => 
            t.path.toLowerCase().includes(q) || 
            String(t.value).toLowerCase().includes(q) || 
            t.type.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q)
          );
        }

        const output = filtered.map(t => `• ${t.path} (${t.type}): ${t.value}${t.description ? ` — "${t.description}"` : ''}`).join('\n');
        return {
          content: [{
            type: "text",
            text: `Found ${filtered.length} token(s)${query ? ` matching '${query}'` : ''}:\n\n${output || 'No matching tokens found.'}`
          }]
        };
      }

      case "build_tokens": {
        const { stdout } = await runInProject('npx style-dictionary build -c style-dictionary-config.js');
        return { content: [{ type: "text", text: `Build successful:\n${stdout}` }] };
      }

      case "sync_latest_tokens": {
        // 1. Pull latest commits from git
        let pullOutput = "";
        try {
          const { stdout } = await runInProject('git pull');
          pullOutput = stdout;
        } catch (err) {
          pullOutput = `Warning: git pull could not complete (${err.message}). Using local files.`;
        }

        // 2. Re-compile Style Dictionary to ensure all build artifacts are up to date
        const { stdout: buildOut } = await runInProject('npx style-dictionary build -c style-dictionary-config.js');
        return { 
          content: [{ 
            type: "text", 
            text: `Synced latest design system:\n${pullOutput}\n\nRebuilt Tokens:\n${buildOut}` 
          }] 
        };
      }

      case "commit_to_git": {
        const { message, branch } = request.params.arguments;
        
        // 1. Check current branch
        let currentBranch = "main";
        try {
          const { stdout } = await runInProject('git rev-parse --abbrev-ref HEAD');
          currentBranch = stdout.trim();
        } catch (_) {}

        let targetBranch = branch;
        let createdBranch = false;

        // 2. Automated branch naming: If on main/master and no branch specified, auto-generate one
        if (!targetBranch) {
          if (currentBranch === "main" || currentBranch === "master") {
            const slug = (message || "token-update")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 30);
            const dateSuffix = new Date().toISOString().slice(2, 10).replace(/-/g, '');
            targetBranch = `tokens/${slug || 'update'}-${dateSuffix}`;
          } else {
            targetBranch = currentBranch;
          }
        }

        // 3. Switch to the target branch if needed
        if (targetBranch !== currentBranch) {
          try {
            await runInProject(`git checkout -b ${targetBranch}`);
            createdBranch = true;
          } catch (branchErr) {
            // If branch already exists, switch to it
            await runInProject(`git checkout ${targetBranch}`);
          }
        }

        // 4. Stage and commit
        await runInProject('git add .');
        const { stdout: commitOut } = await runInProject(`git commit -m "${message}"`);
        
        // 5. Attempt git push to remote
        let pushStatus = "";
        try {
          const { stdout: pushOut, stderr: pushErr } = await runInProject(`git push -u origin ${targetBranch}`);
          pushStatus = `\n\nPushed to remote branch '${targetBranch}'. Ready for Pull Request review!\n${pushOut || pushErr}`;
        } catch (pushErr) {
          pushStatus = `\n\nChanges safely committed to local branch '${targetBranch}'. (Run 'git push origin ${targetBranch}' when connected to remote).`;
        }

        return { 
          content: [{ 
            type: "text", 
            text: `Successfully committed design changes to branch '${targetBranch}':\n${commitOut}${pushStatus}` 
          }] 
        };
      }

      case "get_compiled_tokens": {
        const { tokenPath, format } = request.params.arguments || {};
        
        if (tokenPath) {
          const formats = getTokenCodeFormats(tokenPath);
          return {
            content: [{
              type: "text",
              text: `Compiled code mappings for token '${tokenPath}':\n` +
                    `• Web / CSS: var(${formats.cssVar}) (defined in dist/css/variables.css)\n` +
                    `• iOS (Swift): ${formats.swift} (defined in Sources/DesignSync/StyleDictionary.swift)\n` +
                    `• SwiftUI: ${formats.swiftUI}\n` +
                    `• React / JS: ${formats.js} (exported in dist/js/tokens.js)`
            }]
          };
        }

        let textResult = "";
        const targetFormat = (format || 'css').toLowerCase();
        if (targetFormat === 'css' || targetFormat === 'all') {
          try {
            const cssContent = await fs.readFile(resolveProjectPath('dist/css/variables.css'), 'utf8');
            textResult += `=== dist/css/variables.css ===\n${cssContent}\n\n`;
          } catch (_) {}
        }
        if (targetFormat === 'js' || targetFormat === 'all') {
          try {
            const jsContent = await fs.readFile(resolveProjectPath('dist/js/tokens.js'), 'utf8');
            textResult += `=== dist/js/tokens.js ===\n${jsContent}\n\n`;
          } catch (_) {}
        }
        if (targetFormat === 'swift' || targetFormat === 'all') {
          try {
            const swiftContent = await fs.readFile(resolveProjectPath('Sources/DesignSync/StyleDictionary.swift'), 'utf8');
            textResult += `=== Sources/DesignSync/StyleDictionary.swift ===\n${swiftContent}\n\n`;
          } catch (_) {}
        }

        return {
          content: [{
            type: "text",
            text: textResult || "No compiled artifacts found. Run 'build_tokens' first."
          }]
        };
      }

      case "audit_tokens": {
        const { targetPath, autoFix = false } = request.params.arguments || {};
        if (!targetPath) {
          throw new Error("Missing required argument 'targetPath'");
        }

        let resolvedScanPath = targetPath;
        if (!path.isAbsolute(targetPath)) {
          resolvedScanPath = path.resolve(PROJECT_ROOT, targetPath);
        }

        // Recursively find files (.swift, .tsx, .jsx, .html, .css)
        async function getFiles(dir) {
          const dirents = await fs.readdir(dir, { withFileTypes: true });
          const files = await Promise.all(dirents.map((dirent) => {
            const res = path.resolve(dir, dirent.name);
            if (dirent.isDirectory()) {
              if (['.git', 'node_modules', 'DerivedData', '.build', 'Pods'].includes(dirent.name)) return [];
              return getFiles(res);
            }
            return res;
          }));
          return files.flat();
        }

        let targetFiles = [];
        try {
          const stat = await fs.stat(resolvedScanPath);
          if (stat.isDirectory()) {
            targetFiles = await getFiles(resolvedScanPath);
          } else {
            targetFiles = [resolvedScanPath];
          }
        } catch (e) {
          throw new Error(`Cannot access target path '${resolvedScanPath}': ${e.message}`);
        }

        // Filter relevant source files, excluding the DesignSync package itself
        targetFiles = targetFiles.filter(f => 
          (f.endsWith('.swift') || f.endsWith('.tsx') || f.endsWith('.jsx') || f.endsWith('.css') || f.endsWith('.html')) &&
          !f.includes('StyleDictionary.swift')
        );

        if (targetFiles.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No Swift, TSX, CSS, or HTML files found in '${resolvedScanPath}' to audit.`
            }]
          };
        }

        const violations = [];
        let totalFilesScanned = 0;
        let filesFixed = 0;

        // Rules to audit
        const rules = [
          {
            id: 'hardcoded-color-hex',
            desc: 'Hardcoded Hex Color literal',
            regex: /#([0-9a-fA-F]{3,8})\b/g,
            severity: 'error',
            fixSuggestion: 'Use semantic token Color.ds... or var(--color-...)'
          },
          {
            id: 'hardcoded-color-swiftui',
            desc: 'Hardcoded SwiftUI Color constructor',
            regex: /Color\((red|hex):\s*[^)]+\)/g,
            severity: 'error',
            fixSuggestion: 'Use semantic token Color.ds...'
          },
          {
            id: 'primitive-radius-button',
            desc: 'Primitive radius used on Button (breaks zero-effort theme syncing)',
            regex: /\.cornerRadius\(\s*(StyleDictionarySize\.)?dimensionRadius(Md|Sm|Pill|Full)\s*\)/g,
            severity: 'warning',
            fixReplacement: '.cornerRadius(StyleDictionarySize.componentButtonBaseRadius)',
            fixSuggestion: 'StyleDictionarySize.componentButtonBaseRadius'
          },
          {
            id: 'primitive-accent-button-bg',
            desc: 'Primitive accent color used on Button background',
            regex: /\.background\(\s*(Color\.)?dsAccentBase\s*\)/g,
            severity: 'warning',
            fixReplacement: '.background(Color.dsButtonFilledBackgroundDefault)',
            fixSuggestion: 'Color.dsButtonFilledBackgroundDefault'
          },
          {
            id: 'hardcoded-numeric-radius',
            desc: 'Hardcoded numeric corner radius',
            regex: /\.cornerRadius\(\s*([0-9]+(\.[0-9]+)?)\s*\)/g,
            severity: 'warning',
            fixSuggestion: 'StyleDictionarySize.componentButtonBaseRadius or StyleDictionarySize.componentHudCardRadius'
          }
        ];

        for (const filePath of targetFiles) {
          totalFilesScanned++;
          let content = await fs.readFile(filePath, 'utf8');
          const lines = content.split('\n');
          let fileHasFixes = false;

          lines.forEach((line, lineIdx) => {
            // Skip comments
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

            rules.forEach(rule => {
              rule.regex.lastIndex = 0;
              let match;
              while ((match = rule.regex.exec(line)) !== null) {
                violations.push({
                  file: path.relative(resolvedScanPath, filePath) || path.basename(filePath),
                  line: lineIdx + 1,
                  matched: match[0],
                  ruleId: rule.id,
                  desc: rule.desc,
                  severity: rule.severity,
                  suggestion: rule.fixSuggestion
                });
              }
            });
          });

          if (autoFix) {
            let updatedContent = content;
            rules.filter(r => r.fixReplacement).forEach(rule => {
              rule.regex.lastIndex = 0;
              if (rule.regex.test(updatedContent)) {
                updatedContent = updatedContent.replace(rule.regex, rule.fixReplacement);
                fileHasFixes = true;
              }
            });

            if (fileHasFixes && updatedContent !== content) {
              await fs.writeFile(filePath, updatedContent, 'utf8');
              filesFixed++;
            }
          }
        }

        const score = Math.max(0, 100 - (violations.length * 5));
        let report = `═══════════════════════════════════════════════════════\n`;
        report += `🔍 DesignSync Token Compliance Audit Report\n`;
        report += `═══════════════════════════════════════════════════════\n`;
        report += `• Target: ${resolvedScanPath}\n`;
        report += `• Files Scanned: ${totalFilesScanned}\n`;
        report += `• Violations Detected: ${violations.length}\n`;
        report += `• Compliance Score: ${score}% ${score >= 90 ? '🟢' : score >= 70 ? '🟡' : '🔴'}\n\n`;

        if (violations.length === 0) {
          report += `✅ All scanned files are 100% compliant with design system tokens!\n`;
        } else {
          report += `📋 Violations Breakdown:\n`;
          violations.forEach((v, idx) => {
            const icon = v.severity === 'error' ? '❌' : '⚠️';
            report += `${idx + 1}. ${icon} [${v.severity.toUpperCase()}] ${v.file}:${v.line}\n`;
            report += `   Code: \`${v.matched}\`\n`;
            report += `   Issue: ${v.desc}\n`;
            report += `   Recommendation: ${v.suggestion}\n\n`;
          });
        }

        if (autoFix) {
          report += `✨ Auto-Fix Applied: Successfully refactored ${filesFixed} file(s) with recommended semantic tokens.\n`;
        } else if (violations.some(v => rules.find(r => r.id === v.ruleId && r.fixReplacement))) {
          report += `💡 Tip: Run 'audit_tokens' with { "autoFix": true } to automatically migrate primitive anti-patterns to semantic tokens.\n`;
        }

        return {
          content: [{
            type: "text",
            text: report
          }]
        };
      }

      case "list_components": {
        const compDir = resolveProjectPath('Sources/DesignSync/Components');
        let files = [];
        try {
          files = await fs.readdir(compDir);
        } catch (_) {
          return {
            content: [{ type: "text", text: "No components directory found." }]
          };
        }

        const swiftFiles = files.filter(f => f.endsWith('.swift'));
        if (swiftFiles.length === 0) {
          return {
            content: [{ type: "text", text: "No prebuilt components found in the library." }]
          };
        }

        let summary = "📦 Prebuilt Design System Components (SwiftUI / iOS):\n\n";
        for (const file of swiftFiles) {
          const compName = file.replace('.swift', '');
          const filePath = path.join(compDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.split('\n');
          const docLine = lines.find(l => l.includes('public struct ' + compName)) || `public struct ${compName}`;
          summary += `• ${compName} (${file})\n  Definition: ${docLine.trim()}\n\n`;
        }

        return {
          content: [{ type: "text", text: summary }]
        };
      }

      case "add_component":
      case "update_component": {
        const { name, code, description, tokens } = request.params.arguments || {};
        if (!name || !code) {
          throw new Error("Missing 'name' or 'code' parameter.");
        }

        const cleanName = name.replace(/[^a-zA-Z0-9_]/g, '');

        // 1. If tokens are provided, register them in tokens.json FIRST and recompile Style Dictionary!
        let tokenSyncReport = "";
        if (tokens) {
          try {
            const { tokensAdded, buildOutput } = await registerTokensInTokensJson(tokens);
            if (tokensAdded.length > 0) {
              tokenSyncReport = `\n📋 Design Tokens Registered in tokens.json (Single Source of Truth):\n`;
              for (const t of tokensAdded) {
                tokenSyncReport += `• ${t.path} (${t.type}): ${t.value}${t.lightValue ? ` [Light: ${t.lightValue}]` : ''}\n`;
                tokenSyncReport += `  Swift Accessor: ${t.codeFmt.swiftUI}\n`;
                tokenSyncReport += `  CSS Variable:   var(${t.codeFmt.cssVar})\n`;
                tokenSyncReport += `  JS Module:      ${t.codeFmt.js}\n`;
              }
              tokenSyncReport += `\nStyle Dictionary compilation completed across CSS, JS, and Swift.\n`;
            }
          } catch (tokErr) {
            return {
              content: [{
                type: "text",
                text: `❌ Error logging component tokens to tokens.json: ${tokErr.message}`
              }],
              isError: true
            };
          }
        }

        // 2. Write the component Swift source code
        const compDir = resolveProjectPath('Sources/DesignSync/Components');
        await fs.mkdir(compDir, { recursive: true });
        const filePath = path.join(compDir, `${cleanName}.swift`);

        await fs.writeFile(filePath, code, 'utf8');

        // 3. Validate compilation with swift build
        let buildError = null;
        try {
          await runInProject('swift build');
        } catch (err) {
          buildError = err.stderr || err.message;
        }

        if (buildError) {
          return {
            content: [{
              type: "text",
              text: `⚠️ Component '${cleanName}' was written to Sources/DesignSync/Components/${cleanName}.swift, but 'swift build' reported compiler errors:\n${buildError}\n${tokenSyncReport}\nPlease check component syntax and token references.`
            }],
            isError: true
          };
        }

        return {
          content: [{
            type: "text",
            text: `✅ Successfully saved and verified prebuilt component '${cleanName}' at Sources/DesignSync/Components/${cleanName}.swift!\n\nThe Swift package builds cleanly with zero errors.${tokenSyncReport}`
          }]
        };
      }

      case "remove_component": {
        const { name } = request.params.arguments || {};
        if (!name) throw new Error("Missing 'name' parameter.");
        const cleanName = name.replace(/[^a-zA-Z0-9_]/g, '');
        const filePath = resolveProjectPath(`Sources/DesignSync/Components/${cleanName}.swift`);
        try {
          await fs.unlink(filePath);
          await runInProject('swift build');
          return {
            content: [{
              type: "text",
              text: `Successfully removed component '${cleanName}' from Sources/DesignSync/Components.`
            }]
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error removing component: ${err.message}` }],
            isError: true
          };
        }
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error executing tool: ${error.message}` }],
      isError: true
    };
  }
});

// Start the server using STDIO
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Design System MCP Server running on STDIO");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
