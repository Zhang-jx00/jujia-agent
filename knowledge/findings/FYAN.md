# FYAN — Yan-Agent Architecture Blueprint

Source: `D:\MiMo\ProjectOne\Yan-Agent`  
Target learner: 俱佳Agent (TypeScript + Electron)  
Scope: selective reads of package.json, main.js structure, lib sidecar/MCP/memory, renderer, skills layout. Not a full dump.

---

## 1. Process & window architecture

### Stack
| Piece | Yan-Agent |
|---|---|
| Shell | Electron 31, entry `main.js` |
| Packaging | electron-builder (win nsis + portable) |
| Agent kernel | vendored `opencode-ai` + `@opencode-ai/sdk` |
| Native | `node-pty` (ConPTY terminal), codegraph native runtime |
| Renderer | Vanilla JS + CSS (no React/Vite app shell) |

### Process roles
```
Electron main (main.js, ~8019 lines)
  ├── BrowserWindows (splash, main, quick-input, pet, overlay, image-viewer)
  ├── OpenCodeSidecar → child process `opencode serve` on 127.0.0.1
  ├── MCP server scripts (yan-*-mcp.js) spawned as stdio children for the kernel
  ├── TCP bridges (browser/session) between MCP tools and main-owned UI/runtime
  └── PTY terminal sessions (TerminalManager)

Renderer(s)
  └── talk only through preload contextBridge `window.yan.*`
```

### Windows (from main.js creators)
| Window | File | Role |
|---|---|---|
| splash | `renderer/splash/` | timed branding |
| main | `renderer/index.html` + `renderer.js` | primary UI; custom titlebar; multi “window view” tabs inside one shell |
| quick-input glow | `renderer/quick-input-glow/` | decorative companion |
| quick-input | `renderer/quick-input/` | global shortcut palette (separate preload) |
| computer-use overlay | `renderer/computer-use-overlay/` | agent computer-use surface |
| image viewer | `renderer/image-viewer/` | ephemeral generated-media viewer |
| pet | `renderer/pet/` | desktop pet + task control (own preload) |

### Renderer structure hints
- One “app shell” HTML + large `renderer/renderer.js`, plus feature scripts (`skill-market.js`, `browser-agent.js`, `i18n.js`).
- Feature islands as folders: `terminal/`, `understand-anything/`, `quick-input/`, `pet/`, `image-viewer/`.
- Custom titlebar; window min/max/close over IPC.
- CSP is host-explicit (provider allowlists in `index.html`).
- Preload pattern: thin named methods, unsubscribe-returning event listeners.

### Data-root design (copy-worthy idea)
- Stable path: `app.getPath('userData')/YanData` (survives reinstall/version).
- One-shot migration from legacy `YanData-*` build-isolated dirs.
- E2E override: `YAN_E2E_USER_DATA_DIR`.

---

## 2. Kernel/sidecar pattern

### What it is
`lib/opencode-sidecar.js` (~4583 lines) is the **only Agent execution authority**. Main never drives models/tools directly; it builds a request, starts/leases a kernel, streams events to renderer.

### Top-level exports (selected)
- Classes: `OpenCodeSidecar`, `SubBuildSlotPool`
- Config/permission: `buildOpenCodeConfig`, `permissionRulesForRun`, `sessionPermissionForRun`, `nextSubagentPermission`
- Prompt assembly: `combineSystem`, `combineTurnPrompt`, `buildPromptParts`, many `*System()` modules
- Memory review: `normalizeMemoryReview`, `memoryReviewerSystem`, `MEMORY_REVIEW_SCHEMA`
- Context: `compactOpenCodeSession`, `openCodeContextBudget`, token estimators

### `OpenCodeSidecar` lifecycle (public-ish surface)
- `constructor({ appRoot, dataDir, maxKernels, kernelFactory, subBuildPool, ... })`
- `start(config)` — spawn/replace kernel, serialize config changes via promise queue
- `#start` — resolve executable, free port, isolate env, spawn, health-poll, attach SDK client
- `run(request, onEvent)` — create session, prompt async, stream events, permission/question replies
- `status()`, `hasRun(runId)`, `invalidate()`, `close()`
- Pooling internals: `#acquirePooledKernel`, `#runPooled`, `SubBuildSlotPool.acquire/bindCall/release`

