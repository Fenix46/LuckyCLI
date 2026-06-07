# Knowledge-graph benchmark — real LLM, graph on vs off *

> **\* Alpha, single run.** The graph is an early-stage feature and these numbers
> come from **one** real session per mode — an indication, not a controlled
> benchmark. Treat them as directional. A proper suite (multiple prompts, repeated
> runs, exact token accounting) is on the roadmap.

Same agent (**GPT-5.4**), same prompt: *"Give me an overview of the project."* This
is a broad, narrative task where the model wants to read the README and entry files
regardless of whether a graph exists — i.e. the **least favourable** case for the
graph. The full transcripts are in the appendix.

| | **With graph** | **Without graph** |
| --- | --- | --- |
| Working context after the turn | ~21,144 / 258,400 | ~32,151 / 258,400 |
| Tool calls (approx.) | ~18 | ~28 |
| Answer accuracy | High | High |
| `file:line` citation precision | Good | Slightly higher (read files directly) |
| Unique structural insight | **Yes** — "god nodes" / hotspots | No |

### What this single run suggests

- **Efficiency:** a **modest** win for the graph (~1.5×) — smaller working context,
  fewer tool calls. On a "explain the whole repo" task the agent reads broadly
  either way; the graph trims some of that exploration but doesn't eliminate it.
- **Quality is essentially on par.** Both write-ups are accurate and well-organized,
  and both independently flagged the same real inconsistency (Node ≥22 in
  `package.json` vs ≥20 in the README). The no-graph answer carries marginally more
  precise `file:line` citations because it opened those files directly.
- **The graph adds something the no-graph run could not:** a centrality view of the
  codebase — the most-connected "god nodes" (`Agent`, `McpManager`, the Gemini
  client) and a note that the vendored Ink/Yoga files inflate graph density without
  being core logic. That's analysis you only get from the graph.

### Takeaway

On a whole-project overview — the graph's hardest case — enabling it gave a small
efficiency edge (~1.5×) while keeping the **quality of the analysis level with the
no-graph run**, and it contributed structural insight a plain file-reading pass
didn't. Different task, different shape of win; on neither did enabling the graph
hurt the answer. We'd expect a clearer efficiency gap on *targeted* navigation
(find a definition / a caller), but that's not yet measured with a real LLM — see
the alpha note above.

---

## Appendix — raw transcripts

### Test with LLM (GPT-5.4)

Prompt: *Give me an overview of the project.*

#### With graph

