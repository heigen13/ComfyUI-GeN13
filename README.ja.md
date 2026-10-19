<p align="center"><img src="docs/banner.jpg" alt="ComfyUI-GeN13" width="100%"></p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.zh-CN.md">简体中文</a> · <b>日本語</b></p>

# ComfyUI-GeN13

画像から動画、人物ポートレートのワークフロー向けに作った ComfyUI カスタムノード集です。大きなワークフローのあちこちで同じ値を同期するリモートノード、連結できるプロンプト切り替え、プレビューを隠せる画像ノード、動画の時間方向の色合わせ、人物の美肌補正を収録しています。

すべてのノードの表示名は **(GeN13)** で終わります。キャンバスをダブルクリックして `GeN13` と入力すると一覧できます。

## 特長

### Remote:一度設定すれば、どこからでも操作

同じ値が必要な場所それぞれに Remote Int / Float / String / Boolean を置きます。`channel` 名が同じノードは分身となり、値、ステップ、バイパスがすべて同期します。どれか 1 つを変えると、サブグラフの中でも残りがすぐに追従します。1 つの Primitive からワークフロー全体に長い線を引く必要も、設定を探してスクロールする必要もありません。

<p align="center"><img src="docs/remote.gif" alt="Remote のアニメーション" width="80%"></p>

<p align="center"><img src="docs/remote.png" alt="Remote ノードと単一の Primitive の比較" width="100%"></p>

### Text Switch:プロンプトを切り替え、いくつでも連結

タイトル付きの枠に直接プロンプトを入力し、選んだ 1 枠を出力します。chain で横に連結すれば枠数は無制限。番号は連結全体で続き、先頭のノード、またはキャンバスのどこかに置いた Remote Text Switch で枠を選びます。`auto next` はキューに送るたびに内容のある次の枠へ進み、選ばれた枠の上流だけが実行されます。

<p align="center"><img src="docs/textswitch.gif" alt="Text Switch のアニメーション" width="80%"></p>

<p align="center"><img src="docs/textswitch.png" alt="Text Switch の連結と Remote Text Switch" width="100%"></p>

### プライベート画像ノード:画面共有でも画像を見せない

Load、Save、Preview Image Private はノードのプレビューにモザイク、すりガラス、グラデーション、パレット、単色のカバーをかけられます。プレビューを長押しすると元画像が見えます。画像そのものは一切変更されないので、配信や画面共有も安心です。

<p align="center"><img src="docs/privacy.gif" alt="プライバシーカバーのアニメーション" width="80%"></p>

<p align="center"><img src="docs/privacy.jpg" alt="プライバシーカバーのスタイル" width="100%"></p>

### Color Match Temporal:画像から動画の色ずれを止める

生成した動画は再生が進むにつれて青っぽく、または暖色寄りになりがちです。Color Match Temporal は各フレームを先頭フレームの画像の色調に戻し、時間方向に平滑化するのでちらつきません。既定の `white balance` は色かぶりだけを補正し、明るさは元のまま。動いていない背景で色ずれを測るので、大きな白い服やアップの顔にもだまされません。カットが変わると、各ショットはそれぞれ自身の冒頭に合わせます。

<p align="center"><img src="docs/colormatch.jpg" alt="模擬的な色ずれを Color Match Temporal で補正" width="100%"></p>

### Degrease:肌はきれいに、パーツはそのまま

生成した人物画像や動画にありがちなテカリや過剰なディテールを取り除きます。シミ取り、美肌、テカリ除去、肌色補正、立体感軽減の 5 種類で、それぞれ 0(オフ)から 100(最大)まで調整できます。目、まつ毛、眉、唇は自動で保護され、処理するのは肌だけです。

<p align="center"><img src="docs/degrease.jpg" alt="Degrease の 0 から 100 までの効果" width="100%"></p>

## インストール

**ComfyUI Manager**:`GeN13` で検索してインストール。

