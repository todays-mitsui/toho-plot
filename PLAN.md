# 歩き旅ブログの地図ビューア — Claude Code実装計画

作成日: 2026-10-25（JST）

## 0. この計画の使い方

このファイルを実装対象リポジトリの PLAN.md に置き、Claude Codeに「PLAN.mdに従って実装してください」と依頼する。

まず既存のREADME、AGENTS.md、実装、ワークフローを読み、既存構成があれば尊重する。本書は新規実装の推奨構成であり、既存リポジトリの構成を無断で置き換えない。APIキーやGitHubの公開設定など、ユーザーによる設定が必要な箇所は明示する。未取得のAPI結果を作ったり、直線を徒歩ルートとして表示したりしない。

## 1. 目的・要件

はてなブログの歩き旅記事に記録された位置情報を本文順に抽出し、地点間の推定徒歩ルートを地図上に表示する。独立URLで共有でき、同じビューアをiframeでブログに埋め込めるようにする。

出先ではブログを追記した後、iPhoneから更新を起動できるようにする。閲覧者のアクセスではルート計算を起動しない。

### ユーザーが求めていること

- 本文に登場する位置情報を、記事に記載された順番でプロット。
- 直線ではなく、推定でよいので徒歩ルートに沿った線を表示。
- 地図を独立URLで共有し、iframeでも埋め込み。
- 出先から更新可能。
- Claude Codeで実装できる具体的な計画。

### 本計画で採用する設計上のデフォルト

以下は会話で挙がった候補から選んだ実装案であり、既に構築済みではない。

- TypeScript、Node.jsの実装時点のアクティブLTS、npm。
- HTML解析: Cheerio。
- 地図: Leaflet。UIはVite + vanilla TypeScriptで始める。
- 徒歩ルーティング: openrouteserviceを第一候補。差し替え可能な小さなadapterを置く。
- 公開: GitHub Pages。
- 更新: GitHub Actionsのworkflow_dispatch。
- iPhone: ショートカットからGitHub REST APIでworkflow_dispatchを呼ぶ。
- 計算済みデータ: 専用のgenerated-dataブランチに保存。
- 定期実行、自前の更新サーバー、DB、管理画面はMVPに含めない。

## 2. 対象記事と確認済みの形式

初期対象:
https://todays-mitsui.hatenablog.com/entry/2026/03/15/060000

記事タイトル: 徒歩旅日記 (高松→徳島) - 2日目

会話時点のページ確認では、07:06〜18:27の「🚶‍♂️現在地」が27件。これは固定の仕様ではなく、初期検証の目安とする。実装時にHTMLを取得し、DOM構造と件数を再確認する。

リンクの例:
https://www.google.com/maps?q=34.24345725635057,134.3609731123187

- qパラメータに緯度・経度が入っている。
- 時刻、写真、コメントが付近にある。
- ログは区切り線で分割されている。
- 本文には行程案のGoogle Mapsリンクなど、記録地点以外のリンクもある。
- 公開日と旅の日付を同一視せず、旅の日付は設定に明示する。

第1話・他の記事への自動巡回は行わない。複数記事を追加できる設定形式は用意する。

## 3. 実装前に行う小さな技術検証

### 3.1 徒歩APIの採用条件

実装時点の公式ドキュメントで次を確認し、READMEに確認日と出典を記録する。

- 現行エンドポイント、認証方法、徒歩プロファイル。
- 呼び出し上限、レート制限、タイムアウト。
- 取得ルートの長期保存と、公開リポジトリ・静的サイトでの再配信条件。
- 必須の出典・ライセンス表示。
- 無料枠を含む利用条件。
- 対象地域で徒歩ルートが取得できること。

openrouteserviceの古いエンドポイントや料金・制約を記憶で固定しない。海沿い、峠、吉野川付近の数区間を実際に試して、取得成功と経路の妥当性を確認する。APIキーがなければadapterとfixtureによる実装を進め、実API検証は未完了と明記する。

保存・再配信条件がこの構成に合わない場合は、条件を満たすプロバイダーを検討する。Google Routesの結果を無条件でLeaflet上に描画・永続保存する構成へ切り替えない。セルフホストはMVPの必須要件にしない。

