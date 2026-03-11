---
name: kintone-template-mapping
description: Configure kintone app field bindings for this svgreport project. Use when creating or updating report template JSON mapping (`mapping.kv_bindings`, `mapping.table.source.field_code`, `mapping.table.columns[].expr`), checking how kintone record fields flow into report data, or validating where mappings are stored in template management apps.
---

# Kintone Template Mapping

## Workflow

1. Confirm mapping schema in `src/types/reporting.ts`.
2. Edit template JSON `mapping` fields:
   - `mapping.kv_bindings`: map regular kintone fields to report KV keys.
   - `mapping.table.source.field_code`: choose the subtable field code.
   - `mapping.table.columns[].expr`: map subtable columns with expressions like `row("fieldCode")`.
3. Verify runtime behavior in `src/kintone/report-mapping.ts`.
4. Keep rendering bindings separate:
   - SVG element bindings are defined by `render.fields` and `render.pages[].tables`.
5. For kintone operation, store the report template JSON in the template management app `templateJson` field.

## Quick Checks

- Check that every `kv_bindings[].key` is used by the render template.
- Check that `table.source.field_code` matches an existing subtable field code.
- Check that `columns[].expr` references valid row or record field codes.
- Check that mapping output shape matches the expected renderer sources (`meta`, `items`).
