# 配信候補の作成と検証

週数条件を含むv2と従来のv1を同じReleaseで配信できます。授業機会が未確定のデータは出力できません。データ構造と検証条件は [授業週条件のデータ契約](sktjf-v2-week-conditions.md) を参照してください。

`npm run build-release -- CONFIG.json NEW_DIRECTORY` は、確認済みの作業ファイルからクラスごとのSKTJFと `manifest.json` を生成します。出力先には存在しないディレクトリを指定します。既存ディレクトリは変更しません。すべての対象クラスについて出力前チェックが通った後に書き込み、manifestは最後に作成します。元のPDFは配信ファイルに含めません。

設定ファイルの `projectPath` は設定ファイルからの相対パスです。`expectedClasses` と `entries` は同じクラスをそれぞれ1回ずつ含めます。以下は構造の例であり、日時や時間割データを示すものではありません。資料の確認が終わるまで `coverageConfirmed` を `true` にしないでください。

```json
{
  "academicYear": 2026,
  "term": "S",
  "revision": "2026.S.0.Beta",
  "publishedAt": null,
  "releaseBaseUrl": "https://github.com/example/SKTJF/releases/download/2026.S.0.Beta/",
  "expectedClasses": ["1-1"],
  "entries": [{
    "projectPath": "reviewed-project.sktjf-project.json",
    "options": {
      "term": "S", "classId": "1-1", "scope": "1・2・3年生",
      "start": "2026-04-01", "end": "2026-09-30", "revision": "2026.S.0.Beta",
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

現在の対象は本科1〜5年生です。専攻科の作業ファイルは別に保管します。v2.0.0の正式リリースまでは `2026.S.0.Beta` や `2026.F.0.Beta` のように改訂番号の後に `.Beta` を付け、GitHubで必ずPre-releaseに設定します。CLIでは公開時に `--prerelease` を指定し、公開後に `gh release view TAG --json isPrerelease` で確認できます。修正時は `.1.Beta`、`.2.Beta` と改訂します。正式リリース時は `2026.S.0` と `2026.F.0` から始めます。

このツールはローカルで候補を作成します。公開済みReleaseのアセットはそのまま保存し、修正は新しい改訂番号で公開してください。公式PDFの再配布には利用条件の確認が必要です。

## v1・v2混在の候補

設定に `"dataFormatVersion": 2` を指定すると、確認済みプロジェクトからv2を生成します。各エントリの `weekDays` は、根拠を確認した日付と授業週の一覧です。公式の授業機会を `weekSeries` と `countingPolicy` で管理する場合、事前に日付へ変換する必要はなく、`weekDays` に空配列を指定できます。未確定の授業機会や不整合が残っていれば候補の生成は失敗します。

以前の配信から承認済みの1年生データを引き継ぐ場合は、そのエントリに `projectPath` の代わりに `approvedV1Path` と `sha256` を指定します。元アセットのSHA-256を照合したうえで、新しい改訂番号と科目名の表記統一を反映します。授業内容、出典、元の公開アセットは変更しません。

`validate-release` と `finalize-manifest` はmanifestの形式を検出してv1またはv2を検証します。長期休業データは時間割とは別に承認・配信してください。

同じActions実行内の候補artifactを検査する再利用可能なワークフロー `.github/workflows/validate-distribution.yml` には、artifact名と空白区切りの対象クラスを渡せます。候補に余分なファイルがあれば失敗します。このCI検査は形式と整合性を確認するもので、資料との照合や作業プロジェクトの確認状態を後から証明するものではありません。