### 3.2 埋め込みの確認

GitHub Pagesの実際の公開レスポンスとブログのプレビューでiframe表示を検証する。X-Frame-OptionsやCSP frame-ancestorsが埋め込みを妨げていないことを確認する。HTMLのmetaタグでこれらのレスポンスヘッダーを解決しようとしない。

## 4. 全体構成

更新系:
iOSショートカット / GitHubのRun workflow
→ GitHub Actions
→ 記事取得・解析
→ 保存済み区間との照合
→ 未計算・変更区間のみ徒歩APIへ
→ 検証済みデータを保存
→ 静的ビューアをビルド
→ GitHub Pagesへ公開

閲覧系:
共有URL / ブログのiframe
→ 静的ビューア
→ 生成済みJSONを読み込み
→ Leafletで描画

公開側から記事取得や徒歩API呼び出しを行わない。これによりブログ取得のCORS問題、APIキー露出、閲覧数に比例したルーティング要求を避ける。

## 5. リポジトリ構成案

- PLAN.md
- README.md
- package.json / package-lock.json / tsconfig.json
- trips.json: 公開対象記事の設定
- overrides/: 区間ごとの補助経由点
- src/generator/: fetch、parse、route、cache、validate、CLI
- src/shared/: 型、スキーマ、座標変換
- src/viewer/: 地図、地点カード、埋め込みモード
- scripts/: ビルド用データの配置など
- tests/fixtures/: 記事HTMLとAPI応答のfixture
- tests/: parser、差分計算、失敗時処理
- .github/workflows/update-map.yml
- .github/workflows/ci.yml

generated-dataブランチ:
- schema-version.json
- trips/<tripId>/trip.json
- routes/<cacheKey>.json

dist/はビルド生成物。公開成果物にAPIキー、raw HTML、内部ログ、不要なキャッシュを含めない。generated-dataが公開リポジトリ内にある場合、その内容も公開される前提で扱う。

## 6. 設定・データモデル

### 記事設定

trips.jsonにtripId、title、articleUrl、journeyDate、timeZone、routingProfileを持たせる。

初期設定例:
- tripId: takamatsu-tokushima-20260315
- articleUrl: 対象記事URL
- journeyDate: 2026-03-15
- timeZone: Asia/Tokyo
- routingProfile: foot-walking（API採用時に正式名称を確認）

workflowの入力は登録済みtripIdを基本とする。新規記事は設定に追加する。任意URLの入力サービスや任意ホストのfetchは実装しない。

### 地点

- id: 記事ID・時刻・同時刻内の出現番号などによる決定的ID
- order: 本文順
- recordedAt: タイムゾーンを含む時刻
- lat / lng: 元の記録座標
- photos: URLとalt
- comment: プレーンテキスト
- originalMapUrl: 記事内の地図リンク

座標を地点IDに含めず、位置修正時にもIDをなるべく維持する。重複時刻は出現順で区別する。orderを唯一の識別子にしない。

### 区間

- fromPointId / toPointId
- routeCacheKey
- geometry: GeoJSON LineString
- distanceMeters
- estimatedDurationSeconds（API提供時のみ）
- routedAt
- provider / profile / attribution
- routingOptionsVersion
- 必要に応じてAPIが採用したスナップ後の始終点

元座標のピンと、道路上にスナップされたルートの端点を区別する。

### 旅データ

- schemaVersion
- tripId / title / articleUrl
- journeyDate / timeZone
- sourceContentHash
- generatedAt: 内容が更新された時刻
- points / segments
- estimatedTotalDistanceMeters
- attribution

表示は「地図データ更新日時」とし、内容に変更がない再実行で時刻だけを書き換えて不要な公開を発生させない。記事を確認した時刻はActionsのログに記録する。

## 7. 記事解析

1. 設定済みURLからHTMLを取得。タイムアウト、サイズ上限、HTTPステータスを確認。
2. 記事本文のDOMスコープを特定し、ヘッダー・サイドバーを除外。
3. ログ内の「現在地」リンクを本文順に走査。
4. URL APIでqパラメータを取り出し、数値・緯度経度の範囲を検証。
5. 同じログブロックから時刻、画像、コメントを取得。
6. 画像URLは相対URLを解決し、実HTMLで確認した遅延読み込み属性に対応。
7. 写真なし・コメントなしも許容する。
8. JSONに正規化し、スキーマ検証。

