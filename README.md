# line_bot_lite
# LINE bot 輕量版（和 AI 一起寫程式 W6 回家作業）

## 怎麼裝
- Python 3、Ollama，`ollama pull gemma4:e2b`

## 怎麼跑
- 模擬模式：`python line_bot_lite.py --simulate`
- 真的接 LINE：`python line_bot_lite.py`（要 cloudflared、LINE 通行碼與 Channel secret，開起來時貼）

## 我改了什麼、跑起來怎樣
- 模型：gemma4:e2b／電腦：顯示卡：NVIDIA GeForce RTX 4070 Laptop GPU (8 GB)、記憶體：16.0 GB／一題約1.3秒
- 沒改
- 1.沒接電線時載不了Ollama，卡了三、四次，接電線後就正常能下載了。
- 2.目前卡在4-3，輸入長效通行碼和Channel secret後，一直顯示「LINE 通行碼不對（0）：回 LINE Developers 重新複製長效通行碼」
