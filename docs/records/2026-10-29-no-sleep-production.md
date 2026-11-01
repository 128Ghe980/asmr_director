# 助眠禁止：清醒用品柜台

用户要求“再来一个，禁止助眠版的，禁止万圣节”。沿用约5分钟、竖屏及完成至批跑的目标，换为既有`forbidden-counter-trade`（助眠禁止）模板和模板固定的`character_framing`。不修改产品源码、部署、暂停的质量优化路线或其他已完成工程。

## 已完成的内容准备

新工程`asmr_no_sleep_20261029102721`，标题《清醒用品，请小声挑》。28个逻辑段：10句短台词、18段无台词270秒；原稿估时328秒，实际时长必须等新人声后重算。三件闭盖商品按左/中/右固定为红棕木圆盒、蓝色厚纸方盒、透明玻璃方瓶，通过秘密推销、虚构币报价与反差小玩笑衔接材质声音。没有万圣节、女巫、南瓜或节庆剧情。

2026-10-29 10:24 UTC只读查询既有DeepSeek配置的官方余额接口，HTTP200但`is_available=false`。未重复付费生成，脚本及设计均由助手创作，明确记录来源；不冒充外部模型成功。初稿经正式schema及独立审查，18段无台词约221秒是材质操作，其余为拿放、转场与等待。28段英文画面/材质声设计草案和连续parts准备完成，但没有用估计语音时长或零PCM冒充正式有声设计、后处理或批跑成品。

QA：`I:/AI/asmr_director/qa/no-sleep/2026-10-29/`。`initial-project.json`、`initial-library.json`、`planner-source.json`、`tts-script.json`为冻结初稿；`.local/no-sleep-content.cjs`及`no-sleep-design-spec.cjs`为内容辅助。第25段“想先听哪一件”在全部试听后可改成“还想听哪一件”，属于已记录的非阻塞措辞建议；当前为保护输入哈希和语音白名单未改稿。

## 实际阻塞：新人声内存保护中止

本次没有复用万圣节人声。选择产品已有温柔中文参考`soft_zh`（完整6.9秒）、`reference_only`、`clip`，不裁参考或修改产品默认。`.local/no-sleep-voices.cjs --first-only`只尝试第一句“你也来买清醒用品？”，每任务最多一次。正式产品API启动native16532；任务专属guard以50ms采样、1.5GiB提交余量下限保护，并核对父Node19492、CLI完整路径、10条本轮文本白名单。

首条在全局提交余量降至1,558,786,048bytes（约1.452GiB）时被终止，共57采样，没有成功WAV或采用结果，未同条件重试。native和guard15872均退出，未关闭其他应用或改系统设置。证据在`guard/run-20261029-182750/`和`guard/stop-receipt.json`；`voice-checkpoint.json`、`voice-status.json`如实为stopped，首条attempt=1。

备用GPT-SoVITS的catalog `available=true`只表示配置存在，9880无监听且GET拒绝连接；参考也不是soft_zh。只读调查后没有启动该服务、改变参考或绕过保护。根已通过异步问题请用户先保存并关闭不用的大软件，等待用户明确回复后重测资源。不能把等待时间当成资源已恢复或用户已答复。

## 继续方式与验收边界

用户回复资源已腾出后，先重新检查当前服务、活动任务、提交余量及守护。保留本次失败证据，创建新guard运行及ready回执；只有在资源确有改善且新guard已就绪时，显式备份并重置首条失败attempt，再按同参考/同文案运行`no-sleep-voices.cjs --first-only`。一条成功后才继续剩余9条；再次保护中止就停止，不循环重试。

新人声全部正式采用后，`voices-project.json`才是设计实测时长的依据。随后完成正式画面/声音、助手编写D位置方案（schema兼容provider字面值与真实来源分别记录）、本地真实渲染回执、导出portrait包、全部禁网主/ASMR payload核验。验证脚本已准备为`.local/verify-no-sleep-package.py`及`no-sleep-verify-schema.cjs`，尚未执行最终包验证；D渲染器的实际输出为48kHz双声道PCM24，不能误断言PCM16。

当前只完成内容准备，没有完整批跑ZIP、实际H3或最终合片，不称语音/后处理完成。没有改用户浏览器工程、旧交付文件或发布新版本；本轮无Git提交/推送。恢复前同时查看本QA最新状态和后续用户答复。

可读稿已交付至`artifacts/h3-asmr/No-sleep-2026-10-29/No-sleep-script.html`，同目录`No-sleep-draft-project.json`为冻结初稿原样副本，10条音频状态都pending。QA `prepared-designs.json`明确`authored-pending-real-voices`，28设计草案、18无台词/56连续块共270秒通过正式part/schema；formalSpeechShots=0。`.local/no-sleep-finish.cjs --export`已准备且仅跑`--prepare-only`，没有发出D/导出请求；需要全部10条真实已采用的`voices-project.json`后才会继续并封存。最终portrait补写及禁网验证由独立验证器执行，不能把准备检查当最终验收。范围外28文件哈希保持，见`source-protection.json`。