- 時刻でソートしない。本文順を保持する。
- 同じ座標への再訪を削除しない。
- 記事冒頭の予定ルートを地点に含めない。
- iframeや引用カード内部の情報を巡回しない。
- コメントのHTMLをそのままinnerHTMLへ入れない。
- 短縮URLなど未対応の「現在地」があれば、黙って欠落させず解析エラーにする。
- 前回より地点数が減った場合は誤解析の可能性があるため、初期実装では明示的なallow-removalなしでは公開しない。
- 0地点は失敗。1地点はピンだけの有効な地図として扱う。
- 日付またぎは明示的な設定・補正で扱い、単なる時刻逆転を自動で翌日と推測しない。

## 8. 徒歩ルートと差分更新

隣接する地点ごとに計算する。N地点なら通常N-1区間。訪問順の最適化はしない。

キャッシュキー:
provider + API/options version + profile + 始点座標 + 終点座標 + 順序付き補助経由点 + 経路選択オプション
をcanonical JSONにしてSHA-256でハッシュする。

- 時刻・写真・コメントだけの修正では再計算しない。
- 末尾に1地点追加した場合、新しい1区間だけ計算する。
- 中間地点の座標修正では隣接区間だけ再計算する。
- 補助経由点の変更では対象区間だけ再計算する。
- force-rerouteで現在の旅の区間を再計算できるようにする。
- 完全に同一の連続座標はAPIを呼ばず距離0として扱う。
- GeoJSONは[経度, 緯度]、LeafletのLatLngは[緯度, 経度]。変換箇所を集約する。

API呼び出しは最初は逐次実行とし、429ではRetry-Afterを尊重する。タイムアウト・一時的な5xxには回数上限付き再試行を行い、認証エラー・入力不備には無駄な再試行をしない。

不自然な区間は、fromPointId/toPointIdを指定するoverridesファイルに補助経由点を登録して再計算できるようにする。地図上のドラッグ編集は後回し。

長距離迂回や過大なスナップ距離を検出したらログに警告し、確認対象を示す。閾値だけで実際の道を断定しない。

## 9. 失敗・整合性

更新データは作業用ディレクトリで組み立て、全区間・JSON・ビルドが成功してから保存・公開する。

- 途中のAPI失敗では公開中の地図を維持。
- 初回失敗時は架空ルートや直線で代用せず、公開未完了を報告。
- 変更済み区間に、以前の別座標のルートを流用しない。
- データ保存とPages公開は完全な単一トランザクションではない。保存済みだが公開失敗の場合は次回実行で再公開できるようにする。
- 再実行ではAPIキャッシュを再利用できる。
- 内容が不変でも、前回の公開失敗があればデプロイを省略しない。
- 全更新・公開を同じconcurrency groupで直列化する。cancel-in-progressはfalseとし、実行中の保存・公開を途中キャンセルしない。
- 各実行は開始時に最新のgenerated-dataを読み直す。push競合では失敗させ、force pushしない。
- 複数記事を公開している場合、対象外記事のデータも含めてサイト全体をビルドし、他の記事を消さない。

## 10. ビューア

### URL設計

GitHub Pagesのサブディレクトリ配信に対応する。MVPはルーティング設定不要のクエリ方式とする。

- 通常: /<repo>/?trip=<tripId>
- 埋め込み: /<repo>/?trip=<tripId>&embed=1
- 地点共有: 上記URLに#point=<pointId>

URLSearchParamsで解析し、未知のtripIdには分かりやすいエラーと記事一覧を表示する。外部URLをデータパスとして任意に読み込まない。

### 共通

