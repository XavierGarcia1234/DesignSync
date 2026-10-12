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

function getTokenCodeFormats(tokenPath) {
  const parts = tokenPath.split('.');
  // Style Dictionary kebab-cases token paths: e.g. color.accent.base -> --color-accent-base
  const cssVar = '--' + parts.map(p => p.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()).join('-');
  // JS exports use PascalCase: e.g. ColorAccentBase
  const jsExport = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  // Swift uses camelCase starting from second path segment
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
        
        const codeFmt = getTokenCodeFormats(tokenPath);
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

        const codeFmt = getTokenCodeFormats(tokenPath);
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
