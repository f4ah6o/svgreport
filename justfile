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

# デモ：UI込みでサンプルを試す（ビルド + 統合サーバー + ブラウザ起動）
# 使用例: just demo
# 使用例: just demo test-templates/delivery-slip/v1
demo template="test-templates/delivery-slip/v1": build build-ui
    @echo "================================================"
    @echo "  SVG Paper Demo"
    @echo "================================================"
    @echo ""
    @echo "Starting integrated server..."
    @echo "  - RPC API: http://127.0.0.1:8788/rpc/"
    @echo "  - UI:      http://127.0.0.1:8788/"
    @echo "  - Sample:  {{template}}"
    @echo ""
    @echo "Press Ctrl+C to stop"
    @echo ""
    node dist/cli.js server -p 8788 -r . --ui-static-dir ./ui/dist

# デモ（開発モード: Vite dev + RPC reverse proxy）
# 使用例: just demo-dev
demo-dev port="8788" root=".":
    #!/usr/bin/env bash
    set -euo pipefail
    echo "================================================"
    echo "  SVG Paper Demo (Dev Mode)"
    echo "================================================"
    echo ""
    echo "Starting Vite dev server (http://localhost:3000) ..."
    (cd ui && pnpm install && pnpm dev) &
    UI_PID=$!
    cleanup() {
      kill "${UI_PID}" 2>/dev/null || true
    }
    trap cleanup EXIT INT TERM
    sleep 1
    echo ""
    echo "Starting RPC server with UI reverse proxy..."
    echo "  - RPC API: http://127.0.0.1:{{port}}/rpc/"
    echo "  - UI:      http://127.0.0.1:{{port}}/"
    echo ""
    echo "Press Ctrl+C to stop"
    echo ""
    pnpm build
    node dist/cli.js server -p {{port}} -r {{root}} --ui-remote-url http://localhost:3000

# デモ（ブラウザ自動起動付き - Linux）
demo-linux template="test-templates/delivery-slip/v1": build build-ui
    @echo "Starting demo server..."
    @xdg-open http://127.0.0.1:8788/ &
    node dist/cli.js server -p 8788 -r . --ui-static-dir ./ui/dist

# デモ（ブラウザ自動起動付き - macOS）  
demo-mac template="test-templates/delivery-slip/v1": build build-ui
    @echo "Starting demo server..."
    @open http://127.0.0.1:8788/
    node dist/cli.js server -p 8788 -r . --ui-static-dir ./ui/dist
