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
├── types/
│   └── index.ts               # 型定義
├── cli.ts                     # CLIエントリーポイント
└── index.ts                   # ライブラリエクスポート
```

## 利用可能なコマンド

| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `render` | ジョブZIPをレンダリング | `svgreport render job.zip` |
| `convert` | PDF→SVG変換（auto fallback） | `svgreport convert input.pdf ./output/` |
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

## ライセンス

MIT