### Kernel isolation recipe
1. Spawn: `opencode serve --hostname=127.0.0.1 --port=<free>`
2. Isolate homes under `dataDir/opencode-runtime/{home,data,config,cache,state}`
3. Env: random Basic-auth password, `OPENCODE_CONFIG_CONTENT`, disable project config/autoupdate/external skills
4. Health: poll `/global/health` with timeout
5. Client: dynamic import `@opencode-ai/sdk/v2/client`
6. Config signature: if config changes while runs active → refuse; else stop+restart
7. Pool: up to 3 kernels keyed by config signature; idle-release; fail active runs cleanly on kernel death
8. Concurrency: main also caps `MAX_CONCURRENT_AGENT_RUNS = 3`

### Event path
```
OpenCode kernel events
  → sidecar run onEvent / emitTrackedRunEvent
  → OpenCodeEventBatcher (lib/open-code-stream.js)
  → main sendOpenCodeRendererEvent(runId, event)
  → renderer webContents
```
Reconcile buffers keep last N events per run for late UI attach.

### MCP naming pattern (`lib/*-mcp.js`)
| File | Role | Config channel |
|---|---|---|
| `yan-browser-mcp.js` | browser tools over TCP bridge | `YAN_BROWSER_BRIDGE_*`, token |
| `yan-session-mcp.js` | handoff / source context tools | `YAN_SESSION_BRIDGE_*`, token |
| `yan-skills-mcp.js` | skill list/read/install tools | `YAN_SKILLS_*` env paths |
| `yan-media-mcp.js` | media tools | `YAN_MEDIA_*`, workspace registry file |
| `yan-harness-mcp.js` | continual-harness tools | `YAN_HARNESS_*` context paths |
| `nuphus-desktop-mcp.js` | desktop/computer-use | third-party package |

Pattern: MCP scripts are **thin stdio JSON-RPC servers**. Sensitive state stays in Electron main; tools get tokens/paths via env. Browser/session tools bridge back over localhost TCP with one-shot operation IDs and size caps.

---

## 3. IPC surface inventory (grouped)

Naming convention: `domain:action` invoke, or `domain:event` push. Preload exposes them as `window.yan.*`.

| Group | Channels (representative) |
|---|---|
| **config** | `config:get`, `config:set`, `about:open-release-notes` |
| **providers / models** | `providers:list`, `provider:*`, `models:quick-list`, `models:media-list`, `model:role-set`, `model:changed` |
| **connections** | `connections:list/test/save/delete` |
| **vision** | `vision-relay:status`, `vision-relay:open-guide-url` |
| **skills** | `skills:list/catalog/market/read/add-custom/remove-custom/open-directory`, `skills:changed` |
| **workspace** | `workspace:get/activate/pick/choose/open-explorer` |
| **git** | `git:status/init/stage/unstage/commit/branch-*/fetch/pull/push/remote-*/identity-set/history/diff/review/clone/open-remote` |
| **sessions** | `session:list/get/create/save/set-workspace/rename/set-pinned/delete` |
| **memory** | long-term memory IPC group under “IPC: Long-term memory” |
| **yanagent workspace dir** | `yanagent:ensure`, `yanagent:run-changes`, `yanagent:rollback-run` |
| **files / media** | `file:choose-directory/upload/reveal`, `image:generate/cancel/generated-*`, `video:generate/cancel` |
| **launchers** | `yanxi:launch`, `yanxi:consume-pending-workspace`, `vscode:status/launch`, `powershell:open-external` |
| **terminal** | `terminal:create/write/resize/destroy` |
| **mcp management** | `mcp:list/add/remove/update/test/start/stop` |
| **permissions** | `permissions:get`, `permissions:set` |
| **agent runtime** | `opencode:prewarm/start-run/sync-active-runs/run-changes/session-changes/interject/cancel-interjection/cancel-run/permission-reply/question-reply/classify-shell-command` |
| **pet / chrome** | `pet:*`, `computer-use:visual-state`, browser agent command/result |

Design takeaway: **group by product domain, not by implementation file**. Yan-Agent has the grouping in comments but still piles handlers into `main.js`.

---

## 4. Skills / MCP / memory / session data layout on disk

