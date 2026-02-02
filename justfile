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

# リント
lint:
    pnpm run lint

# テスト（未実装）
test:
    pnpm run test

# 完全リセット
@reset: clean
    rm -rf node_modules pnpm-lock.yaml
    echo "Full reset complete. Run 'just install' to reinstall."

# ビルドとサンプル実行（開発用ワンライナー）
quickstart: install build run-simple
    @echo "Quickstart complete! Check the out/ directory."