- 全地点が収まる初期表示。
- 番号付きピンと推定徒歩ルート。
- 地点選択で時刻・写真・コメントを表示。
- ピンと地点カードの選択を連動。
- 写真は遅延読み込み。読めない画像があっても地図は使える。
- 元記事へのリンク。
- 「徒歩ルートは記録地点間の推定です」と表示。
- 合計距離は「推定徒歩距離」。APIの所要時間と記録時刻差を混同しない。
- 地図タイルとルーティングの出典を表示。
- 地図タイル取得失敗時も地点一覧・元記事リンクを残す。

### 埋め込み

- ヘッダーを省略し、iframeの高さ内に地図とコンパクトな地点カードを配置。
- 初期状態ではドラッグ・ホイール・タッチによる地図操作を無効にし、「地図を操作する」で有効化。
- 「操作を終了」で再びブログスクロールを優先。
- 操作開始ボタンにキーボードでアクセス可能。
- 「大きな地図で開く」はembedパラメータを除いたURLを別タブで開く。
- 幅100%、高さ480pxを基本とし、狭幅でも横スクロールを発生させない。
- 親ページへのpostMessageによる高さ同期はMVPでは不要。
- 開きっぱなしのiframeに即時更新は保証しない。MVPでは再読み込みで最新公開版を取得する。Service Workerは導入しない。

### 共有

通常URLのコピーと地点別URLのコピーを実装。OGPはMVPではサイト共通のタイトル・説明・画像でよい。クエリ文字列ごとのOGPが必要になったら、旅ごとの静的HTML生成を追加する。

## 11. GitHub Actions

### update-map.yml

workflow_dispatch入力:
- trip_id: 登録済みID
- force_reroute: boolean、既定false
- allow_removal: boolean、既定false

処理:
1. デフォルトブランチのソースをcheckout。
2. generated-dataを別ディレクトリにcheckout。初回のみ初期化。
3. lockfileから依存関係をインストール。
4. 入力を検証して記事更新CLIを実行。
5. スキーマ検証・関連テスト・サイトビルド。
6. 生成データに変更があればgenerated-dataへcommit/push。
7. 全記事を含むPages artifactをアップロード。
8. GitHub公式のPagesデプロイ処理を同じworkflow内で実行。
9. Job Summaryに地点数、再利用区間数、API計算区間数、推定距離、更新内容、公開URLを記載。

generated-dataへのGITHUB_TOKENによるpushを別workflowの起動契機にしない。更新とデプロイを明示的に同じworkflowでつなぐ。

権限はjob単位で最小限にする。データ保存にcontents: write、Pages公開にpages: writeとid-token: writeが必要なjobを分ける。実装時点の公式Pages Actions手順・バージョンを確認する。

workflow入力をshellコマンドへ直接展開しない。環境変数経由でCLIに渡し、tripIdをallowlist検証する。

Secrets:
- ROUTING_API_KEY

Variables / 設定:
- 公式確認済みルーティングAPIベースURL
- Pagesのbase path
- 地図タイルURLとattribution

APIキーをVITE_*変数やdistへ渡さない。ソース変更時のCIも同じ公開concurrencyを使うか、MVPでは公開をupdate-map.ymlに一本化する。ci.ymlはテスト・ビルドのみでもよい。

## 12. iOSショートカット

READMEに手順を記載する。秘密を埋め込んだ共有ショートカットは配布しない。

1. tripIdを固定値またはメニューで選択。
2. 「URLの内容を取得」でGitHubのworkflow dispatch endpointへPOST。
3. Authorizationヘッダーに、対象リポジトリに限定したfine-grained tokenを設定。
4. JSON bodyにデフォルトブランチのrefとinputsを指定。
5. 成功時は「地図更新を受け付けました」と表示。
6. Actionsの実行一覧へのリンクを開けるようにする。

endpointの形:
POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/update-map.yml/dispatches

必要権限は実装時点のGitHub RESTドキュメントで確認する（Actionsの書き込み権限を想定）。APIバージョンヘッダーも現行公式仕様に合わせる。

dispatchの受付成功は公開完了ではない。受付時点で「更新完了」と表示しない。MVPでは自動ポーリングせず、完了確認はActionsの画面と地図データ更新日時で行う。

ショートカット中のトークンは端末上で閲覧可能な秘密として扱う。README・リポジトリ・ブログ・iframe URLには含めない。最初はGitHubのRun workflowだけでも動作確認できるようにする。