### App data root (`%userData%/YanData`)
```
YanData/
  config.json
  sessions/<sessionId>.json
  uploads/
  memory.json                         # global long-term memory
  skill-evolution.json
  harness/harness-state.json
  harness/runtime/*.json              # per-run harness context for MCP
  harness/pending/*.json
  SkillStore/
    bundled/
    installed/
    staging/
    quarantine/
    index.json                        # vector-ish skill index
  generated-images|videos|media/
  media-workspace-registry.json
  opencode-runtime/                   # isolated kernel homes
  runtimes/officecli/
```

### Workspace-local (`.yanagent/`, safe to delete)
```
<workspace>/.yanagent/
  memory.json
  harness/harness-state.json
  snapshots / logs / run artifacts
```
Also excluded from git UI (`git-service.js` INTERNAL_PATHSPECS).

### Skills layout
**Bundled content (repo)**
```
lib/skills/
  builtin.json                 # versioned builtin skill cards
  bundled/*.json               # per-skill manifest (id, triggers, requires, promptFile)
  <skill-id>/SKILL.md          # prompt body (+ optional rules/, agents/, scripts/)
  retired.json
```
Manifest example (`bundled/yan-serena.json`): `id`, `name`, `desc`, `aliases`, `tags`, `triggers`, `source`, `requires[{kind:mcp,match}]`, `promptFile`.
SKILL.md may use YAML frontmatter (`name`, `description`).
Custom install marker: `.yan-skill.json`.

**Runtime store (dataDir/SkillStore)**  
Materialized copies + `index.json`; FNV-hash 96-dim bag-of-tokens cosine retrieval (`skill-store.js`); staging/quarantine for installs.

### Memory write pattern
`LongTermMemoryStore` (`lib/long-term-memory.js`):
- Versioned JSON (`MEMORY_VERSION = 2`)
- Records: `content`, `scope` (global|machine|workspace), `type` (preference|environment|project|decision|procedure|failure_solution), confidence, occurrences, evidence, keywords, status active/superseded
- Retrieval: token score + scope/type boosts + always-on high-confidence global preferences
- Prompt injection: “Relevant long-term memory (selectively retrieved)”
- Safety: sensitive marker blocklist (api keys, passwords)
- **Write path:** `fs.writeFileSync(filePath, JSON.stringify(next, null, 2))` — **not atomic**
- Paths: global `YanData/memory.json`; workspace `<ws>/.yanagent/memory.json`

### Session write pattern
- One JSON file per session: `sessionsDir/<id>.json`
- Summary cache keyed by `mtimeMs + size` to avoid re-parsing full history on every `session:list`
- Full session save still rewrites whole JSON

---

## 5. What a learner should copy vs avoid

### Copy (reusable design points)
1. **Stable data root + migration** — never store durable state under versioned install dirs.
2. **Kernel/sidecar isolation** — agent runtime as separate process, isolated env, health check, config signature, clean shutdown.
3. **Named IPC groups + thin preload API** — `domain:action`, contextBridge only, event listeners return unsubscribe.
4. **Skill package format** — manifest JSON + `SKILL.md` + optional assets; registry merges builtin/bundled/installed/market.
5. **SkillStore staging/quarantine + atomicWrite** — good reference implementation (`skill-store.js` uses temp+rename).
6. **MCP as env-injected thin tools** — keep secrets/UI authority in main; bridge with tokens and size limits.
7. **Event batching + reconcile buffer** for agent streams (avoids renderer flood / missed attach).
8. **Session summary caching by mtime+size** — lesson already learned in this codebase comments.
9. **Workspace-local scratch under `.yanagent/`** and git-ignore it.
10. **Memory as structured, scoped, versioned facts** with selective prompt injection — better than dumping chat history.
11. **asarUnpack for MCP/native/scripts** — packaging awareness from day one.
12. **Test matrix** under `test/` (unit + e2e per subsystem) as the safety net for architecture refactors.

