# toho-plot — 歩き旅ブログの地図ビューア

はてなブログの歩き旅記事に記録した「🚶‍♂️現在地」リンクを本文順に抽出し、地点間の**推定**徒歩ルートと一緒に地図に表示します。

- 独立URLで共有でき、同じページをiframeでブログに埋め込めます。
- 更新はGitHub Actionsの手動実行（またはiPhoneのショートカット）で行います。閲覧者のアクセスでは記事取得もルート計算も行いません。
- 徒歩ルートは記録地点間をルーティングAPIで推定したものです。実際に歩いた道やGPS軌跡ではありません。

設計の背景は [PLAN.md](PLAN.md) を参照してください。

## 仕組み

```
iOSショートカット / Run workflow
  → GitHub Actions (update-map.yml)
  → 記事取得・解析 → 保存済み区間と照合 → 未計算・変更区間だけ徒歩APIへ
  → generated-data ブランチへ保存 → 静的ビューアをビルド → GitHub Pages へ公開

閲覧: 共有URL / iframe → 静的ビューア → 生成済みJSON → Leaflet
```

| 場所 | 内容 |
| --- | --- |
| `trips.json` | 公開対象の記事（旅）の設定 |
| `overrides/<tripId>.json` | 区間ごとの補助経由点 |
| `src/generator/` | 記事取得・解析・ルート計算・キャッシュ・CLI |
| `src/shared/` | 型・スキーマ・座標変換（GeoJSON `[経度,緯度]` ⇔ Leaflet `[緯度,経度]`） |
| `src/viewer/` | 地図ビューア（Vite + vanilla TypeScript + Leaflet） |
| `tests/` | テストとfixture |
| `generated-data` ブランチ | `schema-version.json`、`trips/<tripId>/trip.json`、`routes/<cacheKey>.json` |

`generated-data` ブランチの内容は、リポジトリが公開なら誰でも読めます。APIキーや記事のraw HTMLは保存しません。

## 初期設定

GitHub側で次の設定が必要です。

1. **リポジトリを作成してpush**
   ```sh
   git remote add origin git@github.com:<owner>/<repo>.git
   git push -u origin main
   ```
2. **GitHub Pagesの公開元をGitHub Actionsにする**
   Settings → Pages → Build and deployment → Source を「GitHub Actions」にします。