`ctx: 21,144/258,400 · 92% free`

 ────────────────────────────────────────────────────────────────────────────────────────────────────
   ✔ Graphed overview top 10 - Project graph: 377 files, 2523 nodes, 4379 edges.

   ✔ Listed "." - 27 entries                                                                                           
                                                                                                     
   ✔ Queried graph "packages/core/src/agent/agent.ts" (file) - Symbols in packages/core/src/agent/agent.ts:            
                                                                                                     
   ✔ Queried graph "packages/cli/src/index.ts" (file) - Symbols in packages/cli/src/index.ts: none.                    
    
   ✔ Read "package.json" - 29 lines                                                                                    
                                                                                                     
   ✔ Read "README.md" - showing 220 of 581 lines                                                                       
                                                                                                     
   ✔ Found "packages/*" - 1 files                                                                                      
    
   ✔ Listed "packages" - 2 entries                                                                                     
                                                                                                     
   ✔ Found "packages/*/package.json" - 2 files                                                                         
                                                                                                     
   ✔ Searched ""name"\s*:\s*"@luckycli/" in package.json - 2 matches                                                   
                                                                                                     
   ✔ Read "packages/cli/package.json" - 54 lines                                                                       
                                                                                                     
   ✔ Read "packages/core/package.json" - 32 lines                                                                      
                                                                                                     
   ✔ Queried graph "Agent" (callers) - Callers of Agent (class) — packages/core/src/agent/agent.ts:L89: none.          
    
   ✔ Queried graph "packages/cli/src/index.tsx" (file) - Symbols in packages/cli/src/index.tsx:                        
                                                                                                     
   ✔ Queried graph "packages/core/src/index.ts" (file) - Symbols in packages/core/src/index.ts:                        
                                                                                                     
   ✔ Queried graph "McpManager" (neighbors) - Neighbors of McpManager (class) — packages/core/src/mcp/manager.t…       
                                                                                                     
   ✔ Read "packages/cli/src/index.tsx" - showing 180 of 239 lines                                                      
                                                                                                     
   ✔ Read "packages/core/src/index.ts" - showing 220 of 365 lines                                                      
                                                                                                     
   ✔ Read "packages/core/src/mcp/manager.ts" - 202 lines                                                               
    
                                                                                                                       
 ────────────────────────────────────────────────────────────────────────────────────────────────────
 ● lucky ›                                                                                                             
   Here’s the project at a glance.
                                                                                                                       
   ## What it is
                                                                                                                       
   LuckyCLI is a terminal AI coding agent built in TypeScript. It runs as an interactive CLI/REPL, can read and edit   
   files, run commands, search code, fetch docs, and route all of that through a provider-agnostic agent core. That’s  
   stated in README.md:18 and reflected in the code layout.                                                            
                                                                                                                       
   ## Repo shape                                                                                                       
                                                                                                                       
   This is a monorepo with two workspaces:                                                                             
                                                                                                                       
     - packages/cli — the user-facing terminal app                                                                     
     - packages/core — the provider-agnostic engine/library
                                                                                                                       
   Confirmed in package.json:10, packages/cli/package.json:2, and packages/core/package.json:2.

   Top-level scripts are simple:

     - npm run build
     - npm run dev
     - npm run start                                                                                                   
     - npm run typecheck
     - npm run test                                                                                                    

   from package.json:13.                                                                                               

   ## Main architecture

   ### 1. CLI package
   The entrypoint is packages/cli/src/index.tsx:1.
                                                                                                                       
   That file shows the CLI does three main things:                                                                     
                                                                                                                       
     - starts the Ink-based TUI/REPL                                                                                   
     - handles non-interactive subcommands like graph, mcp, and update                                                 
     - loads config/session state from @luckycli/core                                                                  
                                                                                                                       
   The UI is built on React + Ink, which matches the dependency list in packages/cli/package.json:21.                  
                                                                                                                       
   ### 2. Core package                                                                                                 
   packages/core is the real engine. Its public surface is exported from packages/core/src/index.ts:1.                 
                                                                                                                       
   That file exposes:                                                                                                  
                                                                                                                       
     - the Agent loop                                                                                                  
     - provider implementations                                                                                        
     - built-in tools                                                                                                  
     - task management
     - project memory                                                                                                  
     - sub-agents
     - the knowledge graph system                                                                                      
     - config/session/prompt infrastructure
                                                                                                                       
   So the core is designed to be embedded independently of the CLI, not just used by this one frontend.
                                                                                                                       
   ### 3. Agent loop                                                                                                   
   The central runtime object is Agent in packages/core/src/agent/agent.ts:89.                                         
                                                                                                                       
   From the symbol list, it handles:                                                                                   
                                                                                                                       
     - sending turns                                                                                                   
     - token/context tracking                                                                                          
     - compaction/summarization                                                                                        
     - provider status
     - usage recording                                                                                                 
    
   This lines up with the README claim that the app supports long-running sessions and context compaction.             
    
   ## Key capabilities                                                                                                 
    
   ## Multi-provider model support                                                                                     
   The README describes six providers:
                                                                                                                       
     - Claude                                                                                                          
     - ChatGPT/OpenAI OAuth                                                                                            
     - Gemini                                                                                                          
     - Antigravity
     - OpenAI API                                                                                                      
     - Ollama
                                                                                                                       
   See README.md:30 and README.md:173.
                                                                                                                       
   The code structure in packages/core/src/index.ts:11 confirms there is a dedicated provider layer abstracted behind  
   one API.                                                                                                            
                                                                                                                       
   ## Knowledge graph
   A major feature is the project knowledge graph stored under .lucky/graph.                                           
                                                                                                                       
   Evidence:                                                                                                           
                                                                                                                       
     - README overview at README.md:37                                                                                 
     - CLI graph commands in packages/cli/src/index.tsx:41                                                             
     - graph exports in packages/core/src/index.ts:107                                                                 
                                                                                                                       
   The graph system includes:                                                                                          
                                                                                                                       
     - graph building and updating                                                                                     
     - symbol/call/import indexing                                                                                     
     - overview/query helpers                                                                                          
     - HTML rendering
                                                                                                                       
   This repo itself currently has:
                                                                                                                       
     - 377 files                                                                                                       
     - 2523 graph nodes                                                                                                
     - 4379 edges                                                                                                      
                                                                                                                       
   from the graph overview.                                                                                            
                                                                                                                       
   ## Tooling model                                                                                                    
   The core exports a built-in tool registry in packages/core/src/index.ts:19 and :37.                                 
                                                                                                                       
   Built-in tools include:                                                                                             
                                                                                                                       
     - file reads/writes/edits/patching                                                                                
     - directory and glob search
     - grep                                                                                                            
     - shell execution
     - HTTP fetch                                                                                                      
     - task list management                                                                                            
     - planning                                                                                                        
     - sub-agent spawning                                                                                              
     - project memory                                                                                                  
     - graph query/overview                                                                                            
     - ask-user interaction                                                                                            
    
   So the agent is built around a structured tool interface, not ad-hoc command generation.                            

   ## MCP support                                                                                                      
   There is explicit MCP integration.
                                                                                                                       
   packages/core/src/mcp/manager.ts:34 defines McpManager, which can:                                                  
                                                                                                                       
     - connect to local or remote MCP servers                                                                          
     - track connection status
     - expose MCP tools to the agent                                                                                   
     - list prompts/resources
     - reconnect/disconnect servers                                                                                    
    
   The CLI also exposes mcp commands in packages/cli/src/index.tsx:44.                                                 
    
   ## Sessions, persistence, and updates                                                                               
   From packages/cli/src/index.tsx:6 and :53, plus the README:
                                                                                                                       
     - sessions are saved and resumable                                                                                
     - config is resolved centrally from core                                                                          
     - the app supports self-update commands                                                                           
     - update staging is applied on startup
                                                                                                                       
   ## Tech stack                                                                                                       
                                                                                                                       
   Based on package manifests and graph usage:                                                                         
                                                                                                                       
     - TypeScript                                                                                                      
     - Node.js  
     - React + Ink for terminal UI                                                                                     
     - Vitest for tests                                                                                                
     - Zod for schemas/validation                                                                                      
     - web-tree-sitter / tree-sitter-wasms for graph extraction/parsing                                                
     - provider SDKs for Anthropic, Google, OpenAI, and MCP                                                            
                                                                                                                       
   See packages/cli/package.json:21, packages/core/package.json:20, and the external-library graph summary.            
                                                                                                                       
   ## Scale and hotspots                                                                                               
                                                                                                                       
   The graph suggests these are some of the most connected project symbols:                                            
    
     - Agent — core orchestration                                                                                      
     - CodeAssistClient / GeminiProvider — provider-side complexity
     - McpManager — MCP integration                                                                                    
                                                                                                                       
   There are also very connected vendorized Ink/Yoga files under packages/cli/src/vendor, which likely account for some
   graph density but are not the main business logic.                                                                  
                                                                                                                       
   ## Practical mental model                                                                                           
                                                                                                                       
   The cleanest way to think about the repo is:                                                                        
                                                                                                                       
     - `packages/core` = reusable engine                                                                               
     - `packages/cli` = terminal product built on that engine
     - `.lucky/graph` = local code intelligence layer                                                                  
     - MCP/tasks/sub-agents/project memory = higher-level agent workflow features                                      
                                                                                                                       
   ## One noteworthy inconsistency                                                                                     
                                                                                                                       
   There’s a small mismatch between docs and config:                                                                   
                                                                                                                       
     - root package.json:8 requires Node >=22                                                                          
     - README.md:127 says Node.js ≥ 20 for source builds
                                                                                                                       
   If you rely on local source development, the package file is the stronger source of truth.                          
                                                                                                                       
   If you want, I can also give you a directory-by-directory walkthrough or a data-flow overview from user prompt →    
   agent → tools → provider.  