### Avoid (known/observed issues)
| Issue | Evidence | Better approach for 俱佳Agent |
|---|---|---|
| **God files** | `main.js` ~8k lines; `opencode-sidecar.js` ~4.5k; giant `renderer.js` | Split main into bootstrap + ipc modules + services; split sidecar into kernel pool / run orchestrator / prompt builders |
| **`loadConfig()` hot path** | `loadConfig()` re-reads disk and rebuilds large defaults; called from many IPC handlers | In-memory config cache + dirty flag; `getConfig()` sync from cache; explicit `reloadConfig()` on external change |
| **Non-atomic writes** | `saveConfig`, `writeStore` (memory), `skill-evolution.js` use direct `writeFileSync` | Always `atomicWrite` (temp + rename); put one helper in `services/fs-atomic.ts` |
| **Permission race** | `permissions:set` = load → merge → save with no lock; concurrent config writers can clobber | Single-writer config store (queue/mutex); permissions as typed slice with optimistic UI + authoritative echo |
| **IPC handlers inline in main** | All domains registered in one file | `ipc/*.ts` register functions; main only composes |
| **Config in god object** | providers + skills + wallpaper + media + permissions in one `config.json` | Split: `settings.json`, `providers.json`, `ui.json`; secrets out of plain config if possible |
| **Too many BrowserWindows early** | 7 window types | Start with main + optional overlay; add windows only when isolation is required |
| **Mixed memory write quality** | skill-store atomic vs memory/config non-atomic | Standardize on atomic everywhere |

---

## 6. Minimal module map suggestion for 俱佳Agent

Inspired by Yan-Agent, but modular from day one (TypeScript).

```
俱佳agent/
  package.json
  electron-builder.yml
  src/
    main/
      index.ts                 # app ready, single-instance, quit
      paths.ts                 # userData/JiaData + migration
      windows/
        main-window.ts
        overlay-window.ts      # optional later
      ipc/
        index.ts               # registerAll()
        config.ipc.ts
        session.ipc.ts
        agent.ipc.ts
        skills.ipc.ts
        memory.ipc.ts
        workspace.ipc.ts
        terminal.ipc.ts        # optional
      services/
        config-store.ts        # cached, mutex, atomic writes
        session-store.ts       # per-session JSON + summary cache
        memory-store.ts        # scoped facts + retrieval
        skill-registry.ts      # builtin + installed merge
        fs-atomic.ts           # writeAtomic(path, data)
      kernel/
        sidecar.ts             # process lifecycle only
        kernel-pool.ts
        run-orchestrator.ts    # run/cancel/permission/question
        event-batcher.ts
        prompt/
          system-parts.ts      # compose identity/tools/memory/workspace
        permissions.ts         # rule build + reply matching
      mcp/
        spawn.ts               # env injection, stdio MCP servers
        bridges/               # optional localhost token bridges
      preload.ts               # contextBridge expose api
    shared/
      ipc-contract.ts          # channel names + payload types
      types/
  renderer/
    index.html
    main/                      # UI app
    windows/                   # secondary windows if any
  resources/
    skills/
      builtin.json
      bundled/<skill>/SKILL.md
      bundled/<skill>.json
  test/
```

### Suggested runtime data layout
```
%userData%/JiaData/
  settings.json
  providers.json
  sessions/<id>.json
  memory.json
  SkillStore/{bundled,installed,staging,quarantine,index.json}
  kernel-runtime/              # isolated agent process homes
<workspace>/.jiaagent/
  memory.json
  snapshots/
```

### Implementation order for a learner
1. `paths + config-store (atomic, cached)`  
2. main window + preload contract  
3. session-store + session IPC  
4. kernel sidecar with one provider + event batcher  
5. agent IPC (start/cancel/stream)  
6. skills registry + SKILL.md injection  
7. memory store + selective prompt section  
8. MCP tools only after core loop is stable  

### One-line architecture thesis
> Keep **UI in Electron**, **agent intelligence in an isolated kernel process**, **tools as thin MCP**, **state in a stable data root with atomic writes**, and **IPC as a typed domain surface** — do not let main.js become the product.

---

## Source anchors (absolute paths)
- `D:\MiMo\ProjectOne\Yan-Agent\package.json`
- `D:\MiMo\ProjectOne\Yan-Agent\main.js`
- `D:\MiMo\ProjectOne\Yan-Agent\preload.js`
- `D:\MiMo\ProjectOne\Yan-Agent\lib\opencode-sidecar.js`
- `D:\MiMo\ProjectOne\Yan-Agent\lib\long-term-memory.js`
- `D:\MiMo\ProjectOne\Yan-Agent\lib\skill-registry.js`
- `D:\MiMo\ProjectOne\Yan-Agent\lib\skill-store.js`
- `D:\MiMo\ProjectOne\Yan-Agent\lib\yan-*-mcp.js`
- `D:\MiMo\ProjectOne\Yan-Agent\lib\skills\**`
- `D:\MiMo\ProjectOne\Yan-Agent\renderer\**`
