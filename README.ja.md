# SVG Report

SVG帳票生成ツール - PDFベースのSVGテンプレートにCSVデータを流し込み印刷

## 概要

このツールは以下のワークフローを実現します：

1. 現場がExcelで作成した帳票をPDFで提出
2. システム部門がPDFをSVGテンプレートに変換
3. n8nなどが業務データをCSV（メタデータ/明細データ）に変換
4. 帳票エンジンがSVGテンプレートにデータを流し込み、HTML出力
5. ブラウザで印刷またはPDF保存

## 特徴

- **宣言的テンプレート**: SVGはid属性で要素を参照、データバインディングはtemplate.jsonで定義
- **ページング対応**: 1枚目と2枚目以降で異なるSVGテンプレートを使用可能
- **可変明細**: 明細行数に応じて自動ページ分割
- **ブラウザ印刷**: 最適化されたHTMLを生成、印刷ダイアログでPDF化可能
- **型安全性**: TypeScript実装、JSON Schemaによる入力検証

## インストール

```bash
pnpm install
pnpm build
```

## 使い方

### テンプレート開発ワークフロー

```bash
# 1. PDFからSVGを変換（pdf2svg/inkscape自動選択）
svgreport convert agreed.pdf ./raw/

# 2. SVGを正規化（mm統一、transform展開、クリーンアップ）
svgreport normalize ./raw/ ./normalized/ -s a4

# 3. 新規テンプレートを生成（雛形作成）
svgreport generate invoice v3 -d ./templates

# 4. テキスト要素を確認・ID付与の候補を確認
svgreport inspect-text ./templates/invoice/v3/page-1.svg

# 5. template.jsonにフィールドを定義後、検証
svgreport validate ./templates/invoice/v3/

# 6. プレビュー生成（ダミーデータで確認）
svgreport preview ./templates/invoice/v3/ -o ./preview -s realistic
```

### GUIでのPDFテンプレ化

1. `just demo` で統合サーバーを起動（`http://127.0.0.1:8788/`）
2. 画面右上の「`PDF取込`」からPDFをアップロード
3. `template.id` / `version` を確認して作成
4. 作成後はGraph画面でそのままバインディングを編集

注記:
- GUI取込はPDFを自動でSVG化+正規化し、`templates/<id>/<version>/` を生成します。
- 複数ページPDFは `1ページ目=first`、`2ページ目=repeat` を採用し、3ページ目以降は警告付きで無視します。

### レンダリング（本番データ）

```bash
# 単一ジョブのレンダリング
svgreport render job.zip

# 出力先を指定
svgreport render job.zip -o ./reports

# テンプレートディレクトリを指定
svgreport render job.zip -t ./templates
```

### テストデータの作成

```bash
# テストジョブzipを作成（明細2行）
pnpx ts-node scripts/create-test-job.ts

# 多ページテスト（明細12行）
pnpx ts-node scripts/create-test-job.ts items-multi.csv
```

## ファイル構成

### ジョブZIP構造

```
job.zip
├── manifest.json    # ジョブ定義（schema, template, inputs）
├── meta.csv         # メタデータ（key-value形式）
└── items.csv        # 明細データ（テーブル形式）
```

### テンプレート構造

```
templates/invoice/v2/
├── template.json    # テンプレート設定（pages, fields, tables）
├── page-1.svg       # 1枚目のSVG
└── page-follow.svg  # 2枚目以降のSVG
```

## データ形式

### meta.csv（KV形式）

```csv
key,value
customer.name,株式会社サンプル
customer.address,東京都新宿区...
invoice_no,INV-0001
issue_date,2026-02-02
total_amount,123456
```

### items.csv（テーブル形式）

```csv
name,price,qty
商品A,100,2
商品B,200,1
```

## アーキテクチャ

