# 配信候補の作成と検証

`npm run build-release -- CONFIG.json NEW_DIRECTORY` は、確認済みの作業ファイルからクラスごとのSKTJFと `manifest.json` を生成します。出力先には存在しないディレクトリを指定します。既存ディレクトリは変更しません。すべての対象クラスについて出力前チェックが通った後に書き込み、manifestは最後に作成します。元のPDFは配信ファイルに含めません。

設定ファイルの `projectPath` は設定ファイルからの相対パスです。`expectedClasses` と `entries` は同じクラスをそれぞれ1回ずつ含めます。以下は構造の例であり、日時や時間割データを示すものではありません。資料の確認が終わるまで `coverageConfirmed` を `true` にしないでください。

```json
{
  "academicYear": 2026,
  "term": "S",
  "revision": "2026.S.0",
  "publishedAt": null,
  "releaseBaseUrl": "https://github.com/example/SKTJF/releases/download/2026.S.0/",
  "expectedClasses": ["1-1"],
  "entries": [{
    "projectPath": "reviewed-project.sktjf-project.json",
    "options": {
      "term": "S", "classId": "1-1", "scope": "1・2・3年生",
      "start": "2026-04-01", "end": "2026-09-30", "revision": "2026.S.0",
      "coverageConfirmed": false,
      "periods": [
        {"number": 1, "start": "08:00", "end": "09:00"}
      ]
    }
  }]
}
```

`npm run validate-release -- DIRECTORY 1-1 1-2 1-3 1-4` のように対象クラスを指定すると、ファイル一覧、ハッシュ、URL、各データとmanifestの一致に加え、クラスの欠落を検出します。公開日時のない候補は `--published` を付けた検証に通りません。公開日時は公開済みReleaseから確認したUTC時刻を使用してください。形式検証は日時の事実性や人による照合を証明しません。

公開日時を確認した後、`npm run finalize-manifest -- CANDIDATE_DIRECTORY 2026-04-02T12:34:56Z NEW_MANIFEST_FILE 1-1 1-2 1-3 1-4` で公開用 manifest を作成できます。日時は例です。候補のクラスとハッシュを再検証し、候補と別の場所に新規作成します。候補のファイルは変更しません。公開時はこの manifest を `manifest.json` として、検証済みのクラスファイルと一緒に使用してください。

このツールはローカルで候補を作成するだけで、GitHubのReleaseを作成・更新しません。公開済みReleaseのアセットを上書きせず、修正は新しい改訂番号で公開してください。公式PDFは利用条件を確認せずに再配布しないでください。

同じActions実行内の候補artifactを検査する再利用可能なワークフロー `.github/workflows/validate-distribution.yml` には、artifact名と空白区切りの対象クラスを渡せます。候補に余分なファイルがあれば失敗します。このCI検査は形式と整合性を確認するもので、資料との照合や作業プロジェクトの確認状態を後から証明するものではありません。
