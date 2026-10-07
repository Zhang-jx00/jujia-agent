# 依赖许可证清单（自动生成）

> 由 `npm run license:check` 生成。**不要手改**——重新运行即可更新。
> 规则：强 copyleft（GPL/AGPL/SSPL）= 硬拒绝；LGPL/MPL/CC-BY = 需声明义务；其余按各自许可。
> 归类看 SPDX 表达式的**任意位置**（`Apache-2.0 AND LGPL-3.0-or-later` 也算需声明），不只看开头。

> **本表覆盖整个 `node_modules`（共 523 个去重依赖），分两节**：
> **§A 随安装包分发**（40 个 —— copyleft 的关注点全在这一节）；
> **§B 仅构建期 · 不随包分发**（483 个 —— 按开源合规惯例保留声明即可，不删条目）。
> 划分口径：`package-lock.json` 每条的 `dev` 标记（npm 安装时算出来的可达性，peer / optional 都算过）。
> 唯一一条手动覆盖：`electron` —— 见脚本注释。判不准的条目一律留在 §A。

## §A 随安装包分发（40 个）

### MIT（30 个）

- @jujia/agent-core@0.0.1
- @jujia/desktop@0.52.0
- @jujia/shared@0.0.1
- @jujia/shared-ipc@0.0.1
- @jujia/ui-tokens@0.0.1
- @napi-rs/canvas@1.0.9
- @napi-rs/canvas-win32-x64-msvc@1.0.9
- @types/d3-color@3.1.3
- @types/d3-drag@3.0.7
- @types/d3-interpolate@3.0.4
- @types/d3-selection@3.0.12
- @types/d3-transition@3.0.9
- @types/d3-zoom@3.0.9
- @types/react@19.3.0
- @types/react-dom@19.3.0
- @xterm/addon-fit@0.11.0
- @xterm/xterm@6.0.0
- @xyflow/react@12.12.0
- @xyflow/system@0.0.83
- classcat@5.0.5
- csstype@3.2.3
- electron@44.4.2
- node-addon-api@7.1.1
- node-pty@1.1.0
- react@19.3.0
- react-dom@19.3.0
- scheduler@0.28.0
- use-sync-external-store@1.7.0
- zod@3.25.76
- zustand@4.5.7

### ISC（8 个）

- d3-color@3.1.0
- d3-dispatch@3.0.1
- d3-drag@3.0.0
- d3-interpolate@3.0.1
- d3-selection@3.0.0
- d3-timer@3.0.1
- d3-transition@3.0.1
- d3-zoom@3.0.0

### BSD-3-Clause（1 个）

- d3-ease@3.0.1

### Apache-2.0（1 个）

- pdfjs-dist@6.3.289

## §B 仅构建期 · 不随包分发（483 个）

### MIT（367 个）