```
src/
├── core/
│   ├── datasource.ts          # CSVパーサー（KV/Table）
│   ├── manifest.ts            # manifest.json検証・読込
│   ├── template.ts            # template.json検証・読込
│   ├── template-validator.ts  # テンプレート検証（schema + SVG参照）
│   ├── template-generator.ts  # 新規テンプレート雛形生成
│   ├── template-importer.ts   # PDF取込→テンプレ生成
│   ├── formatter.ts           # 日付・数値・通貨フォーマット
│   ├── paginator.ts           # ページ分割ロジック（純関数）
│   ├── svg-engine.ts          # SVG操作（@xmldom/xmldom + xpath）
│   ├── svg-normalizer.ts      # SVG正規化（mm統一、transform、クリーン）
│   ├── text-inspector.ts      # テキスト要素抽出・分析
│   ├── pdf-converter.ts       # PDF→SVG変換（pdf2svg/inkscape）
│   ├── renderer.ts            # オーケストレーター
│   ├── preview-generator.ts   # プレビュー生成（ダミーデータ）
│   ├── html-writer.ts         # HTML生成
│   └── zip-handler.ts         # ZIP読込
├── kintone/
│   ├── report-api-server.ts   # kintone連携向け帳票APIサーバー
│   ├── report-worker.ts       # キューを処理してPDF生成/アップロード
│   ├── kintone-rest.ts        # kintone REST APIラッパー
│   ├── kintone-job-queue.ts   # ジョブキューApp操作
│   ├── kintone-template-store.ts # 公開テンプレート解決
│   └── report-mapping.ts      # kintoneレコード→帳票データ変換
├── types/
│   └── index.ts               # 型定義
├── cli.ts                     # CLIエントリーポイント
└── index.ts                   # ライブラリエクスポート
```

## 利用可能なコマンド

| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `render` | ジョブZIPをレンダリング | `svgreport render job.zip` |
| `convert` | PDF全ページ→SVG変換（auto fallback） | `svgreport convert input.pdf ./output/` |
| `normalize` | SVG正規化 | `svgreport normalize ./raw/ ./norm/ -s a4` |
| `validate` | テンプレート検証 | `svgreport validate ./templates/inv/v1/` |
| `preview` | プレビュー生成 | `svgreport preview ./templates/inv/v1/` |
| `inspect-text` | テキスト要素分析 | `svgreport inspect-text page-1.svg -j out.json` |
| `generate` | 新規テンプレート生成 | `svgreport generate invoice v1 -d ./templates` |

## 出力構造

```
out/
└── <job_id>/
    ├── index.html              # 印刷用HTML
    ├── pages/
    │   ├── page-001.svg       # 個別SVG
    │   └── page-002.svg
    └── debug/                  # デバッグ情報
        ├── job.json
        ├── template.json
        └── render.json
```

## kintone帳票セットアップ（justタスク）

`kintone-control-center` と `opz` を使って、帳票テンプレ管理App/ジョブ履歴Appの必須フィールドを更新できます。

前提:
- 1Password アイテム `kintone開発者アカウント` に `KINTONE_BASE_URL` / `username` / `password` が存在
- 1Password アイテム `kintone帳票` に `REPORT_TEMPLATE_APP_ID` / `REPORT_JOB_APP_ID` / `REPORT_*_FIELD_*` が存在

実行:

```bash
# 差分確認のみ
just kintone-plan

# フィールド更新 + deploy
just kintone-apply-fields

# 反映後の厳密検証
just kintone-verify

# 一括実行
just kintone-setup
```

引数でアイテムを変える場合:

```bash
just kintone-setup "kintone開発者アカウント" "kintone帳票"
```

## kintone帳票E2E/検証/クリーンアップ

`report-api` / `report-worker` の疎通確認用タスクです。

```bash
# 1) E2E（テンプレdraft/publish + ジョブ投入 + PDF添付確認）
just report-e2e

# 2) テストデータのクリーンアップ（失敗ジョブ・テストテンプレ・テスト添付）
just report-cleanup

# 3) draft/publish API の単体検証
just report-verify-template-api
```

補足:
- `KCC_DIR` は環境変数で上書き可能です（未指定時は従来パス）。
- 1Password 経由で実行するため `.env` は不要です。

## ライセンス

MIT
