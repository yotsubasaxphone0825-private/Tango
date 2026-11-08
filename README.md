# マイ単語帳

語学（スペイン語・英語など）とIT用語を、意味・用法・自作の例文と一緒に覚えるための個人用単語帳アプリです。

- `index.html` だけで動きます（ブラウザで開くだけ）
- 過去問PDFなどの資料から用語を選んで追加できます
- 間隔反復で復習のタイミングを自動調整します
- Supabase と同期して、複数の端末で使えます（`supabase/schema.sql` を SQL Editor で実行）

## 辞書データ（`dict/`）
- `dict/es/`：[Wiktionary](https://en.wiktionary.org/)（CC BY-SA 4.0）を [kaikki.org](https://kaikki.org/)（wiktextract）経由で加工
- `dict/en/`：[EJDict](https://github.com/kujirahand/EJDict)（パブリックドメイン）
- 作り直すとき：`node tools/build_dict.js es <kaikki.org-dictionary-Spanish.jsonl.gz> dict/es` ／ `node tools/build_dict.js en <EJDict/src> dict/en`
