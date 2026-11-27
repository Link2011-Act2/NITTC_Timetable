# 長期休業の候補抽出と配信

`node bin/extract-vacations.mjs 2026 NEW_DRAFT.json` で公式の行事予定表ページから指定年度の前期・後期PDFを探します。PDFをローカルから指定するときは、出力先の後にPDFのパスを並べます。

抽出結果の `periods` は、開始日候補と出典を持つ編集用の一覧です。日付欄と月の列を使って開始日を拾います。`periodEvidence` に矢印から得た終点候補と確認範囲の候補を記録し、`lessonStarts` に照合用の授業開始日候補を記録します。

`npm start` で時間割エディターを開き、「長期休業の監修」から抽出したJSONを読み込みます。「PDFを開く」で資料を追加すると、SHA-256が一致する出典のページを表示できます。期間ごとに日付と出典を照合して承認し、監修ファイルを保存します。承認後に期間や出典を変更すると未承認に戻ります。

CLIで確認する場合は `node bin/review-vacations.mjs DRAFT.json NEW_REVIEW.json` を使います。`confirmedThrough` は資料で休業と確認できた最終日です。確定した終了日は `end` に入力し、終了日が未確定なら `end` を `null` にして必要に応じて `estimatedEndMonth` を指定します。

## 休業だけを配信する場合

```sh
node bin/vacation-release.mjs build 2027.S.0.Beta Link2011-Act2/NITTC_Timetable REVIEW.json NEW_DIRECTORY
node bin/vacation-release.mjs validate 2027.S.0.Beta Link2011-Act2/NITTC_Timetable NEW_DIRECTORY
```

生成するアセットは `vacations.manifest.json` と `vacations.json` の2つです。配信許可後に、例ではタグ `vacations-2027.S.0.Beta` のGitHub Pre-releaseへ追加します。休業側の改訂番号を更新し、時間割Releaseのタグ・manifest・クラスファイルは従来の改訂番号で管理します。休業の同梱版から移行するときは、その年度で最後に休業を配信した学期・改訂番号より新しい番号を選びます。

## 時間割に同梱する場合

配信候補を作るときは build-release の設定に、確認済み下書きへの相対パス `vacationsPath` を指定します。既存の `manifest.json` とクラス別SKTJF v1は従来どおりです。追加の `vacations.manifest.json` が同じ改訂の `vacations.json` とそのSHA-256を指し、どちらも従来の配信候補検証の対象になります。クラス別日程のA/Bと確認済み休業期間が重なる場合は、資料を照合してください。

休業IDは、開始日が属する学年度と種別から作成します。翌年度の資料で前年の学年末休業の終了日を確定した場合は、既存IDのままで `end`、`confirmedThrough` と出典を更新します。学年末休業の確定した終了日が翌年度の春季休業内に含まれる場合は、原文の期間と名称をそれぞれ保持します。Schedulerは重なる日をまとめて休日として扱います。

休業データを含む新しい改訂では、その年度の配信済み休業と新たに確認した休業をまとめて収録します。翌年度資料で終了日を確定した前年の休業も収録できます。Schedulerは同年度の休業アセットを持つ最新の改訂を取得します。
