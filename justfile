# SVG Paper - Justfile
# タスクランナー設定

# デフォルトタスク
_default:
    @just --list

# 依存関係のインストール
install:
    pnpm install

# TypeScriptのビルド
build:
    pnpm build

# 開発モード（ウォッチ）
dev:
    pnpm dev

# クリーン
@clean:
    rm -rf dist out test-job*.zip
    echo "Cleaned dist/, out/, and test zips"

# テストジョブZIPを作成（サンプル実行用）
@create-test-jobs:
    #!/usr/bin/env bash
    cd examples/invoice-job
    # シンプル版（2行）
    zip -j ../../test-job-simple.zip manifest.json meta.csv items.csv
    # 多ページ版（12行）
    zip -j ../../test-job-multi.zip manifest.json meta.csv items-multi.csv
    cd ../..
    echo "Created test-job-simple.zip and test-job-multi.zip"

# サンプル実行（シンプル版 - 1ページ）
run-simple: build create-test-jobs
    node dist/cli.js render test-job-simple.zip -o out

# サンプル実行（多ページ版 - 2ページ以上）
run-multi: build create-test-jobs
    node dist/cli.js render test-job-multi.zip -o out

# サンプルを実行してブラウザで開く（Linux用）
run-and-open: run-simple
    xdg-open out/2026-02-02T10_00_00+09_00__INV-0001/index.html

# サンプルを実行してブラウザで開く（macOS用）
run-and-open-mac: run-simple
    open out/2026-02-02T10_00_00+09_00__INV-0001/index.html

# 型チェック（TypeScript）
typecheck:
    pnpm typecheck

# リント（oxlint）
lint:
    pnpm lint

# リント自動修正
lint-fix:
    pnpm run lint:fix

# 品質チェック（全て）
check: typecheck lint

# テスト（未実装）
test:
    pnpm test

# 完全リセット
@reset: clean
    rm -rf node_modules pnpm-lock.yaml
    echo "Full reset complete. Run 'just install' to reinstall."

# ビルドとサンプル実行（開発用ワンライナー）
quickstart: install build run-simple
    @echo "Quickstart complete! Check the out/ directory."

# RPCサーバーを開発モードで起動（自動リロードなし）
# 使用例: just dev-server
# 使用例: just dev-server 8888 ./templates
serve:
    node dist/cli.js server -p 8788 -r .

# RPCサーバー（カスタム設定）
# 使用例: just server 8888 /workspace/templates
server port="8788" root=".":
    node dist/cli.js server -p {{port}} -r {{root}}

# devモードでサーバー起動（ビルド+サーバー起動）
dev-server: build
    node dist/cli.js server -p 8788 -r .

# UIをビルド
build-ui:
    cd ui && pnpm install && pnpm build

# UI開発モード（Vite dev server）
dev-ui:
    cd ui && pnpm dev

# フルビルド（API + UI）
build-all: build build-ui
    @echo "Full build complete"

# UI付きで開発（RPCサーバー + UIビルド）
dev-with-ui: build build-ui
    @echo "Starting RPC server with UI..."
    @echo "Open ui/dist/index.html in a browser after server starts"
    node dist/cli.js server -p 8788 -r .

# UIリバースプロキシ付きでサーバー起動
# 使用例: just server-with-ui
# 使用例: just server-with-ui http://localhost:3000 8888 ./templates
server-with-ui url="http://localhost:3000" port="8788" root=".":
    node dist/cli.js server -p {{port}} -r {{root}} --ui-remote-url {{url}}

# UIリバースプロキシ付きで開発モード（ビルド + サーバー起動）
dev-server-with-ui: build
    node dist/cli.js server -p 8788 -r . --ui-remote-url http://localhost:3000