**手動**:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/heigen13/ComfyUI-GeN13
```

ComfyUI を再起動すれば使えます。追加の Python パッケージは不要で、ComfyUI に含まれる torch、numpy、Pillow だけを使います。
オプション:**Resize** の `nvidia_rtx_vsr` には `nvidia-vfx` パッケージと RTX GPU が必要です。

## ノード一覧

### 動画 / 色

| ノード | 内容 |
|---|---|
| **Color Match Temporal** | 生成動画の各フレームを参照画像(通常は先頭フレーム)に合わせ、時間方向に平滑化。`white balance` は色かぶりのみ補正、`mkl`、`reinhard` は明るさも合わせます。カットを自動検出し、`.cube` LUT も出力できます。 |
| **Degrease** | 画像と動画向けの人物補正:シミ取り、美肌、テカリ除去、肌色補正、立体感軽減。各項目 0 でオフ。顔のパーツは保護され、処理は肌だけです。 |
| **Remote Video** | 先頭フレームを比率とメガピクセルでリサイズし、幅、高さ、秒数、FPS、MiniMax H3、Wan 2.1 / 2.2、LTX の有効なフレーム数を出力。channel が同じ分身は同期します。 |

### 画像

| ノード | 内容 |
|---|---|
| **Load Image Private** | プレビューにプライバシーカバーをかけられる Load Image。長押しで元画像を表示。幅と高さを出力し、ドラッグ&ドロップとアップロードに対応。 |
| **Save Image Private** | PNG、JPG、BMP、PNG + JPG で保存。接頭辞、連番の桁数、品質を設定でき、プレビューにも同じカバーをかけられます。 |
| **Preview Image Private** | 一時プレビュー(output には保存しません)、カバー対応。 |
| **Load Latest Image Private** | フォルダーから最新、最古、ファイル名順で画像を取得。ファイル名フィルター、サブフォルダー、連続読み込みに対応し、書き込み中のファイルはスキップします。 |
| **Load Image Orient** | Pillow だけでデコードする簡易読み込み。iOS のスクリーンショットが回転しません。 |
| **Load Image SD** | 画像を読み込み、A1111 / Forge の生成パラメーター(プロンプト、ネガティブ、シード、ステップ数、CFG、サンプラー、スケジューラー、サイズ、clip skip)を読み出して、ComfyUI で過去の画像を再現します。 |

### Latent

| ノード | 内容 |
|---|---|
| **Resize** | 1 つで潜在のサイズを決定:空の潜在の作成、画像のエンコード、既存の潜在のリサイズ。比率、幅と高さ、メガピクセルが連動し、crop / resize / pad / pad_edge / stretch、8〜64 の倍数に対応。画像 4 枚とマスクを同じ設定でリサイズできます。 |

### テキスト

| ノード | 内容 |
|---|---|
| **Text Switch** | 1 ノードに名前付き・折りたたみ可能なプロンプト枠を最大 25 個。連結すれば数は無制限。`auto next` と `select_num`(INT 入力)で選択を制御できます。 |
| **Text Concatenate** | 枠に入力したテキストを連結。枠ごとのオン / オフとソロに対応し、空の枠はスキップします。 |
| **Prompt Cache** | 上流のテキスト(LLM の台本など)をファイルに保存し、上流のモデルを読み込まずに再利用。自動バックアップ 1 世代とお気に入りを無制限に保持します。 |
| **Show Any** / **Show Any Lite** | どんな型も受け取り、表示してそのまま出力。切り取り、コピー、貼り付けボタン付きで、内容はワークフローと一緒に保存されます。 |

### ユーティリティとリモート

| ノード | 内容 |
|---|---|
| **Remote Int / Float / String / Boolean** | `channel` 名が同じ分身は値、ステップ、バイパスを同期(サブグラフ内も)。どれか 1 つに接続すると、その入力がグループ全体を動かします。 |
| **Remote Text Switch** | Text Switch のリモコン。選ばれた枠の番号とタイトルを表示し、◀ ▶ は空の枠をスキップします。 |
| **Counter** | キューに送るたびにカウント。範囲、各数値の繰り返し回数、リセットボタン、リセット入力、毎時・毎日の自動リセットに対応。バイパス中は止まります。 |
| **Trigger** | ボタンか上流の変化で新しい値を出力。Counter の reset に接続します。 |
| **Number** | 1 つの数値を INT、FLOAT、STRING で同時に出力。小数から整数への変換方法を選べます。 |

## 補足

- ノードの説明は英語が基本で、繁体字中国語、簡体字中国語、日本語の翻訳付き。ComfyUI の言語をいずれかに設定すると自動で切り替わります。
- ComfyUI 0.40 のクラシックキャンバス(Nodes 1.0)で開発・テストしています。画像プレビューは Nodes 2.0 にも対応。
- Remote と Text Switch の画像は説明用の図です。プライバシーカバー、Color Match、Degrease の例はノードの実際の出力です。

## ライセンス

Copyright (C) 2026 GeN's Studio Inc.

GNU General Public License v3.0(ComfyUI 本体と同じ)で公開しています。商用を含め、自由に使用、改変、共有できます。改変版を配布する場合は、同じく GPL-3.0 でソースコードを公開する必要があります。全文は [LICENSE](LICENSE) を参照してください。

`docs/` 内の画像 © 2026 GeN's Studio Inc.
