<p align="center"><img src="docs/banner.jpg" alt="ComfyUI-GeN13" width="100%"></p>

<p align="center"><a href="README.md">English</a> · <b>繁體中文</b> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a></p>

# ComfyUI-GeN13

ComfyUI 自訂節點包，圍繞圖生影片與人像工作流設計：在大型工作流各處同步同一個數值的遙控節點、可串接的提示詞切換、可遮住預覽的圖片節點、影片時間軸校色、人像美顏，以及 Run 按鈕旁的即時資源監控。

所有節點的顯示名稱都以 **(GeN13)** 結尾，在畫布上雙擊、輸入 `GeN13` 就能全部列出。

## 特色

### Monitor：整台電腦的狀態，一眼看完

Run 按鈕旁的即時監控列。RUN 顯示正在執行的節點、耗時、整個佇列的整體進度與排隊數量，手機頁面、API 或其他瀏覽器分頁送出的佇列也看得到。進度依同一工作流先前的耗時估算，進度條平穩前進，不會一個節點一個節點跳；跑完保留最後的進度條；本頁送出的可點一下移到該節點。CPU、RAM、GPU、VRAM、功耗各有數值、趨勢折線與用量條，出問題前先轉紅：RAM 與 VRAM 達 95%，GPU 核心達 83 °C。它不是節點，畫布上不用放任何東西。在「設定 → GeN13 → 資源監控」可以個別顯示或隱藏各格、調整更新間隔。

<p align="center"><img src="docs/monitor.gif" alt="執行中的資源監控列" width="100%"></p>

<p align="center"><img src="docs/monitor.png" alt="資源監控列的深色與淺色主題" width="100%"></p>

| 顯示卡 | 監控讀得到的項目 |
|---|---|
| NVIDIA（Windows、Linux） | 使用率、核心溫度、VRAM、功耗與功耗上限，透過 NVML（`nvidia-ml-py`） |
| AMD（Linux） | 使用率、溫度、VRAM、功耗與功耗上限，直接讀 amdgpu 驅動，不用另外安裝 |
| AMD 或 Intel（Windows） | 使用率與 VRAM，來源與工作管理員相同；Windows 不提供這兩家的溫度與功耗 |
| Apple 晶片、只有 CPU | RUN、CPU、RAM |

讀不到的項目會自動隱藏，不會顯示空格。

### Remote：設一次，到處都能控制

在每個需要同一個數值的地方，各放一顆 Remote Int / Float / String / Boolean。`channel` 名稱相同的節點互為分身，數值、步進與 bypass 全部同步；改任何一顆，其他分身立即跟著變，子圖裡也一樣。不用再從一個 Primitive 拉長線橫跨整個工作流，也不用捲回去找那一個設定。

<p align="center"><img src="docs/remote.gif" alt="Remote 動畫示範" width="80%"></p>

<p align="center"><img src="docs/remote.png" alt="Remote 節點與單一 Primitive 的比較" width="100%"></p>

### Text Switch：切換提示詞，串接不限數量

直接在有標題的框裡打提示詞，選一框輸出。多顆並排用 chain 串接，框數不限；編號一路接續，由第一顆或畫布任何角落的 Remote Text Switch 選框。`auto next` 每次送出自動跳到下一個有內容的框，而且只有選中那一框的上游會執行。第一顆有選號列 ‹ #07 標題 ›，串接再長也看得到選中哪一框，‹ › 自動略過空白框。已選中的 #NN 再按一次可收合，EXPAND ALL／COLLAPSE ALL 整條串接一起動，右鍵 → Clear all boxes 清空單顆，把 chain 輸出拖到空白處會自動長出下一顆並接好。

<p align="center"><img src="docs/textswitch.gif" alt="Text Switch 動畫示範" width="80%"></p>

<p align="center"><img src="docs/textswitch.png" alt="Text Switch 串接與 Remote Text Switch" width="100%"></p>

### 隱私圖片節點：螢幕分享不怕露圖

Load、Save、Preview Image Private 的節點預覽可以蓋上馬賽克、毛玻璃、漸層、色盤或純色，按住預覽圖才顯示原圖。圖片本身完全不會被改動，直播或分享螢幕都安心。

<p align="center"><img src="docs/privacy.gif" alt="隱私遮罩動畫示範" width="80%"></p>