## 13. 検証

### 自動テスト

- 実記事から採取した固定fixtureで順序・時刻・座標・写真・コメントを抽出。
- 行程リンクやまとめの画像を地点として誤認しない。
- 写真なし、コメントなし、同一時刻、同一座標、位置修正、地点削除を扱う。
- 不正なq、本文スコープなし、0地点は公開を止める。
- GeoJSONとLeafletの座標順が正しい。
- 変更なしではルーティング呼び出し0。
- 末尾追記では新規区間だけ呼び出す。
- 中間座標修正・補助経由点変更では必要区間だけ再計算。
- 写真・コメントだけの変更ではルートを再利用。
- 429、一時エラー、認証失敗の挙動。
- 途中失敗で既存の公開用データを破壊しない。
- 別の旅のデータを消さない。

通常のテストでは外部APIを叩かず、応答fixtureを使う。実APIの疎通確認は明示的なコマンドに分ける。

### 手動確認

- PCと幅375px程度のモバイル表示。
- iframe内の操作開始・終了とブログのスクロール。
- 単独URL、埋め込みURL、地点別URL。
- サブディレクトリ配信でJS、CSS、JSON、画像が404にならない。
- 実ブログのHTML編集とプレビューで埋め込み表示。
- 1地点追加してActionsを起動し、新規区間だけ計算される。
- API失敗後にも前回の公開ページが表示される。
- dist、生成データ、ログに秘密が含まれない。
- タイル出典、ルーティング出典、推定表示が見える。

## 14. 実装順・完了条件

### Phase 1: パーサーと技術検証
- 対象記事のHTMLを調査してfixture化。
- parserとCLIを実装。
- 徒歩APIの条件確認、数区間で疎通・経路確認。
- 27地点という初期観測と差があれば、記事更新か解析不備かを説明。

### Phase 2: ルート生成
- adapter、区間キャッシュ、overrides、スキーマ検証。
- 差分更新と失敗時処理のテスト。
- 実データを生成。未疎通ならその制約を明示。

### Phase 3: ビューア
- 通常・埋め込みモード、地点選択、写真、推定距離。
- サブディレクトリ対応とモバイル確認。

### Phase 4: 更新と公開
- generated-data保存、workflow_dispatch、Pages公開。
- READMEの初期設定・iOSショートカット手順。
- 実際の公開設定やSecrets設定が必要なら、具体的な手順をユーザーに渡す。

### 完了条件
- 記事の地点が本文順に表示される。
- 地点間が推定徒歩ルートで結ばれ、推定距離を確認できる。
- 公開URLを共有でき、ブログにiframeで表示できる。
- iPhoneから更新を受け付け、成功後に地図が更新される。
- 追記時のルート計算が差分に限定される。
- 更新失敗時に前回の地図を維持できる。
- セットアップ、更新、補正、再計算、エラー確認がREADMEだけで分かる。
- 実施したテスト、未実施の実API・実ブログ検証を区別して報告する。

## 15. 今回は実装しないこと

- 常駐の更新API、ログイン付き管理画面。
- 閲覧のたびのルート再計算。
- 自動巡回によるブログ全記事の収集。
- 訪問順の最適化。
- 実際のGPS軌跡を復元したという保証。
- 地図上でのルート編集UI。
- 定期実行、開きっぱなし画面へのリアルタイム配信。
- 全写真の再ホスティング。
- 汎用的な他人のブログ向けサービス。

## 16. 公式資料

実装時に現行仕様を確認する。会話内で未確認の機能や利用条件を、確認済みとして扱わない。

- 対象記事: https://todays-mitsui.hatenablog.com/entry/2026/03/15/060000
- Leaflet: https://leafletjs.com/
- openrouteservice Directions: https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/
- openrouteservice API制限: https://openrouteservice.org/restrictions/
- GitHub Actions手動実行: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- Google Routesのポリシー: https://developers.google.com/maps/documentation/routes/policies
- OSM標準タイル利用ポリシー: https://operations.osmfoundation.org/policies/tiles/
- はてなブログHTML編集: https://help.hatenablog.com/entry/editor/textarea