3. **徒歩ルーティングAPIのキーを取得してSecretに登録**
   [account.heigit.org](https://account.heigit.org/signup) でアカウントを作り、openrouteservice の Standard キーを取得します。
   Settings → Secrets and variables → Actions → Secrets に `ROUTING_API_KEY` として登録します。
4. **（任意）Variablesを設定**（Settings → Secrets and variables → Actions → Variables）

   | 名前 | 用途 | 未設定時 |
   | --- | --- | --- |
   | `ROUTING_API_BASE_URL` | ルーティングAPIのベースURL | `https://api.openrouteservice.org` |
   | `SITE_URL` | Job Summaryに出す公開URL（例 `https://<owner>.github.io/<repo>/`） | 表示しない |
   | `PAGES_BASE_PATH` | ビルドのbase path | `./`（相対パス。通常は設定不要） |
   | `TILE_URL` / `TILE_ATTRIBUTION` | 地図タイルのURLと出典表示（HTML可） | OpenStreetMap標準タイル |

5. **最初の更新を実行**
   Actions → Update map → Run workflow で `trip_id` を指定して実行します。初回は `generated-data` ブランチが自動作成されます。

### 公開URL

GitHub Pagesのサブディレクトリ配信 (`https://<owner>.github.io/<repo>/`) で、そのまま動きます。

| 用途 | URL |
| --- | --- |
| 通常 | `https://<owner>.github.io/<repo>/?trip=<tripId>` |
| 埋め込み | `https://<owner>.github.io/<repo>/?trip=<tripId>&embed=1` |
| 地点を指定 | 上記の末尾に `#point=<pointId>` |
| 旅の一覧 | `https://<owner>.github.io/<repo>/` |

地点別URLは、画面の「この地点のURLをコピー」で取得できます。

### ブログへの埋め込み

はてなブログの編集画面で「HTML編集」に切り替え、次を貼り付けます。

```html
<iframe
  src="https://<owner>.github.io/<repo>/?trip=takamatsu-tokushima-20260315&embed=1"
  title="歩き旅の地図"
  style="width: 100%; height: 480px; border: 0;"
  loading="lazy"
></iframe>
```

埋め込み表示では、初期状態だと地図のドラッグ・ホイール・タッチ操作が無効になり、ブログのスクロールが優先されます。地図を動かすには「地図を操作する」を押し、終わったら「操作を終了」を押します。「大きな地図で開く」で通常表示が別タブで開きます。表示中のiframeは自動では更新されません。最新版は再読み込みで取得されます。

## 出先からの更新（iPhoneショートカット）

### 1. トークンを作る

GitHub → Settings → Developer settings → Fine-grained personal access tokens で作成します。

- Repository access: **このリポジトリだけ**
- Repository permissions: **Actions: Read and write**（他は不要）
- 有効期限は短め（例: 90日）にし、期限が来たら作り直してください。

トークンはショートカット内に保存され、端末上で閲覧できます。秘密として扱い、README、リポジトリ、ブログ、iframeのURLには書かないでください。トークン入りのショートカットは共有しないでください。

### 2. ショートカットを作る

「ショートカット」アプリで新規作成し、次のアクションを並べます。

1. **メニューから選択**（または「テキスト」）: tripId を選びます。例: `takamatsu-tokushima-20260315`
2. **URL**: `https://api.github.com/repos/<owner>/<repo>/actions/workflows/update-map.yml/dispatches`
3. **URLの内容を取得**
   - 方法: `POST`
   - ヘッダ:
     - `Authorization`: `Bearer <トークン>`
     - `Accept`: `application/vnd.github+json`
     - `X-GitHub-Api-Version`: `2026-03-10`
   - 本文を要求: `JSON`
     - `ref`（テキスト）: `main`
     - `inputs`（辞書）: `trip_id` = 1で選んだ値
4. **辞書の値を取得**: キー `html_url`（API版 `2026-03-10` では受付時に実行のURLが返ります）
5. **if**（入力が値を持つ場合）
   - **通知を表示**: 「地図更新を受け付けました」
   - **URLを開く**: 4の値（Actionsの実行画面）
   - **それ以外**: 「URLの内容を取得」の結果をそのまま表示（エラー内容の確認用）

受付は公開の完了ではありません。完了はActionsの実行画面、または地図の「地図データ更新日時」で確認してください。数分で終わります。自動ポーリングはしません。

最初はショートカットを使わず、GitHubの Actions → Update map → Run workflow で動作を確認するのがおすすめです。

## 日常の操作

### 記事を追記した後

ショートカット、または Run workflow で `trip_id` を指定して実行します。追記された地点の区間だけAPIで計算されます。Job Summaryに、地点数、再利用した区間数、APIで計算した区間数、推定距離、確認が必要な箇所が出ます。

### 新しい記事（旅）を追加する

`trips.json` に追記してmainへpushします。

```json
{
  "tripId": "英小文字・数字・ハイフン",
  "title": "記事タイトル",
  "articleUrl": "https://todays-mitsui.hatenablog.com/entry/...",
  "journeyDate": "YYYY-MM-DD",
  "timeZone": "Asia/Tokyo",
  "routingProfile": "foot-walking"
}
```

- `journeyDate` は旅の日付です。記事の公開日とは別に指定します。
- 日付をまたいだ地点は自動では推測しません。`"dateOverrides": { "<pointId>": "YYYY-MM-DD" }` で指定します。時刻が逆転するとJob Summaryに警告が出ます。
- 他の記事への自動巡回はしません。公開する記事はここに登録したものだけです。

### 不自然なルートを補正する（補助経由点）

`overrides/<tripId>.json` に、区間の両端の地点IDと、経由させたい地点を `[緯度, 経度]`（Google Mapsと同じ順）で書きます。

```json
{
  "segments": [
    {
      "fromPointId": "20260315060000-1417-1",
      "toPointId": "20260315060000-1458-1",
      "via": [[34.1768, 134.5801]],
      "note": "峠道を通す"
    }
  ]
}
```

mainへpushした後に更新を実行すると、その区間だけ再計算されます。地点IDは `記事ID-HHMM-同時刻内の出現順` です。画面の「この地点のURLをコピー」で得られるURLの `#point=` の後ろ、または `npm run parse` の出力で確認できます。

Job Summaryの「確認が必要な箇所」には、直線距離の3倍を超える迂回や、記録地点から100m以上離れた道路へのスナップが出ます。これは確認の目安です。実際の道が違うと断定するものではありません。

### 全区間を再計算する

Run workflow で `force_reroute` をオンにします。対象の旅の全区間をAPIで計算し直します。

### 地点を削除した

前回より地点数が減ると、誤解析の可能性があるため公開を止めます。意図した削除なら `allow_removal` をオンにして実行します。

### エラーの確認

Actionsの実行ログとJob Summaryを見ます。

| 症状 | 原因と対処 |
| --- | --- |
| `未登録のtripIdです` | `trips.json` の tripId と一致しているか確認 |
| `未対応の「現在地」リンクです` | 短縮URLなど、`?q=緯度,経度` 形式でない現在地リンクがあります。記事のリンクを直してください。黙って欠落させることはしません |
| `時刻 (HH:MM) が見つかりません` | 「現在地」と同じ段落に時刻を書いてください |
| `地点数が…に減りました` | 上の「地点を削除した」を参照 |
| `ROUTING_API_KEY が設定されていません` / `認証エラー (401)` | Secretを確認 |
| `アクセス拒否 (403)` | 日次上限超過の可能性。24時間後に再実行 |
| `レート制限 (429)` | Retry-Afterに従って自動で再試行します |
| `ルート取得失敗 (404)` など | 地点が道路から350m以上離れている可能性。補助経由点で調整 |

途中で失敗しても、公開中の地図はそのまま残ります。失敗までに取得できた区間のルートは `generated-data` に保存されるので、再実行でAPI呼び出しを繰り返しません。初回の公開前に失敗した場合は、地図は公開されません。直線などで代用することはしません。

保存には成功したのに公開（deploy）だけ失敗した場合は、同じ `trip_id` で再実行してください。内容に変更がなくても毎回デプロイします。

## ローカル開発

Node.js 24（Active LTS）以上が必要です。

```sh
npm ci
npm test              # 外部APIは叩かない（fixtureを使用）
npm run typecheck

# 記事を解析して地点JSONを表示（--html-file でローカルHTMLを使う）
npm run parse -- --trip takamatsu-tokushima-20260315 --html-file tests/fixtures/takamatsu-tokushima-day2.html

# 生成データを作る（ROUTING_API_KEY が必要。data/ に出力）
ROUTING_API_KEY=... npm run update -- --trip takamatsu-tokushima-20260315 --data-dir data

# generated-data を取ってきてビューアを確認
git fetch origin generated-data
git worktree add --detach data FETCH_HEAD
npm run build && npm run preview
```

### 実APIの疎通確認

通常のテストとは分けています。海沿い・峠・吉野川付近の区間を実際に計算し、推定距離と直線距離の比を表示します。データは保存しません。

```sh
ROUTING_API_KEY=... npm run routing:check -- --trip takamatsu-tokushima-20260315 \
  --html-file tests/fixtures/takamatsu-tokushima-day2.html --out /tmp/check.geojson
```

`--out` のGeoJSONを [geojson.io](https://geojson.io) などに読み込むと、経路を目視で確認できます。既定の区間は、海沿い（08:43→09:11）、峠（14:17→14:58）、インターチェンジ（17:09→17:26）、吉野川（17:26→17:44）です。`ROUTING_CHECK_PAIRS=4,17,21,22`（区間の始点の0始まりの番号）で変えられます。

## 徒歩ルーティングAPI（openrouteservice）

確認日: 2026-10-25

| 項目 | 内容 | 出典 |
| --- | --- | --- |
| エンドポイント | `POST /v2/directions/{profile}/geojson`。応答はFeatureCollection（LineString、`properties.summary.distance/duration`） | [Directions: Requests and Return Types](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/requests-and-return-types) |
| ホスト・認証 | `https://api.openrouteservice.org`、`Authorization` ヘッダーにAPIキー（キーなしで401 `Authorization field missing` を実地確認） | 実地確認 |
| 座標順 | `[経度, 緯度]`。道路へのスナップ距離の上限は350m | [FAQ](https://giscience.github.io/openrouteservice/frequently-asked-questions) |
| 上限 | Directions 2,000件/日・40件/分（Standard）。日次超過は403、分間超過は429。日次の枠は最初のリクエストから24時間でリセット | 同FAQ |
| キーの扱い | キーは個人に属し、クライアント側に置かない（サーバー側から呼ぶ） | 同FAQ |
| プロファイル | `foot-walking` | **未確認**（実APIで要確認） |
| 保存・再配信条件、必須の出典表示、無料枠の利用条件 | — | **未確認**（下記） |

この実装では、APIは逐次で呼び、呼び出しの間隔を1.6秒以上空けます。429のときは `Retry-After` に従い、タイムアウト・5xxは最大3回まで再試行します。401・403・400・404は再試行しません。

**未確認事項:** 2026-10-25時点で openrouteservice.org のサイトは停止中でした（PHPの問題によるとの告知あり）。そのため利用規約・プランのページ（ルート結果の長期保存、公開リポジトリと静的サイトでの再配信、必須の出典表示、無料枠の条件）を確認できていません。出典表示は暫定で `© openrouteservice.org by HeiGIT | Map data © OpenStreetMap contributors` としています（`src/generator/routing/openrouteservice.ts` の `ORS_SPEC`）。サイトが復旧したら規約を確認し、条件がこの構成（generated-dataへの保存とPagesでの配信）に合わない場合は、プロバイダーを再検討してください。プロバイダーの差し替えは `RoutingProvider` を実装した adapter を追加し、`src/generator/update.ts` で切り替えます。PLAN.mdの方針どおり、Google Routesの結果をLeaflet上に描画したり永続保存したりする構成には切り替えません。

## 地図タイル

既定はOpenStreetMap標準タイル (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) です。[タイル利用ポリシー](https://operations.osmfoundation.org/policies/tiles/)（2026-10-25確認）に従い、次の点を守っています。地図上に出典を表示すること、ブラウザのRefererを送ること（`referrerpolicy` で止めない）、先読みや一括ダウンロードをしないこと。閲覧が増えた場合や、ポリシーが変わった場合は、Variablesの `TILE_URL` / `TILE_ATTRIBUTION` で別のタイル提供元に切り替えてください。

## 検証状況

### 自動テスト（`npm test`、外部API不使用）

- 実記事fixture（2026-10-25取得、27地点）から、順序・時刻・座標・写真・コメントを抽出できること
- 行程のGoogle Mapsリンクや、まとめの写真を地点と誤認しないこと
- 写真なし、コメントなし、同一時刻、同一座標、位置修正、引用内リンク、日付補正を扱えること
- 不正なq、短縮URL、時刻なし、本文スコープなし、0地点で停止すること
- 変更なしではAPI呼び出しが0回で、`generatedAt` も変わらないこと
- 末尾追記で新規区間だけ、中間の座標修正で隣接2区間だけ、補助経由点の変更で対象区間だけ計算すること。写真・コメントだけの変更ではルートを再利用すること
- 429のRetry-After、5xxの再試行上限、401/403/400/404で再試行しないこと
- 途中のAPI失敗で公開用データを変更せず、取得済みルートを保存して再利用すること
- 別の旅のデータとルートキャッシュを消さないこと

`tests/fixtures/ors-directions-geojson.synthetic.json` は応答形式を模した合成データで、実APIの応答ではありません。

### 手動確認（実施済み）

- ヘッドレスChromeでの確認。ルートなし・ピンのみの確認用データを、`/<repo>/` 相当のサブディレクトリ配信で表示した
  - 1280px幅と375px幅の通常表示、375px幅・高さ480pxの埋め込み表示（横スクロールなし）
  - 地点別URLでの選択、ピンとカードの選択の連動
  - 埋め込みでの「地図を操作する」「操作を終了」（ドラッグ等の有効化と無効化、フォーカス移動）、前後移動、「大きな地図で開く」のURL（embedなし、地点ハッシュ付き）
  - 未知のtripIdでのエラー表示と記事一覧
- `generated-data` 操作（初回のorphan作成、2回目以降の最新取得とpush、競合時にnon-fast-forwardで拒否されること）を、ローカルのbareリポジトリで再現

### 未実施（要確認）

- **実APIでの疎通と経路の妥当性**（APIキー未取得のため）→ `npm run routing:check`
- **openrouteserviceの利用規約の確認**（サイト停止中のため）
- GitHub上でのworkflow実行とPages公開、実際の公開レスポンスでのiframe表示（X-Frame-Options / CSP frame-ancestors が埋め込みを妨げないこと）
- はてなブログのHTML編集・プレビューでの埋め込み表示、実機iPhoneでの操作とショートカット
- 1地点を追記してActionsを起動し、新規区間だけ計算されること（実環境）
- API失敗後に前回の公開ページが表示されること（実環境）
- dist・生成データ・ログに秘密が含まれないこと（workflowで `ROUTING_API_KEY` の文字列を検査するステップあり）