<p align="center"><img src="docs/privacy.jpg" alt="隱私遮罩樣式" width="100%"></p>

### Color Match Temporal：修正圖生影片的偏色

生成的影片常常越播越偏藍或偏暖。Color Match Temporal 把每一格拉回首幀圖的色調，並沿時間軸平滑，不會閃爍。預設的 `white balance` 只修色偏、亮度照原片；它量的是畫面中沒動的背景，大面積白衣服或特寫都騙不了它；換鏡頭後，每個鏡頭各自對齊自己的開頭。最後由 `skin_anchor` 把每格的膚色對準參考圖的膚色，修正切到近景後皮膚重繪偏紅的問題。

<p align="center"><img src="docs/colormatch.jpg" alt="模擬偏色經 Color Match Temporal 校正" width="100%"></p>

### Degrease：皮膚乾淨，五官不動

去除生成人像與影片常見的油膩感與過度細節。六種效果，每一種都從 0（關閉）到 100（全開）：去斑、磨皮、去油光、勻膚、減立體、冷白皮（膚色往偏白、偏冷收，唇色保留）。眼睛、睫毛、眉毛、嘴唇自動保護，只處理皮膚。

<p align="center"><img src="docs/degrease.jpg" alt="Degrease 從 0 到 100 的效果" width="100%"></p>

### 接線更快

把連線放到空白處，符合該接點的 GeN13 節點會排在搜尋框與連線選單最前面，連線也會落在該接的欄位（Trigger → Counter 的 `reset`、Remote Text Switch → Text Switch 的 `select_num`）。在內建的 Load／Save／Preview Image 或 Primitive 上按右鍵，可原地轉換成 Private 或 Remote 版，設定與接線都保留。兩項都可以在「設定 → GeN13 → 連線」關閉。

## 安裝

**ComfyUI Manager**：搜尋 `GeN13` 安裝。

