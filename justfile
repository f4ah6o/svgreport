# SVG Paper - Justfile
# タスクランナー設定

KCC_DIR := env_var_or_default('KCC_DIR', '../../kintone-control-center')
KINTONE_TMP_DIR := ".tmp/kintone"

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

# ==========================================
# kintone setup tasks (svgreport report-api/worker 向け)
# ==========================================

@kintone-preflight auth_item="kintone開発者アカウント" env_item="kintone帳票":
    #!/usr/bin/env bash
    set -euo pipefail
    command -v opz >/dev/null
    command -v aci >/dev/null
    test -d "{{KCC_DIR}}"
    test -f "{{KCC_DIR}}/aci.toml"
    mkdir -p "{{KINTONE_TMP_DIR}}"
    opz "{{auth_item}}" "{{env_item}}" -- bash -lc ': "${REPORT_TEMPLATE_APP_ID:?REPORT_TEMPLATE_APP_ID is required}"; : "${REPORT_JOB_APP_ID:?REPORT_JOB_APP_ID is required}"; [ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; node scripts/kintone/build-field-payloads.mjs --out-dir "{{KINTONE_TMP_DIR}}"'
    echo "Preflight OK (auth={{auth_item}}, env={{env_item}})"

kintone-plan auth_item="kintone開発者アカウント" env_item="kintone帳票":
    #!/usr/bin/env bash
    set -euo pipefail
    just kintone-preflight "{{auth_item}}" "{{env_item}}"
    mkdir -p "{{KINTONE_TMP_DIR}}"
    TEMPLATE_APP_ID="$(cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc 'printf "%s" "${REPORT_TEMPLATE_APP_ID}"')"
    JOB_APP_ID="$(cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc 'printf "%s" "${REPORT_JOB_APP_ID}"')"
    (cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc '[ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; aci --config aci.toml kintone getPreviewAppFormFields --app "${REPORT_TEMPLATE_APP_ID}"') > "{{KINTONE_TMP_DIR}}/template-current.json"
    (cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc '[ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; aci --config aci.toml kintone getPreviewAppFormFields --app "${REPORT_JOB_APP_ID}"') > "{{KINTONE_TMP_DIR}}/job-current.json"
    node scripts/kintone/diff-fields.mjs --label "template-app(${TEMPLATE_APP_ID})" --current "{{KINTONE_TMP_DIR}}/template-current.json" --desired "{{KINTONE_TMP_DIR}}/template-properties.json"
    node scripts/kintone/diff-fields.mjs --label "job-app(${JOB_APP_ID})" --current "{{KINTONE_TMP_DIR}}/job-current.json" --desired "{{KINTONE_TMP_DIR}}/job-properties.json"

kintone-apply-fields auth_item="kintone開発者アカウント" env_item="kintone帳票":
    #!/usr/bin/env bash
    set -euo pipefail
    just kintone-preflight "{{auth_item}}" "{{env_item}}"
    mkdir -p "{{KINTONE_TMP_DIR}}"
    TEMPLATE_APP_ID="$(cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc 'printf "%s" "${REPORT_TEMPLATE_APP_ID}"')"
    JOB_APP_ID="$(cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc 'printf "%s" "${REPORT_JOB_APP_ID}"')"
    (cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc '[ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; aci --config aci.toml kintone getPreviewAppFormFields --app "${REPORT_TEMPLATE_APP_ID}"') > "{{KINTONE_TMP_DIR}}/template-current.json"
    (cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc '[ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; aci --config aci.toml kintone getPreviewAppFormFields --app "${REPORT_JOB_APP_ID}"') > "{{KINTONE_TMP_DIR}}/job-current.json"
    node scripts/kintone/build-add-put-bodies.mjs --current "{{KINTONE_TMP_DIR}}/template-current.json" --desired "{{KINTONE_TMP_DIR}}/template-properties.json" --app "${TEMPLATE_APP_ID}" --out-add "{{KINTONE_TMP_DIR}}/template-add-body.json" --out-put "{{KINTONE_TMP_DIR}}/template-put-body.json"
    node scripts/kintone/build-add-put-bodies.mjs --current "{{KINTONE_TMP_DIR}}/job-current.json" --desired "{{KINTONE_TMP_DIR}}/job-properties.json" --app "${JOB_APP_ID}" --out-add "{{KINTONE_TMP_DIR}}/job-add-body.json" --out-put "{{KINTONE_TMP_DIR}}/job-put-body.json"
    TEMPLATE_ADD_BODY="$(cat {{KINTONE_TMP_DIR}}/template-add-body.json)"
    JOB_ADD_BODY="$(cat {{KINTONE_TMP_DIR}}/job-add-body.json)"
    TEMPLATE_PUT_BODY="$(cat {{KINTONE_TMP_DIR}}/template-put-body.json)"
    JOB_PUT_BODY="$(cat {{KINTONE_TMP_DIR}}/job-put-body.json)"
    (cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc '[ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; aci --config aci.toml kintone raw k v1 preview app form fields.json -X POST -d "$0"' "$TEMPLATE_ADD_BODY") > "{{KINTONE_TMP_DIR}}/template-add-result.json"
    (cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc '[ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; aci --config aci.toml kintone raw k v1 preview app form fields.json -X POST -d "$0"' "$JOB_ADD_BODY") > "{{KINTONE_TMP_DIR}}/job-add-result.json"
    (cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc '[ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; aci --config aci.toml kintone raw k v1 preview app form fields.json -X PUT -d "$0"' "$TEMPLATE_PUT_BODY") > "{{KINTONE_TMP_DIR}}/template-put-result.json"
    (cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc '[ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; aci --config aci.toml kintone raw k v1 preview app form fields.json -X PUT -d "$0"' "$JOB_PUT_BODY") > "{{KINTONE_TMP_DIR}}/job-put-result.json"
    DEPLOY_BODY="$(opz "{{auth_item}}" "{{env_item}}" -- node -e 'const t=Number(process.env.REPORT_TEMPLATE_APP_ID); const j=Number(process.env.REPORT_JOB_APP_ID); process.stdout.write(JSON.stringify({apps:[{app:t},{app:j}]}));')"
    (cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc '[ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; aci --config aci.toml kintone raw k v1 preview app deploy.json -X POST -d "$0"' "$DEPLOY_BODY") > "{{KINTONE_TMP_DIR}}/deploy-request-result.json"
    for i in $(seq 1 30); do
      (cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc '[ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; aci --config aci.toml kintone raw k v1 preview app deploy.json --query "apps='"${TEMPLATE_APP_ID}"'" --query "apps='"${JOB_APP_ID}"'"') > "{{KINTONE_TMP_DIR}}/deploy-status.json"
      if node scripts/kintone/check-deploy-status.mjs --file "{{KINTONE_TMP_DIR}}/deploy-status.json"; then
        echo "Deploy succeeded"
        exit 0
      fi
      status=$?
      if [ "$status" -ne 10 ]; then
        echo "Deploy failed"
        exit "$status"
      fi
      sleep 2
    done
    echo "Deploy polling timed out"
    exit 1

