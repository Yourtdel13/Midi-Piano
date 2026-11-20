# 致谢与第三方资源

## 钢琴采样
`app/assets/piano.js` 内嵌的 FluidR3_GM 大钢琴采样，来源：
<https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3.js>

FluidR3_GM 由 Frank Wen 制作，经 MIDI.js soundfonts 项目分发。
**在再分发或商用前，请自行核对该采样库的许可条款**（上游仓库通常标注为
MIT / CC 系列，具体以 <https://github.com/gleitz/midi-js-soundfonts> 为准）。
如果你的使用场景不允许该许可，可删掉 `piano.js` 并让 `scheduleVoice`
回退到内置合成器（代码已保留回退路径）。

## 工具链（不随仓库分发）
- Android SDK `android.jar`（Apache-2.0），脚本按需下载
- R8 / D8（BSD-3-Clause），脚本按需下载
- Debian 包：`aapt`、`apksigner`、`zipalign`

## 字体与图形
界面全部使用系统字体；图标 `app/res/mipmap-*` 由本项目脚本绘制生成。