**手動安裝**：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/heigen13/ComfyUI-GeN13
pip install -r ComfyUI-GeN13/requirements.txt
```

重開 ComfyUI 即可。ComfyUI Manager 會一併安裝唯一的額外套件 `nvidia-ml-py`（NVIDIA 官方的 NVML 函式庫，資源監控用它讀取 NVIDIA 顯卡的使用率、溫度與功耗）。手動安裝時，請用 ComfyUI 自己的 Python 執行上面那行 `pip`（免安裝版為 `python_embeded\python.exe -m pip`）。其餘全部使用 ComfyUI 本身已有的 torch、numpy、Pillow、psutil。
選用：**Resize** 的 `nvidia_rtx_vsr` 縮放需要 `nvidia-vfx` 套件與 RTX 顯卡。

**範例工作流**：Text Switch 串接、Remote 雙段生圖、人像美顏、影片校色四份現成工作流，在 ComfyUI 的 Templates 面板 ComfyUI-GeN13 底下，或見 [`example_workflows`](example_workflows)。

## 節點一覽

### 影片／色彩

| 節點 | 功能 |
|---|---|
| **Color Match Temporal** | 生成影片的每一格對齊參考圖（通常是首幀），並沿時間軸平滑。`white balance` 只修色偏；`mkl`、`reinhard` 連亮度一起對齊。自動偵測換鏡頭；`skin_anchor` 把膚色拉回參考圖的膚色。可輸出 `.cube` LUT。 |
| **Degrease** | 圖片與影片的人像美顏：去斑、磨皮、去油光、勻膚、減立體、冷白皮，各項 0 為關閉。五官自動保護，只處理皮膚。 |
| **Remote Video** | 首幀依比例與像素量縮放，輸出寬、高、秒數、FPS，以及符合 MiniMax H3、Wan 2.1 / 2.2、LTX 的合法幀數；channel 相同的分身互相同步。 |

### 圖片

| 節點 | 功能 |
|---|---|
| **Load Image Private** | 節點預覽可蓋隱私遮罩的 Load Image，按住預覽圖顯示原圖；輸出寬高，支援拖放與上傳。 |
| **Save Image Private** | 存成 PNG、JPG、BMP 或 PNG + JPG，可設檔名前綴、流水號位數與品質，預覽同樣可蓋遮罩。 |
| **Preview Image Private** | 預覽圖片（暫存、不存進 output），預覽可蓋遮罩。 |
| **Load Latest Image Private** | 從資料夾依最新、最舊或檔名取圖，支援檔名篩選、子資料夾與連續多張，寫入中的檔案自動略過。 |
| **Load Image Orient** | 只用 Pillow 解碼的簡易載圖，iOS 截圖不會被轉向。 |
| **Load Image SD** | 載入圖片並讀出 A1111 / Forge 生成參數（提示詞、負面提示詞、種子、步數、CFG、取樣器、排程器、尺寸、clip skip），在 ComfyUI 重現舊圖。 |

### Latent

| 節點 | 功能 |
|---|---|
| **Resize** | 一顆決定 latent 尺寸：建立空 latent、圖片編碼成 latent，或縮放既有 latent。比例、寬高、像素量三欄連動，支援 crop／resize／pad／pad_edge／stretch，對齊倍數 8～64，可同時縮放四張圖與遮罩。 |

### 文字

| 節點 | 功能 |
|---|---|
| **Text Switch** | 每顆最多 25 個可命名、可收合的提示詞框，串接後數量不限；第一顆的選號列 ‹ ›、`auto next` 與 `select_num`（INT 輸入）可控制選框。右鍵 → Clear all boxes 清空。 |
| **Text Concatenate** | 在框內打字並串接，各框可開關、可獨奏，空白框自動略過。 |
| **Prompt Cache** | 把上游文字（如 LLM 寫的腳本）存成檔案，之後不必載入上游模型就能重用；保留一代自動備份與不限數量的收藏。 |
| **Show Any** / **Show Any Lite** | 任何型別都能接，顯示並直通輸出；有剪下、複製、貼上按鈕，內容隨工作流保存。 |

### 工具與遙控

| 節點 | 功能 |
|---|---|
| **Remote Int / Float / String / Boolean** | `channel` 名稱相同的分身互相同步（數值、步進、bypass），子圖裡也一樣；任一顆接線，就由該上游控制整組。 |
| **Remote Text Switch** | Text Switch 遙控器，顯示選中框的編號與標題，‹ › 自動略過空白框。輸出 `select_num` 接 Text Switch 的 `select_num`；`auto next` 與 Text Switch 同一種 OFF／NEXT 開關。 |
| **Counter** | 每次送出計數，可設範圍、每個數字維持幾次、按鈕歸零、上游歸零，以及每小時或每天自動歸零；bypass 時停住。 |
| **Trigger** | 按下按鈕或上游改變時輸出新值，接 Counter 的 reset。 |
| **Number** | 一個數字同時輸出 INT、FLOAT、STRING，可選小數轉整數的方式。 |
| **Switch Any** | 多路選號開關，任何型別都能接，select 選幾號就輸出第幾路；只有選中的那一路會執行，`index` 輸出可讓兩顆連動，各路可自訂名稱。 |

## 備註

- 節點說明以英文為主，附繁體中文、簡體中文與日文翻譯：ComfyUI 語言設為其中一種時自動切換。
- 在 ComfyUI 0.40 的經典畫布（Nodes 1.0）開發與測試；圖片預覽也支援 Nodes 2.0。
- Remote 與 Text Switch 的圖為示意圖；隱私遮罩、Color Match、Degrease 的範例都是節點實際輸出，資源監控的圖是實際監控列套上示範數值。

## 贊助

GeN13 免費使用。如果這些節點幫你省了時間，歡迎在 Ko-fi 請我喝杯咖啡。

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/gen13)

## 免責聲明

GeN13 依現狀提供，不附任何擔保（見 GPL-3.0 第 15、16 條）。如何使用由使用者自行負責，並須遵守所在地的法律。請勿用於製作或修改違法、侵害著作權或肖像權的內容，處理真人影像請先取得當事人同意。隱私遮罩只遮住畫面上的預覽，不會加密或保護圖片檔案本身。

## 授權

Copyright (C) 2026 GeN's Studio Inc.

採用 GNU General Public License v3.0（與 ComfyUI 本體相同）。可以自由使用、修改、分享，也可以用於商業案子；但若散布修改過的版本，必須同樣以 GPL-3.0 公開原始碼。全文見 [LICENSE](LICENSE)。

`docs/` 內的圖片 © 2026 GeN's Studio Inc.
