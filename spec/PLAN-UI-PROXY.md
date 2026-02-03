# svgpaper UI-Proxy RPC API 仕様（v0.1 Draft）

## 0. 目的
- 社内ツールとして **本番もUI-proxy方式**で運用する
- UIは“薄い殻”に留め、実処理は svgpaper（サーバ側）へ集約する
- UIとAPIの粗結合を成立させるために
  - **バージョン情報の提示**
  - **schemaのサーバ配布**
  - **validate/preview/inspect のサーバ実行**
  をAPIとして提供する

## 1. 方式
- HTTP サーバ（例：`http://127.0.0.1:8788`）
- UI は reverse proxy で別URLへ転送（例：`https://intra-ui.example/ui/v0.1/`）
- RPC は同一オリジンで `/rpc/*` に提供する（CORS不要）

### セキュリティ前提（必須）
- デフォルトは `127.0.0.1` バインド固定
- UI remote URL は allowlist（社内ドメイン固定）推奨
- ファイル操作は `workspace root` 配下に制限（パストラバーサル対策）
- 外部コマンド実行（pdf2svg/inkscape）はUIから直接呼ばず、サーバ側で制御

---

## 2. バージョン互換（粗結合の核）

### 2.1 /rpc/version（必須）
UIは起動時に必ず呼ぶ。UIとAPIの整合を確認する。

**Request**
- GET `/rpc/version`

**Response 200**
```json
{
  "app": {
    "name": "svgpaper",
    "version": "0.3.0"
  },
  "api": {
    "version": "rpc/v0.1"
  },
  "schemas": {
    "job": {
      "id": "svgreport-job/v0.1",
      "schema_id": "svgreport-job/v0.1.schema.json"
    },
    "template": {
      "id": "svgreport-template/v0.1",
      "schema_id": "svgreport-template/v0.1.schema.json"
    }
  },
  "capabilities": {
    "convert": true,
    "normalize": true,
    "validate": true,
    "preview": true,
    "inspectText": true,
    "generate": true,
    "wrap": false
  }
}
```

**互換ルール**
- UIは `api.version` が想定と異なる場合、警告を表示し操作を抑制してよい
- `capabilities` によりUIは機能の出し分けを行う

---

## 3. Schema配布（UIがschemaを持たない方針）

### 3.1 /rpc/schema/:name（必須）
UIがフォーム生成や補助バリデーションに使用する（最終validateはサーバ側）。

**Request**
- GET `/rpc/schema/job`
- GET `/rpc/schema/template`

**Response 200**
- JSON Schema 本体（そのまま返す）

---

## 4. ワークスペースとテンプレ資産

### 4.1 /rpc/workspace（推奨）
サーバが許容する作業ディレクトリ（root）を返す。

**Request**
- GET `/rpc/workspace`

**Response 200**
```json
{
  "root": "/home/user/projects/svgpaper",
  "templatesDirDefault": "templates",
  "outputDirDefault": "out"
}
```

### 4.2 /rpc/templates/list（推奨）
テンプレ一覧表示用（UIの便利機能）。※不要なら省略可

**Request**
- GET `/rpc/templates/list?baseDir=templates`

**Response 200**
```json
{
  "templates": [
    { "id": "invoice", "version": "v2", "path": "templates/invoice/v2" },
    { "id": "invoice", "version": "v3", "path": "templates/invoice/v3" }
  ]
}
```

---

## 5. Inspect Text（UIの中核）

### 5.1 /rpc/inspect-text（必須）
CLIの inspect-text 相当。UIはこれを呼んで候補一覧を作る。

**Request**
- POST `/rpc/inspect-text`
```json
{
  "path": "templates/invoice/v3/page-1.svg",
  "options": {
    "includePathTextWarnings": true,
    "suggestIds": true
  }
}
```

**Response 200**
```json
{
  "file": "templates/invoice/v3/page-1.svg",
  "page": { "widthMm": 210.0, "heightMm": 297.0 },
  "warnings": [
    { "code": "PATH_TEXT_DETECTED", "message": "Some text appears as paths." }
  ],
  "texts": [
    {
      "index": 1,
      "id": null,
      "suggestedId": "customer_name",
      "text": "__CUSTOMER_NAME__",
      "bbox": { "x": 20.0, "y": 30.0, "w": 60.0, "h": 5.0 },
      "position": { "x": 20.0, "y": 30.0 },
      "font": { "size": 12.0 }
    }
  ]
}
```

---

## 6. SVGへのid付与（UIがSVGファイルを編集する最小機能）

> 方針：GUIは“レイアウト編集”をしないが、**id付与だけは許可**する  
> ※ Inkscapeでの位置調整は別工程（手作業）にする

### 6.1 /rpc/svg/set-ids（推奨）
SVGの指定要素に id を付与する。重複チェック込み。

**Request**
- POST `/rpc/svg/set-ids`
```json
{
  "path": "templates/invoice/v3/page-1.svg",
  "assignments": [
    { "selector": { "byIndex": 1 }, "id": "customer_name" },
    { "selector": { "byXPath": "//*[@data-temp='x123']" }, "id": "issue_date" }
  ]
}
```

