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
            filepath: { type: "string", description: "Relative path to the file (e.g., 'tokens.json')" }
          },
          required: ["filepath"]
        }
      },
      {
        name: "update_token",
        description: "Modify a specific token's $value property within the DTCG JSON structure. Automatically triggers a Style Dictionary build.",
        inputSchema: {
          type: "object",
          properties: {
            tokenPath: { type: "string", description: "Dot-notation path to the token (e.g., 'color.accent.base')" },
            newValue: { type: "string", description: "The new value for the token" }
          },
          required: ["tokenPath", "newValue"]
        }
      },
      {
        name: "build_tokens",
        description: "Runs Style Dictionary to compile the tokens.json file into CSS variables, Swift, and React formats.",
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
        const fullPath = path.resolve(process.cwd(), filepath);
        const content = await fs.readFile(fullPath, 'utf8');
        return { content: [{ type: "text", text: content }] };
      }

      case "update_token": {
        const { tokenPath, newValue } = request.params.arguments;
        const tokensFile = path.resolve(process.cwd(), 'tokens.json');
        
        // 1. Read and parse the current DTCG JSON
        const rawJson = await fs.readFile(tokensFile, 'utf8');
        let tokens = JSON.parse(rawJson);
        
        // 2. Traverse the object using the dot-notation path
        const keys = tokenPath.split('.');
        let current = tokens;
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          if (i === keys.length - 1) {
            if (!current[key]) current[key] = { $type: "string" };
            // Update the $value of the token
            current[key].$value = newValue;
          } else {
            if (!current[key]) current[key] = {};
            current = current[key];
          }
        }
        
        // 3. Save the JSON back to disk
        await fs.writeFile(tokensFile, JSON.stringify(tokens, null, 2));
        
        // 4. Automatically run Style Dictionary to rebuild the CSS/Swift/JS files
        const { stdout } = await execPromise('npx style-dictionary build -c style-dictionary-config.js');
        
        return { 
          content: [{ 
            type: "text", 
            text: `Successfully updated token '${tokenPath}' to '${newValue}'.\n\nStyle Dictionary Build Output:\n${stdout}` 
          }] 
        };
      }

      case "build_tokens": {
        const { stdout } = await execPromise('npx style-dictionary build -c style-dictionary-config.js');
        return { content: [{ type: "text", text: `Build successful:\n${stdout}` }] };
      }

      case "sync_latest_tokens": {
        // 1. Pull latest commits from git
        let pullOutput = "";
        try {
          const { stdout } = await execPromise('git pull');
          pullOutput = stdout;
        } catch (err) {
          pullOutput = `Warning: git pull could not complete (${err.message}). Using local files.`;
        }

        // 2. Re-compile Style Dictionary to ensure all build artifacts are up to date
        const { stdout: buildOut } = await execPromise('npx style-dictionary build -c style-dictionary-config.js');
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
          const { stdout } = await execPromise('git rev-parse --abbrev-ref HEAD');
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
            await execPromise(`git checkout -b ${targetBranch}`);
            createdBranch = true;
          } catch (branchErr) {
            // If branch already exists, switch to it
            await execPromise(`git checkout ${targetBranch}`);
          }
        }

        // 4. Stage and commit
        await execPromise('git add .');
        const { stdout: commitOut } = await execPromise(`git commit -m "${message}"`);
        
        // 5. Attempt git push to remote
        let pushStatus = "";
        try {
          const { stdout: pushOut, stderr: pushErr } = await execPromise(`git push -u origin ${targetBranch}`);
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