kintone-verify auth_item="kintone開発者アカウント" env_item="kintone帳票":
    #!/usr/bin/env bash
    set -euo pipefail
    just kintone-preflight "{{auth_item}}" "{{env_item}}"
    mkdir -p "{{KINTONE_TMP_DIR}}"
    TEMPLATE_APP_ID="$(cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc 'printf "%s" "${REPORT_TEMPLATE_APP_ID}"')"
    JOB_APP_ID="$(cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc 'printf "%s" "${REPORT_JOB_APP_ID}"')"
    (cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc '[ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; aci --config aci.toml kintone getPreviewAppFormFields --app "${REPORT_TEMPLATE_APP_ID}"') > "{{KINTONE_TMP_DIR}}/template-current.json"
    (cd "{{KCC_DIR}}" && opz "{{auth_item}}" "{{env_item}}" -- bash -lc '[ -n "${password:-}" ] || export password="${credential:-}"; : "${username:?username is required}"; : "${password:?password is required}"; aci --config aci.toml kintone getPreviewAppFormFields --app "${REPORT_JOB_APP_ID}"') > "{{KINTONE_TMP_DIR}}/job-current.json"
    node scripts/kintone/diff-fields.mjs --strict true --label "template-app(${TEMPLATE_APP_ID})" --current "{{KINTONE_TMP_DIR}}/template-current.json" --desired "{{KINTONE_TMP_DIR}}/template-properties.json"
    node scripts/kintone/diff-fields.mjs --strict true --label "job-app(${JOB_APP_ID})" --current "{{KINTONE_TMP_DIR}}/job-current.json" --desired "{{KINTONE_TMP_DIR}}/job-properties.json"
    echo "Verify OK"

kintone-setup auth_item="kintone開発者アカウント" env_item="kintone帳票":
    #!/usr/bin/env bash
    set -euo pipefail
    just kintone-plan "{{auth_item}}" "{{env_item}}"
    just kintone-apply-fields "{{auth_item}}" "{{env_item}}"
    just kintone-verify "{{auth_item}}" "{{env_item}}"
    echo "kintone setup completed for template/job apps"

# ==========================================
# kintone report e2e / cleanup / verify tasks
# ==========================================

@report-tsc:
    pnpm exec tsc --outDir .tmp/tsc --declaration false --declarationMap false --sourceMap false

report-e2e auth_item="kintone開発者アカウント" env_item="kintone帳票" source_app_id="45" source_record_id="1" template_code="demo_delivery_slip" action_code="todo_delivery":
    #!/usr/bin/env bash
    set -euo pipefail
    just report-tsc
    opz "{{auth_item}}" "{{env_item}}" -- node scripts/kintone/e2e-run.mjs \
      --source-app-id "{{source_app_id}}" \
      --source-record-id "{{source_record_id}}" \
      --template-code "{{template_code}}" \
      --action-code "{{action_code}}"

report-cleanup auth_item="kintone開発者アカウント" env_item="kintone帳票" source_app_id="45" source_record_id="1" action_codes="todo_delivery" template_codes="demo_delivery_slip,diag_delivery":
    #!/usr/bin/env bash
    set -euo pipefail
    opz "{{auth_item}}" "{{env_item}}" -- node scripts/kintone/cleanup-test-data.mjs \
      --source-app-id "{{source_app_id}}" \
      --source-record-id "{{source_record_id}}" \
      --action-codes "{{action_codes}}" \
      --template-codes "{{template_codes}}"

report-verify-template-api auth_item="kintone開発者アカウント" env_item="kintone帳票" source_app_id="45":
    #!/usr/bin/env bash
    set -euo pipefail
    just report-tsc
    opz "{{auth_item}}" "{{env_item}}" -- node scripts/kintone/verify-draft-publish.mjs \
      --source-app-id "{{source_app_id}}"