- @asamuzakjp/css-color@7.1.2
- @asamuzakjp/dom-selector@9.2.2
- @babel/code-frame@7.29.7
- @babel/compat-data@7.29.7
- @babel/core@7.29.7
- @babel/generator@7.29.8
- @babel/helper-compilation-targets@7.29.7
- @babel/helper-globals@7.29.7
- @babel/helper-module-imports@7.29.7
- @babel/helper-module-transforms@7.29.7
- @babel/helper-plugin-utils@7.29.7
- @babel/helper-string-parser@7.29.7
- @babel/helper-validator-identifier@7.29.7
- @babel/helper-validator-option@7.29.7
- @babel/helpers@7.29.7
- @babel/parser@7.29.8
- @babel/plugin-transform-arrow-functions@7.29.7
- @babel/plugin-transform-react-jsx-self@7.29.7
- @babel/plugin-transform-react-jsx-source@7.29.7
- @babel/runtime@7.29.7
- @babel/template@7.29.7
- @babel/traverse@7.29.8
- @babel/types@7.29.8
- @bramus/specificity@2.4.2
- @cacheable/memory@2.2.0
- @cacheable/utils@2.5.0
- @csstools/css-calc@3.4.1
- @csstools/css-color-parser@4.2.4
- @csstools/css-parser-algorithms@4.0.1
- @csstools/css-tokenizer@4.0.2
- @electron/asar@3.4.1
- balanced-match@1.0.2
- brace-expansion@1.1.21
- @electron/fuses@1.8.0
- fs-extra@9.1.0
- @electron/get@5.1.0
- @electron/notarize@2.5.0
- isbinaryfile@4.0.10
- @electron/rebuild@4.2.0
- @electron/universal@2.0.3
- brace-expansion@2.1.7
- fs-extra@11.4.0
- @emnapi/runtime@1.11.3
- @esbuild/win32-x64@0.28.2
- @eslint/js@10.0.1
- @eslint-community/eslint-utils@4.10.1
- @eslint-community/regexpp@4.12.2
- @exodus/bytes@1.16.0
- @img/colour@1.1.0
- @jridgewell/gen-mapping@0.3.13
- @jridgewell/remapping@2.3.5
- @jridgewell/resolve-uri@3.1.2
- @jridgewell/sourcemap-codec@1.6.0
- @jridgewell/trace-mapping@0.3.31
- @esbuild/win32-x64@0.25.12
- @rolldown/pluginutils@1.0.0-rc.3
- @vitejs/plugin-react@5.2.0
- electron-vite@5.0.0
- esbuild@0.25.12
- magic-string@0.30.21
- vite@7.3.6
- @keyv/bigmap@1.3.1
- @keyv/serialize@1.1.1
- @malept/flatpak-bundler@0.4.0
- @noble/hashes@2.4.0
- @oxc-project/types@0.150.0
- @peculiar/asn1-schema@2.9.4
- @peculiar/json-schema@1.1.12
- @peculiar/utils@2.0.3
- @peculiar/webcrypto@1.7.1
- @rolldown/binding-win32-x64-msvc@1.2.9
- @rolldown/pluginutils@1.0.1
- @rollup/rollup-win32-x64-gnu@4.63.3
- @rollup/rollup-win32-x64-msvc@4.63.3
- @sindresorhus/is@4.6.0
- @szmarczak/http-timer@4.0.6
- @testing-library/dom@10.4.2
- @testing-library/react@16.3.3
- @types/aria-query@5.0.4
- @types/babel__core@7.20.5
- @types/babel__generator@7.27.0
- @types/babel__template@7.4.4
- @types/babel__traverse@7.28.0
- @types/cacheable-request@6.0.3
- @types/chai@5.2.3
- @types/debug@4.1.13
- @types/deep-eql@4.0.2
- @types/esrecurse@4.3.1
- @types/estree@1.0.9
- @types/fs-extra@9.0.13
- @types/http-cache-semantics@4.2.0
- @types/json-schema@7.0.15
- @types/keyv@3.1.4
- @types/ms@2.1.0
- @types/node@26.6.1
- @types/responselike@1.0.3
- @typescript-eslint/eslint-plugin@8.70.0
- ignore@7.0.9
- @typescript-eslint/parser@8.70.0
- @typescript-eslint/project-service@8.70.0
- @typescript-eslint/scope-manager@8.70.0
- @typescript-eslint/tsconfig-utils@8.70.0
- @typescript-eslint/type-utils@8.70.0
- @typescript-eslint/types@8.70.0
- @typescript-eslint/typescript-estree@8.70.0
- @typescript-eslint/utils@8.70.0
- @typescript-eslint/visitor-keys@8.70.0
- @vitest/mocker@5.0.1
- @vitest/spy@5.0.1
- @xmldom/xmldom@0.8.15
- acorn@8.18.0
- acorn-jsx@5.3.2
- agent-base@7.1.4
- ajv@6.15.0
- ansi-regex@5.0.1
- ansi-styles@4.3.0
- app-builder-lib@26.15.3
- @electron/get@3.1.0
- fs-extra@8.1.0
- ajv@8.20.0
- ci-info@4.3.1
- env-paths@2.2.1
- json-schema-traverse@1.0.0
- jsonfile@4.0.0
- universalify@0.1.2
- assertion-error@2.0.1
- async@3.2.6
- async-exit-hook@2.0.1
- asynckit@0.4.0
- aws4@1.13.2
- balanced-match@4.0.4
- base64-js@1.5.1
- bidi-js@1.1.0
- bluebird@3.7.2
- boolean@3.2.0
- brace-expansion@5.0.12
- browserslist@4.29.0
- buffer-from@1.1.2
- builder-util@26.15.3
- builder-util-runtime@9.7.0
- cac@6.7.14
- cacheable@2.5.0
- cacheable-lookup@5.0.4
- cacheable-request@7.0.4
- keyv@4.5.4
- call-bind-apply-helpers@1.0.2
- chai@6.2.2
- chalk@4.1.2
- chromium-pickle-js@0.2.0
- ci-info@4.4.0
- clone-response@1.0.3
- color-convert@2.0.1
- color-name@1.1.4
- combined-stream@1.0.8
- commander@5.1.0
- compare-version@0.1.2
- concat-map@0.0.1
- convert-source-map@2.0.0
- core-util-is@1.0.3
- cross-dirname@0.1.0
- cross-spawn@7.0.6
- css-tree@3.2.1
- data-urls@7.0.0
- whatwg-url@16.0.1
- debug@4.4.3
- decimal.js@10.6.0
- decompress-response@6.0.0
- mimic-response@3.1.0
- deep-is@0.1.4
- defer-to-connect@2.0.1
- define-data-property@1.1.4
- define-properties@1.2.1
- delayed-stream@1.0.0
- dequal@2.0.3
- detect-node@2.1.0
- dir-compare@4.2.0
- dmg-builder@26.15.3
- dom-accessibility-api@0.5.16
- dunder-proto@1.0.1
- @types/node@24.13.5
- undici-types@7.18.2
- electron-builder@26.15.3
- electron-builder-squirrel-windows@26.15.3
- electron-publish@26.15.3
- electron-winstaller@5.4.0
- fs-extra@7.0.1
- emoji-regex@8.0.0
- end-of-stream@1.4.5
- env-paths@3.0.0
- err-code@2.0.3
- es-define-property@1.0.1
- es-errors@1.3.0
- es-module-lexer@2.3.2
- es-object-atoms@1.1.2
- es-set-tostringtag@2.1.0
- es6-error@4.1.1
- esbuild@0.28.2
- escalade@3.2.0
- escape-string-regexp@4.0.0
- eslint@10.10.0
- estree-walker@3.0.3
- fast-deep-equal@3.1.3
- fast-json-stable-stringify@2.1.0
- fast-levenshtein@2.0.6
- fdir@6.5.0
- file-entry-cache@11.1.5
- find-up@5.0.0
- flat-cache@6.1.23
- form-data@4.0.6
- fs-extra@10.1.0
- function-bind@1.1.2
- gensync@1.0.0-beta.2
- get-intrinsic@1.3.0
- get-proto@1.0.1
- get-stream@5.2.0
- globalthis@1.0.4
- gopd@1.2.0
- got@11.8.6
- has-flag@4.0.0
- has-property-descriptors@1.0.2
- has-symbols@1.1.0
- has-tostringtag@1.0.2
- hashery@1.5.1
- hasown@2.0.4
- hookified@1.15.1
- html-encoding-sniffer@7.0.0
- http-proxy-agent@7.0.2
- http2-wrapper@1.0.3
- https-proxy-agent@7.0.6
- ignore@5.3.2
- imurmurhash@0.1.4
- is-extglob@2.1.1
- is-fullwidth-code-point@3.0.0
- is-glob@4.0.3
- is-potential-custom-element-name@1.0.1
- isarray@1.0.0
- isbinaryfile@5.0.7
- jiti@2.7.0
- js-tokens@4.0.0
- js-yaml@4.3.2
- jsdom@30.1.1
- undici@8.11.2
- jsesc@3.1.0
- json-buffer@3.0.1
- json-schema-traverse@0.4.1
- json-stable-stringify-without-jsonify@1.0.1
- json5@2.2.3
- jsonfile@6.2.1
- keyv@5.6.0
- lazy-val@1.0.5
- levn@0.4.1
- locate-path@6.0.0
- lodash@4.18.1
- lowercase-keys@2.0.0
- lz-string@1.5.0
- magic-string@1.4.1
- matcher@3.0.0
- math-intrinsics@1.1.0
- mime@2.6.0
- mime-db@1.52.0
- mime-types@2.1.35
- mimic-response@1.0.1
- minimist@1.2.8
- minizlib@3.1.0
- mkdirp@0.5.6
- ms@2.1.3
- nanoid@3.3.19
- natural-compare@1.4.0
- node-abi@4.35.0
- node-api-version@0.2.1
- node-gyp@12.4.0
- undici@6.28.1
- node-int64@0.4.0
- node-releases@2.0.56
- normalize-url@6.1.0
- object-keys@1.1.1
- obug@2.2.1
- optionator@0.9.4
- p-cancelable@2.1.1
- p-limit@3.1.0
- p-locate@5.0.0
- parse5@8.0.1
- path-exists@4.0.0
- path-is-absolute@1.0.1
- path-key@3.1.1
- pe-library@0.4.1
- picomatch@4.0.7
- @noble/hashes@1.4.0
- plist@3.1.0
- postcss@8.5.28
- postject@1.0.0-alpha.6
- commander@9.5.0
- prelude-ls@1.2.1
- prettier@3.9.8
- pretty-format@27.5.1
- ansi-styles@5.2.0
- process-nextick-args@2.0.1
- progress@2.0.3
- promise-retry@2.0.1
- proper-lockfile@4.1.2
- pump@3.0.4
- punycode@2.3.1
- pvtsutils@1.3.6
- pvutils@1.2.0
- qified@0.10.1
- hookified@2.2.0
- quick-lru@5.1.1
- react-is@17.0.2
- react-refresh@0.18.0
- read-binary-file-arch@1.0.6
- readable-stream@2.3.8
- require-directory@2.1.1
- require-from-string@2.0.2
- resedit@1.7.2
- resolve-alpn@1.2.1
- responselike@2.0.1
- retry@0.12.0
- rolldown@1.2.9
- rollup@4.63.3
- safe-buffer@5.1.2
- semver-compare@1.0.0
- serialize-error@7.0.1
- shebang-command@2.0.0
- shebang-regex@3.0.0
- simple-update-notifier@2.0.0
- source-map-support@0.5.21
- stackback@0.0.2
- stat-mode@1.0.0
- std-env@4.2.0
- string-width@4.2.3
- string_decoder@1.1.1
- strip-ansi@6.0.1
- supports-color@7.2.0
- temp@0.9.4
- temp-file@3.4.0
- tiny-async-pool@1.3.0
- tinybench@6.1.4
- tinyexec@1.3.0
- tinyglobby@0.2.17
- tldts@7.4.16
- tldts-core@7.4.16
- tmp@0.2.7
- tmp-promise@3.0.3
- tr46@6.0.0
- ts-api-utils@2.5.0
- type-check@0.4.0
- typescript-eslint@8.70.0
- undici@7.29.1
- undici-types@8.9.0
- universalify@2.0.1
- unzipper@0.12.5
- fs-extra@11.3.1
- update-browserslist-db@1.3.3
- util-deprecate@1.0.2
- vite@8.3.0
- vitest@5.0.1
- w3c-xmlserializer@6.0.0
- webcrypto-core@1.9.2
- whatwg-mimetype@5.0.0
- whatwg-url@17.1.2
- why-is-node-running@2.3.0
- word-wrap@1.2.5
- wrap-ansi@7.0.0
- xmlbuilder@15.1.1
- xmlchars@2.2.0
- yargs@17.7.3
- yocto-queue@0.1.0

