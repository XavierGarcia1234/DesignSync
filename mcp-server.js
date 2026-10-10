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
        name: "commit_to_git",
        description: "Stage and commit changes to git for developer review.",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "Commit message describing the design changes" }
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

      case "commit_to_git": {
        const { message } = request.params.arguments;
        // Stage all changes (tokens, generated css, etc) and commit
        await execPromise('git add .');
        const { stdout } = await execPromise(`git commit -m "${message}"`);
        return { content: [{ type: "text", text: `Successfully committed design changes:\n${stdout}` }] };
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
