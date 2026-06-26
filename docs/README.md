# STARGLOW NOW — 最新情報まとめアプリ

STARGLOW（BMSG）の最新情報を、**完全無料**で自動集約するアプリです。
ニュース・YouTube などを定期的に収集し、**情報の信頼度（公式 / 大手 / 未確認）** を
バッジ表示して、ガセネタを見分けやすくします。情報源にはワンタッチで飛べます。

iPhone の Safari で開き「ホーム画面に追加」すると、**アプリのように**起動できます（PWA）。

## 仕組み（すべて無料）

```
GitHub Actions（3時間ごと）
   └─ collector/collect.py が
        ・Google ニュース RSS
        ・YouTube 公式チャンネル RSS
      を収集 → 信頼度を採点 → docs/data/feed.json を生成
   └─ docs/ を GitHub Pages として公開
                │
          iPhone / ブラウザ（PWA）が feed.json を読んで表示
```

- サーバー代・API 料金は **0円**（GitHub の無料枠のみ）
- X(Twitter)/Instagram は公式 API が有料・制限のため、本文取得はせず
  **公式アカウントへのリンク**で対応しています。

## 初回セットアップ（1回だけ・無料）

1. GitHub リポジトリの **Settings → Pages** を開く
2. **Build and deployment → Source** を **GitHub Actions** に設定
3. **Actions** タブで `STARGLOW NOW - 収集とデプロイ` を一度 **Run workflow**
4. 数十秒後、表示された Pages の URL（`https://<ユーザー名>.github.io/<リポジトリ名>/`）を
   iPhone の Safari で開く
5. 共有ボタン →「ホーム画面に追加」でアプリ化

## カスタマイズ

- 収集対象・検索ワード・信頼ドメインの調整: `collector/collect.py` 冒頭の設定部分
- 公式リンク・デザイン: `docs/index.html` / `docs/styles.css`
- 収集間隔: `.github/workflows/starglow-pages.yml` の `cron`

## 注意

信頼度はあくまで自動判定の目安です。最終的な事実確認は公式情報をご参照ください。