### ISC（41 个）

- semver@6.3.1
- minimatch@3.1.5
- minimatch@9.0.9
- @isaacs/fs-minipass@4.0.1
- abbrev@4.0.0
- semver@7.7.4
- which@5.0.0
- at-least-node@1.0.0
- cliui@8.0.1
- electron-to-chromium@1.5.431
- minimatch@5.1.9
- flatted@3.4.4
- fs.realpath@1.0.0
- get-caller-file@2.0.5
- glob@7.2.3
- glob-parent@6.0.2
- graceful-fs@4.2.11
- hosted-git-info@4.1.0
- lru-cache@6.0.0
- yallist@4.0.0
- inflight@1.0.6
- inherits@2.0.4
- isexe@2.0.0
- json-stringify-safe@5.0.1
- lru-cache@5.1.1
- which@6.0.1
- nopt@9.0.0
- once@1.4.0
- picocolors@1.1.1
- proc-log@6.1.0
- rimraf@2.6.3
- saxes@6.0.0
- semver@7.8.5
- siginfo@2.0.0
- signal-exit@3.0.7
- semver@5.7.2
- which@2.0.2
- wrappy@1.0.2
- y18n@5.0.8
- yallist@3.1.1
- yargs-parser@21.1.1

### Apache-2.0（26 个）

