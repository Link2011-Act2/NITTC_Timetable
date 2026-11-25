# 長期休業の候補抽出と配信

`node bin/extract-vacations.mjs 2026 NEW_DRAFT.json` で公式の行事予定表ページから指定年度の前期・後期PDFを探します。PDFをローカルから指定するときは、出力先の後にPDFのパスを並べます。

抽出結果の `periods` は、開始日候補と出典を持つ編集用の一覧です。日付欄と月の列を使って開始日を拾います。`periodEvidence` に矢印から得た終点候補と確認範囲の候補を記録し、`lessonStarts` に照合用の授業開始日候補を記録します。

`node bin/review-vacations.mjs DRAFT.json NEW_REVIEW.json` で元PDFと照合しながら各候補を修正・確認できます。JSONを直接編集する場合、`confirmedThrough` に資料から休業と確認できる最終日を入力します。確定した終了日は `end` に入力し、終了日が未確定なら `end` を `null` にして必要に応じて `estimatedEndMonth` を指定します。日付と出典を確認した項目のみ `reviewed` を `true` にします。

配信候補を作るときは build-release の設定に、確認済み下書きへの相対パス `vacationsPath` を指定します。既存の `manifest.json` とクラス別SKTJF v1は従来どおりです。追加の `vacations.manifest.json` が同じ改訂の `vacations.json` とそのSHA-256を指し、どちらも従来の配信候補検証の対象になります。クラス別日程のA/Bと確認済み休業期間が重なる場合は、資料を照合してください。

休業IDは、開始日が属する学年度と種別から作成します。翌年度の資料で前年の学年末休業の終了日を確定した場合は、既存IDのままで `end`、`confirmedThrough` と出典を更新します。学年末休業の確定した終了日が翌年度の春季休業内に含まれる場合は、原文の期間と名称をそれぞれ保持します。Schedulerは重なる日をまとめて休日として扱います。

休業データを含む新しい改訂では、その年度の配信済み休業と新たに確認した休業をまとめて収録します。翌年度資料で終了日を確定した前年の休業も収録できます。Schedulerは同年度の休業アセットを持つ最新の改訂を取得します。