**Response 200**
```json
{
  "updated": true,
  "conflicts": [],
  "writtenPath": "templates/invoice/v3/page-1.svg"
}
```

**エラー例**
- 409 Conflict（id重複）
- 400 Bad Request（selector不正）

---

## 7. テンプレ生成（generate）

### 7.1 /rpc/generate（推奨）
CLIの generate 相当。UIからも作れるようにする。

**Request**
- POST `/rpc/generate`
```json
{
  "id": "invoice",
  "version": "v4",
  "baseDir": "templates",
  "pageTypes": ["first", "repeat"]
}
```

**Response 200**
```json
{
  "created": true,
  "templateDir": "templates/invoice/v4",
  "files": [
    "templates/invoice/v4/page-1.svg",
    "templates/invoice/v4/page-follow.svg",
    "templates/invoice/v4/template.json",
    "templates/invoice/v4/README.md"
  ]
}
```

---

## 8. Validate（必須：保存前に必ず実行）

### 8.1 /rpc/validate（必須）
CLIの validate 相当。UIは保存後やプレビュー前に必ず呼ぶ。

**Request**
- POST `/rpc/validate`
```json
{
  "templateDir": "templates/invoice/v3"
}
```

**Response 200**
```json
{
  "ok": false,
  "errors": [
    {
      "code": "SVG_ID_NOT_FOUND",
      "file": "page-follow.svg",
      "path": "fields[0].svg_id",
      "message": "customer_name not found in page-follow.svg"
    }
  ],
  "warnings": []
}
```

---

## 9. Preview（必須：現場合意のため）

### 9.1 /rpc/preview（必須）
CLIの preview 相当。UIは “Preview” ボタンで呼ぶ。

**Request**
- POST `/rpc/preview`
```json
{
  "templateDir": "templates/invoice/v3",
  "outputDir": "out/preview/invoice-v3",
  "sampleMode": "realistic",
  "options": {
    "emitSvgs": true,
    "emitDebug": true
  }
}
```

**Response 200**
```json
{
  "ok": true,
  "output": {
    "dir": "out/preview/invoice-v3",
    "html": "out/preview/invoice-v3/index.html",
    "pages": [
      "out/preview/invoice-v3/pages/page-001.svg",
      "out/preview/invoice-v3/pages/page-002.svg"
    ],
    "debug": [
      "out/preview/invoice-v3/debug/job.json",
      "out/preview/invoice-v3/debug/template.json"
    ]
  }
}
```

---

## 10. Template.json の読み書き（UIの編集対象）

### 10.1 /rpc/template/load（推奨）
**Request**
- POST `/rpc/template/load`
```json
{ "templateDir": "templates/invoice/v3" }
```

**Response 200**
```json
{
  "templateJson": { "schema": "...", "template": { "id": "...", "version": "..." }, "pages": [], "fields": [] }
}
```

### 10.2 /rpc/template/save（推奨）
**Request**
- POST `/rpc/template/save`
```json
{
  "templateDir": "templates/invoice/v3",
  "templateJson": { "...": "..." }
}
```

**Response 200**
```json
{ "saved": true, "path": "templates/invoice/v3/template.json" }
```

---

## 11. エラーモデル（共通）

### 11.1 エラーレスポンス（推奨）
- 4xx：入力不正、権限制限、競合
- 5xx：内部エラー、外部コマンド失敗

例：
```json
{
  "error": {
    "code": "EXTERNAL_TOOL_FAILED",
    "message": "pdf2svg failed",
    "details": {
      "engine": "pdf2svg",
      "exitCode": 1,
      "stderr": "..."
    }
  }
}
```

---

## 12. UI Proxy ルーティング（参考）

- `/` → UI remote URL（reverse proxy）
- `/rpc/*` → ローカルAPI（同一オリジン）

推奨：
- UI remote URL は固定（allowlist）し、実行時に任意変更できないようにする
- UI URL にバージョンを含める：
  - `https://intra-ui.example/svgpaper-ui/v0.1/`

---

## 13. 最小UI（MVP）で必要なRPC一覧

必須：
- GET `/rpc/version`
- GET `/rpc/schema/template`
- POST `/rpc/template/load`
- POST `/rpc/template/save`
- POST `/rpc/inspect-text`
- POST `/rpc/svg/set-ids`（id付与をGUIでやるなら）
- POST `/rpc/validate`
- POST `/rpc/preview`

任意（便利）：
- GET `/rpc/templates/list`
- POST `/rpc/generate`

---

## 14. 実装メモ（推奨アーキテクチャ）
- 既存 core（preview-generator / text-inspector / template-validator / template-generator）を
  RPCハンドラからそのまま呼ぶ（薄いHTTP層）
- UIは template.json の編集と “ボタンでRPC呼ぶ” に集中
- schema はサーバから配布し、UIは内蔵しない（粗結合維持）