- @eslint/config-array@0.23.5
- @eslint/config-helpers@0.7.0
- @eslint/core@1.2.1
- @eslint/object-schema@3.0.5
- @eslint/plugin-kit@0.7.3
- eslint-visitor-keys@3.4.3
- @humanfs/core@0.19.2
- @humanfs/node@0.16.8
- @humanfs/types@0.15.0
- @humanwhocodes/module-importer@1.0.1
- @humanwhocodes/retry@0.4.3
- @malept/cross-spawn-promise@2.0.0
- aria-query@5.3.0
- baseline-browser-mapping@2.11.25
- detect-libc@2.1.2
- ejs@3.1.10
- eslint-visitor-keys@5.0.1
- expect-type@1.4.0
- exponential-backoff@3.1.3
- filelist@1.0.6
- jake@10.9.4
- playwright-core@1.63.0
- sharp@0.35.4
- sumchecker@3.0.1
- typescript@6.0.3
- xml-name-validator@5.0.0

### BSD-2-Clause（14 个）

- @electron/osx-sign@1.3.3
- @electron/windows-sign@1.2.2
- @electron-internal/extract-zip@1.0.5
- dotenv@16.6.1
- dotenv-expand@11.0.7
- entities@8.1.0
- eslint-scope@9.1.2
- espree@11.2.0
- esrecurse@4.3.0
- estraverse@5.3.0
- esutils@2.0.3
- http-cache-semantics@4.2.0
- uri-js@4.4.1
- webidl-conversions@8.0.1

