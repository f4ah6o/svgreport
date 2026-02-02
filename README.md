# SVG Report
<!-- bdg:begin -->
[![npm](https://img.shields.io/npm/v/svgreport.svg)](https://www.npmjs.com/package/svgreport)
<!-- bdg:end -->

svgreport is a CLI and library for generating printable reports using SVG templates.

## Overview

This tool enables the following workflow:

1. Field staff submit forms created in Excel as PDF
2. IT department converts PDF to SVG templates
3. n8n or similar tools convert business data to CSV (metadata/detail data)
4. Report engine flows data into SVG templates and outputs HTML
5. Print from browser or save as PDF

## Features

- **Declarative Templates**: SVG elements referenced by id attributes, data binding defined in template.json
- **Pagination Support**: Use different SVG templates for first page and subsequent pages
- **Variable Details**: Automatic page splitting based on number of detail rows
- **Browser Printing**: Generates optimized HTML, can be saved as PDF via print dialog
- **Type Safety**: TypeScript implementation with JSON Schema input validation

## Installation

```bash
pnpm install
pnpm build
```

## Usage

### Template Development Workflow

```bash
# 1. Convert PDF to SVG (auto-selects pdf2svg/inkscape)
svgreport convert agreed.pdf ./raw/

# 2. Normalize SVG (unify mm units, expand transforms, cleanup)
svgreport normalize ./raw/ ./normalized/ -s a4

# 3. Generate new template (create boilerplate)
svgreport generate invoice v3 -d ./templates

# 4. Inspect text elements and identify ID candidates
svgreport inspect-text ./templates/invoice/v3/page-1.svg

# 5. Define fields in template.json, then validate
svgreport validate ./templates/invoice/v3/

# 6. Generate preview (check with dummy data)
svgreport preview ./templates/invoice/v3/ -o ./preview -s realistic
```

### Rendering (Production Data)

```bash
# Render single job
svgreport render job.zip

# Specify output directory
svgreport render job.zip -o ./reports

# Specify template directory
svgreport render job.zip -t ./templates
```

### Creating Test Data

```bash
# Create test job zip (2 detail rows)
pnpx ts-node scripts/create-test-job.ts

# Multi-page test (12 detail rows)
pnpx ts-node scripts/create-test-job.ts items-multi.csv
```

## File Structure

### Job ZIP Structure

```
job.zip
├── manifest.json    # Job definition (schema, template, inputs)
├── meta.csv         # Metadata (key-value format)
└── items.csv        # Detail data (table format)
```

### Template Structure

```
templates/invoice/v2/
├── template.json    # Template settings (pages, fields, tables)
├── page-1.svg       # First page SVG
└── page-follow.svg  # Subsequent pages SVG
```

## Data Formats

### meta.csv (KV Format)

```csv
key,value
customer.name,Sample Company Inc.
customer.address,123 Main St...
invoice_no,INV-0001
issue_date,2026-02-02
total_amount,123456
```

### items.csv (Table Format)

```csv
name,price,qty
Product A,100,2
Product B,200,1
```

## Architecture

```
src/
├── core/
│   ├── datasource.ts          # CSV parser (KV/Table)
│   ├── manifest.ts            # manifest.json validation/loading
│   ├── template.ts            # template.json validation/loading
│   ├── template-validator.ts  # Template validation (schema + SVG refs)
│   ├── template-generator.ts  # New template boilerplate generation
│   ├── formatter.ts           # Date/number/currency formatting
│   ├── paginator.ts           # Page splitting logic (pure function)
│   ├── svg-engine.ts          # SVG manipulation (@xmldom/xmldom + xpath)
│   ├── svg-normalizer.ts      # SVG normalization (mm units, transform, cleanup)
│   ├── text-inspector.ts      # Text element extraction/analysis
│   ├── pdf-converter.ts       # PDF→SVG conversion (pdf2svg/inkscape)
│   ├── renderer.ts            # Orchestrator
│   ├── preview-generator.ts   # Preview generation (dummy data)
│   ├── html-writer.ts         # HTML generation
│   └── zip-handler.ts         # ZIP loading
├── types/
│   └── index.ts               # Type definitions
├── cli.ts                     # CLI entry point
└── index.ts                   # Library exports
```

## Available Commands

| Command | Description | Example |
|---------|-------------|---------|
| `render` | Render job ZIP | `svgreport render job.zip` |
| `convert` | PDF→SVG conversion (auto fallback) | `svgreport convert input.pdf ./output/` |
| `normalize` | SVG normalization | `svgreport normalize ./raw/ ./norm/ -s a4` |
| `validate` | Template validation | `svgreport validate ./templates/inv/v1/` |
| `preview` | Preview generation | `svgreport preview ./templates/inv/v1/` |
| `inspect-text` | Text element analysis | `svgreport inspect-text page-1.svg -j out.json` |
| `generate` | New template generation | `svgreport generate invoice v1 -d ./templates` |

## Output Structure

```
out/
└── <job_id>/
    ├── index.html              # Print-ready HTML
    ├── pages/
    │   ├── page-001.svg       # Individual SVG
    │   └── page-002.svg
    └── debug/                  # Debug info
        ├── job.json
        ├── template.json
        └── render.json
```

## License

MIT


