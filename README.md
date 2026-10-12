# DesignSync 🎨⚡

**DesignSync** is an automated, bidirectional Design System synchronization engine powered by the **Model Context Protocol (MCP)** and **Style Dictionary (v4)**.

It bridges the gap between designers and developers by enabling designers to inspect, update, and publish design tokens directly through conversational AI tools (like Claude Desktop, Cursor, and Antigravity IDE) without touching command lines or manually managing Git branches.

When design tokens change, DesignSync automatically recompiles them into production-ready code across multiple platforms:
* 🌐 **Web**: CSS Custom Properties (`variables.css`, `style.css`)
* 📱 **iOS & macOS**: Native Swift Package (`Sources/DesignSync/StyleDictionary.swift` with UIKit & SwiftUI extensions)
* ⚛️ **JavaScript / React Native**: ES module tokens (`build/js/tokens.js`)

---

## 🛠️ MCP Tools Overview

When connected to an AI assistant, DesignSync exposes the following MCP tools:

| Tool | Description | Example AI Use |
| :--- | :--- | :--- |
| `read_file` | Reads current design tokens (`tokens.json`), CSS, or component HTML. | *"What is our current primary background color?"* |
| `update_token` | Updates a token by dot-notation path (e.g., `color.accent.base`) in DTCG standard format and immediately compiles code for all platforms. | *"Change the button accent color to `#8B5CF6`."* |
| `build_tokens` | Manually triggers Style Dictionary compilation. | *"Rebuild all design token assets."* |
| `sync_latest_tokens` | Pulls the latest tokens from Git and rebuilds assets. | *"Sync our design tokens with the latest updates from developers."* |
| `commit_to_git` | Stages changes, auto-creates a clean review branch (e.g. `tokens/new-accent-color-1011`), commits, and pushes to GitHub for Pull Request review. | *"Commit my color updates so the team can review them."* |

---

## 🚀 Designer Quickstart: How to Use DesignSync

You don't need to know how to code to use DesignSync. Follow these steps to connect it to your AI tool.

### Step 1: Prerequisites
Ensure you have installed:
1. **Node.js** (v18 or newer) — [Download Node.js](https://nodejs.org/)
2. **Git** — [Download Git](https://git-scm.com/)

### Step 2: Clone & Install
Open your terminal and run:
```bash
git clone https://github.com/XavierGarcia1234/DesignSync.git
cd DesignSync
npm install
```

### Step 3: Connect to Your AI Assistant

#### Option A: Claude Desktop
1. Open your Claude Desktop configuration file:
   * **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   * **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   * **Linux**: `~/.config/Claude/claude_desktop_config.json`
2. Add the `design-sync` server under `mcpServers`:
```json
{
  "mcpServers": {
    "design-sync": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/DesignSync/mcp-server.js"]
    }
  }
}
```
*(Replace `/ABSOLUTE/PATH/TO/DesignSync` with the actual path to your cloned folder).*

3. Restart Claude Desktop. You will see the hammer/tool icon indicating DesignSync is connected.

#### Option B: Cursor / Antigravity IDE
Add the MCP server in your IDE's MCP settings:
* **Name**: `design-sync`
* **Type**: `command` (stdio)
* **Command**: `node /ABSOLUTE/PATH/TO/DesignSync/mcp-server.js`

---

## 💬 Example AI Prompts for Designers

Once connected, simply chat with your assistant:

### 1. Inspect Tokens
> *"What colors and border radii are currently defined in our design system?"*

### 2. Update Styles
> *"Update our base accent color to `#BFF549` and set the hover state to `#8CC21F`."*
>
> 🪄 *The assistant will modify `tokens.json` and immediately recompile CSS and Swift files.*

### 3. Preview Live Components
Open `components.html` in your web browser to visually preview the component library (buttons, badges, inputs, cards, switches) using the live tokens.

### 4. Send Changes to Developers
> *"I'm happy with the new lime green accents. Please commit these changes and prepare them for review."*
>
> 🚀 *DesignSync will automatically create a dedicated Git review branch, commit your changes, and push them to GitHub so developers can open a Pull Request.*

---

## 💻 Developer Integration

### Web (CSS)
Import the generated CSS variables into your stylesheet:
```css
@import './variables.css';

.my-button {
  background-color: var(--color-accent-base);
  border-radius: var(--size-radius-md);
}
```

### iOS & macOS (Swift Package Manager)
Add `DesignSync` as a local Swift package or Git dependency in Xcode:
```swift
import SwiftUI
import DesignSync

struct ContentView: View {
    var body: some View {
        Text("DesignSync Token")
            .foregroundColor(.dsAccentInk)
            .padding()
            .background(Color.dsAccentBase)
            .cornerRadius(StyleDictionarySize.radiusMd)
    }
}
```

---

## 📁 Repository Structure

```text
├── tokens.json                   # Single source of truth (DTCG standard)
├── mcp-server.js                 # Model Context Protocol server
├── style-dictionary-config.js    # Multi-platform compilation config
├── components.html               # Interactive visual component showcase
├── style.css                     # Component library stylesheet
├── Package.swift                 # Swift Package Manager manifest
├── Sources/
│   └── DesignSync/
│       └── StyleDictionary.swift # Generated UIKit & SwiftUI tokens
└── package.json                  # Node dependencies & build scripts
```

---

## 📄 License
MIT