### BSD-3-Clause（12 个）

- asn1js@3.0.10
- bytestreamjs@2.0.1
- duplexer2@0.1.4
- esquery@1.7.0
- fast-uri@3.1.8
- global-agent@3.0.0
- pkijs@3.4.0
- roarr@2.15.4
- source-map@0.6.1
- source-map-js@1.2.1
- sprintf-js@1.1.3
- tough-cookie@6.0.2

### BlueOak-1.0.0（9 个）

- lru-cache@11.5.3
- isexe@3.1.5
- chownr@3.0.0
- minimatch@10.2.6
- minipass@7.1.3
- isexe@4.0.0
- sax@1.6.1
- tar@7.5.22
- yallist@5.0.0

### MIT-0（2 个）

- @csstools/color-helpers@6.1.2
- @csstools/css-syntax-patches-for-csstree@1.1.14

### MPL-2.0（2 个）

- lightningcss@1.33.0
- lightningcss-win32-x64-msvc@1.33.0

### Apache-2.0 AND LGPL-3.0-or-later AND MIT（1 个）

- @img/sharp-wasm32@0.35.4

### Apache-2.0 AND LGPL-3.0-or-later（1 个）

- @img/sharp-win32-x64@0.35.4

### Python-2.0（1 个）

- argparse@2.0.1

### CC-BY-4.0（1 个）

- caniuse-lite@1.0.30001810

### CC0-1.0（1 个）

- mdn-data@2.27.1

### WTFPL OR ISC（1 个）

- sanitize-filename@1.6.4

### WTFPL（1 个）

- truncate-utf8-bytes@1.0.2

### 0BSD（1 个）

- tslib@2.8.1

### (MIT OR CC0-1.0)（1 个）

- type-fest@0.13.1

### (WTFPL OR MIT)（1 个）

- utf8-byte-length@1.0.5