#### Without graph

`ctx: 32,151/258,400 · 88% free`
 ────────────────────────────────────────────────────────────────────────────────────────────────────
 you › Give me an overview of the project.                                                                           

                                                                                                                       
 ────────────────────────────────────────────────────────────────────────────────────────────────────
 ● lucky ›                                                                                                             
   I’ll inspect the repo structure and the main project metadata, then summarize the architecture and purpose.
                                                                                                                       
                                                                                                                       
 ────────────────────────────────────────────────────────────────────────────────────────────────────                  
   ✔ Listed "." - 27 entries                                                                                           
                                                                                                                       
   ✔ Found "{package.json,README*,pyproject.toml,Cargo.toml,go.mod,composer.json,Makefile,docker-compo… - 1 files      
                                                                                                     
                          
 ────────────────────────────────────────────────────────────────────────────────────────────────────
 ● lucky ›                                                                                                             
   Next I’m reading the root metadata and the package layout to identify the apps, libraries, and scripts that make up
   the repo.                                                                                                           
                                                                                                                       
                                                                                                                       
 ────────────────────────────────────────────────────────────────────────────────────────────────────                  
   ✔ Read "package.json" - 29 lines                                                                                    
                                                                                                                       
   ✔ Read "README.md" - showing 260 of 581 lines                                                                       
                                                                                                     
   ✔ Listed "packages" - 2 entries

   ✔ Listed "scripts" - 3 entries                                                                                      
                                                                                                     
   ✔ Listed "docs" - 2 entries                                                                                         

   ✔ Listed ".github" - 1 entries                                                                                      
    
                                                                                                                       
 ────────────────────────────────────────────────────────────────────────────────────────────────────
 ● lucky ›                                                                                                             
   I’ve confirmed it’s a TypeScript monorepo with two workspace packages. I’m drilling into packages/cli and
   packages/core to map responsibilities and entry points.                                                             
                                                                                                                       
                                                                                                                       
 ────────────────────────────────────────────────────────────────────────────────────────────────────                  
   ✔ Listed "packages/cli" - 10 entries                                                                                
                                                                                                                       
   ✔ Listed "packages/core" - 6 entries                                                                                
                                                                                                     
   ✔ Found "packages/*/package.json" - 2 files
                                                                                                     
   ✔ Found "packages/*/src/**/*" - 101 files                                                                           
                                                                                                     
   ✔ Listed ".github/workflows" - 1 entries                                                                            
                                                                                                     
                                                                                                                       
 ────────────────────────────────────────────────────────────────────────────────────────────────────
 ● lucky ›                                                                                                             
   I’m reading the workspace package manifests and the main entry files to separate CLI concerns from the reusable core
   engine.                                                                                                             
                                                                                                                       
                                                                                                                       
 ────────────────────────────────────────────────────────────────────────────────────────────────────                  
   ✔ Read "packages/cli/package.json" - 54 lines                                                                       
                                                                                                                       
   ✔ Read "packages/core/package.json" - 32 lines                                                                      
                                                                                                     
   ✔ Read "packages/cli/src/index.tsx" - 239 lines
                                                                                                     
   ✔ Read "packages/core/src/index.ts" - showing 260 of 365 lines                                                      
    
   ✔ Read "packages/cli/src/runtime.ts" - 227 lines                                                                    
                                                                                                     
   ✔ Read "packages/core/src/agent/agent.ts" - showing 260 of 587 lines                                                

                                                                                                                       
 ────────────────────────────────────────────────────────────────────────────────────────────────────
 ● lucky ›                                                                                                             
   I’ve got the top-level shape. I’m checking providers, built-in tools, and the UI surface so the overview reflects
   what is actually implemented.                                                                                       
                                                                                                                       
                                                                                                                       
 ────────────────────────────────────────────────────────────────────────────────────────────────────                  
   ✔ Listed "packages/core/src/providers" - 6 entries                                                                  
                                                                                                                       
   ✔ Listed "packages/core/src/tools/builtin" - 29 entries                                                             
                                                                                                     
   ✔ Listed "packages/cli/src/ui/components" - 18 entries
                                                                                                     
   ✔ Read "packages/cli/src/ui/Root.tsx" - showing 260 of 537 lines                                                    
    
   ✔ Read "packages/core/src/tools/builtin/index.ts" - 71 lines                                                        
                                                                                                     
   ✔ Read "packages/core/src/providers/index.ts" - 107 lines                                                           

                                                                                                                       
 ────────────────────────────────────────────────────────────────────────────────────────────────────
 ● lucky ›                                                                                                             
   Here’s the project at a glance.
                                                                                                                       
   ## What it is
                                                                                                                       
   LuckyCLI is a terminal AI coding agent built as a TypeScript monorepo. Its main product is the lucky CLI, backed by a
    reusable provider-agnostic core engine.                                                                            
                                                                                                                       
     - Root workspace: package.json:10
     - CLI package: packages/cli/package.json:2                                                                        
     - Core engine package: packages/core/package.json:2 
                                                                                                                       
   ## High-level architecture                                                                                          
                                                                                                                       
   ### 1. `@luckycli/cli` — the terminal app                                                                           
   This is the user-facing executable.                                                                                 
                                                                                                                       
     - Exposes the lucky binary: packages/cli/package.json:8                                                           
     - Main entrypoint: packages/cli/src/index.tsx:1                                                                   
     - Uses React + Ink for the terminal UI: packages/cli/package.json:33, packages/cli/package.json:35                
     - Handles:                                                                                                        
       - CLI args and subcommands                                                                                      
       - session resume/listing                                                                                        
       - TUI rendering                                                                                                 
       - graph/mcp/update commands before entering the UI                                                              
                                                                                                                       
   Key subcommands implemented in the entry file:                                                                      
     - graph build|rebuild|view: packages/cli/src/index.tsx:41                                                         
     - mcp ...: packages/cli/src/index.tsx:44                                                                          
     - update ...: packages/cli/src/index.tsx:48                                                                       
                                                                                                                       
   ### 2. `@luckycli/core` — the reusable agent engine                                                                 
   This is the actual engine and library surface.                                                                      
                                                                                                                       
     - Public API exports: packages/core/src/index.ts:1                                                                
     - Core responsibilities:                                                                                          
       - provider abstraction                                                                                          
       - agent loop                                                                                                    
       - tool registry and built-in tools                                                                              
       - tasks/planning/sub-agents                                                                                     
       - project memory                                                                                                
       - knowledge graph                                                                                               
       - config/session/update infrastructure                                                                          
                                                                                                                       
   The file packages/core/src/index.ts is effectively the map of the whole engine.                                     
    
   ## Core runtime flow                                                                                                
    
   The CLI builds an agent runtime here:                                                                               

     - packages/cli/src/runtime.ts:189                                                                                 
    
   That runtime:                                                                                                       
     - creates the built-in tool registry
     - resolves provider credentials                                                                                   
     - composes the system prompt                                                                                      
     - appends project memory                                                                                          
     - optionally connects MCP servers in the background                                                               
     - keeps the project knowledge graph updated after file edits
                                                                                                                       
   Graph upkeep hook:                                                                                                  
     - packages/cli/src/runtime.ts:45                                                                                  
     - packages/cli/src/runtime.ts:180                                                                                 
                                                                                                                       
   ## The agent loop                                                                                                   
                                                                                                                       
   The main agent implementation is:                                                                                   
                                                                                                                       
     - packages/core/src/agent/agent.ts:89                                                                             

   What it does:                                                                                                       
     1. stores conversation history
     2. sends messages to a provider                                                                                   
     3. streams assistant output
     4. executes requested tools                                                                                       
     5. appends tool results
     6. repeats until the model stops asking for tools                                                                 
                                                                                                                       
   Notable features implemented in the agent:                                                                          
     - unbounded tool loop by default: packages/core/src/agent/agent.ts:39                                             
     - context compaction/summarization: packages/core/src/agent/agent.ts:45                                           
     - tool approvals: packages/core/src/agent/agent.ts:51                                                             
     - bridges for ask_user, present_plan, spawn_agent: packages/core/src/agent/agent.ts:56                            
                                                                                                                       
   ## Provider model                                                                                                   
                                                                                                                       
   Providers are plugged in behind one registry/adapter layer.                                                         
                                                                                                                       
   Built-in providers registered on import:                                                                            
     - Claude: packages/core/src/providers/index.ts:30
     - OpenAI API: packages/core/src/providers/index.ts:40                                                             
     - OpenAI OAuth / ChatGPT: packages/core/src/providers/index.ts:43                                                 
     - Gemini: packages/core/src/providers/index.ts:53                                                                 
     - Antigravity: packages/core/src/providers/index.ts:56                                                            
     - Ollama: packages/core/src/providers/index.ts:59                                                                 
                                                                                                                       
   So the project is designed around one canonical agent/tool flow with swappable model backends.                      
                                                                                                                       
   ## Built-in tools                                                                                                   
                                                                                                                       
   The default built-in tool registry is assembled here:                                                               

     - packages/core/src/tools/builtin/index.ts:25                                                                     
    
   Registered tools include:                                                                                           
     - file reads/writes/edits/patches
     - exec and PowerShell                                                                                             
     - list_dir, glob, grep                                                                                            
     - http_fetch                                                                                                      
     - task tools                                                                                                      
     - plan presentation                                                                                               
     - sub-agent spawning                                                                                              
     - project memory                                                                                                  
     - graph query/overview                                                                                            
     - ask_user                                                                                                        
                                                                                                                       
   See:                                                                                                                
     - packages/core/src/tools/builtin/index.ts:27                                                                     
     - packages/core/src/tools/builtin/index.ts:46                                                                     

   This repo is not just “chat in terminal”; it’s a tool-using agent platform.

   ## UI surface

   The CLI UI is fairly substantial. Main top-level UI orchestration:

     - packages/cli/src/ui/Root.tsx:74                                                                                 
    
   Components show the app supports:                                                                                   
     - transcript/chat
     - approval prompts                                                                                                
     - task panel
     - status view
     - user questions
     - MCP panel
     - agent usage panel
     - streaming preview

   Examples from packages/cli/src/ui/components:
     - Transcript.tsx
     - TaskPanel.tsx
     - StatusView.tsx
     - UserQuestion.tsx
     - AgentsPanel.tsx                                                                                                 
    
   ## Extra systems beyond a basic chat CLI                                                                            

   This project has several advanced subsystems already implemented:                                                   
    
   ### Knowledge graph                                                                                                 
   The core exports a native graph build/query/update system:
     - build: packages/core/src/index.ts:150                                                                           
     - update: packages/core/src/index.ts:152                                                                          
     - query helpers: packages/core/src/index.ts:160                                                                   
     - HTML graph rendering: packages/core/src/index.ts:169                                                            
                                                                                                                       
   ### Task tracking and planning                                                                                      
   Core task store exports:                                                                                            
     - packages/core/src/index.ts:76                                                                                   
                                                                                                                       
   Plan types/tooling:                                                                                                 
     - packages/core/src/index.ts:59                                                                                   
                                                                                                                       
   ### Sub-agents                                                                                                      
   Profiles and runner:                                                                                                
     - packages/core/src/index.ts:62                                                                                   
     - packages/core/src/index.ts:73                                                                                   
                                                                                                                       
   ### MCP integration                                                                                                 
   Visible from:
     - CLI command wiring: packages/cli/src/index.tsx:44                                                               
     - runtime MCP connection: packages/cli/src/runtime.ts:205
                                                                                                                       
   ### Self-update                                                                                                     
   Core update exports:                                                                                                
     - packages/core/src/index.ts:231                                                                                  
                                                                                                                       
   CLI command wiring:                                                                                                 
     - packages/cli/src/index.tsx:149
                                                                                                                       
   ## Repo layout
                                                                                                                       
   Top-level directories that matter most:                                                                             
    
     - packages/ — main code                                                                                           
     - scripts/ — utility/build/benchmark scripts
     - docs/ — project docs and investigations                                                                         
     - assets/ — screenshots/branding                                                                                  
     - .github/workflows/ — CI/release workflow                                                                        
     - dist-bin/ — likely built binary/release artifacts                                                               
     - .lucky/ — project-local Lucky data                                                                              
                                                                                                                       
   ## Build/test/tooling                                                                                               
                                                                                                                       
   Root scripts:                                                                                                       
     - build: package.json:14                                                                                          
     - dev: package.json:15                                                                                            
     - start CLI: package.json:16                                                                                      
     - typecheck: package.json:17                                                                                      
     - test: package.json:18                                                                                           
                                                                                                                       
   Tech stack from manifests:                                                                                          
     - TypeScript                                                                                                      
     - Vitest                                                                                                          
     - React + Ink                                                                                                     
     - Zod                                                                                                             
     - provider SDKs for Anthropic, OpenAI, Gemini
     - tree-sitter-based graph extraction                                                                              
                                                                                                                       
   ## One noteworthy inconsistency                                                                                     
                                                                                                                       
   There’s a version mismatch in the docs vs package metadata:                                                         
                                                                                                                       
     - root package.json requires Node >=22: package.json:7                                                            
     - README says Node.js ≥ 20 for source builds: README.md:127
                                                                                                                       
   The codebase source of truth is the package manifest, so I’d treat Node 22+ as the real requirement unless proven   
   otherwise.                                                                                                          
                                                                                                                       
   ## Short summary                                                                                                    
                                                                                                                       
   This is a well-developed monorepo for a multi-provider terminal coding agent:
                                                                                                                       
     - packages/cli = interactive terminal app                                                                         
     - packages/core = reusable engine/library
     - strong focus on:                                                                                                
       - provider abstraction                                                                                          
       - tool execution                                                                                                
       - safety/approvals                                                                                              
       - persistent sessions                                                                                           
       - planning/tasks/sub-agents                                                                                     
       - knowledge graph navigation
       - MCP integration                                                                                               
       - self-update
                                                                                                                       
   If you want, I can next give you either:
     1. a directory-by-directory walkthrough, or                                                                       
     2. a data-flow overview of one user turn from prompt → provider → tools → UI.  


