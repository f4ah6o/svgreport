# delivery-slip vv1

## 概要

このテンプレートは「delivery-slip」帳票用のSVGテンプレートです。

## ファイル構成

- page-1.svg: 1枚目のページ
- page-follow.svg: 2枚目以降のページ
- template.json: テンプレート設定
- README.md: このファイル

## 編集手順

1. SVGファイルを編集（Inkscapeなど）
2. 差し込み対象のテキスト要素にIDを付与
3. template.jsonにフィールドバインディングを定義
4. `svgpaper validate` で検証
5. `svgpaper preview` でプレビュー確認

## 仕様

- ページサイズ: A4 (210x297mm)
- 座標系: 左上原点
- 行テンプレートID: row-template
- ページ番号ID: page_no

## 注意事項

- IDにはASCII文字（a-z, A-Z, 0-9, _, -）のみ使用
- 全角文字や空白を含むIDは自動的に変換されます
- row-template内の要素はデータバインディング対象になります
