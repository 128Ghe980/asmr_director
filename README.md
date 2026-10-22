# ASMR Director

面向中文 ASMR 内容制作的本地优先创作工作台，将文案策划、人声制作、分镜设计和 ComfyUI 视频批量生成串起来。

- **文案与分镜**：按主题生成、编辑台词和分镜，支持无对白镜头。
- **人声制作**：短句或整段生成，参考声音可替换；自动切分失败后，可试听原音并选择强制切分。
- **试听与选择**：保留原音和多个候选，由用户试听决定采用或重新生成。
- **视频批跑**：导出项目包，在另一台主机连接 ComfyUI；支持每镜多个候选、长时间等待、停止与断点继续，以及可选顺序合片。

当前开发版本位于 [`codex/voxcpm2-product-generation`](https://github.com/128Ghe980/asmr_director/tree/codex/voxcpm2-product-generation)。运行与本地模型配置见[网页应用说明](https://github.com/128Ghe980/asmr_director/blob/codex/voxcpm2-product-generation/apps/web/README.md)，视频批跑器用法见[批跑器说明](https://github.com/128Ghe980/asmr_director/blob/codex/voxcpm2-product-generation/tools/comfy-batch/README.zh.md)。模型、运行环境及音视频素材需另行准备。

项目仍在持续开发，当前进度见[项目路线](https://github.com/128Ghe980/asmr_director/blob/codex/voxcpm2-product-generation/docs/ROADMAP.md)。
