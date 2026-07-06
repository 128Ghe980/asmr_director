# Third-Party Runtimes

Last updated: 2026-07-06

This file records external runtime projects and model assets used during local experiments or planned provider integration. It is not legal advice; re-check upstream licenses and model terms before redistribution, hosted service launch, commercial release, or publishing generated voice packs.

## GPT-SoVITS

Current role in ASMR Director:

- Used as the first local TTS runtime candidate for roadmap step 7, Real Generation MVP.
- Used only from a separate local runtime directory: `D:\CodexWorkplace\asmr_director_runtime`.
- Not vendored into this repository.
- Not committed together with model weights, generated audio, user reference audio, or local Python environments.

Local runtime details from the 2026-07-06 experiment:

- Upstream repository: `https://github.com/RVC-Boss/GPT-SoVITS.git`
- Local repository: `D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\GPT-SoVITS`
- Local checked commit: `bf81cdb`
- Root code license observed locally: MIT License, copyright RVC-Boss, from `LICENSE`.
- Local API endpoint used: `http://127.0.0.1:9880/tts`

Important licensing and ownership boundaries:

- The MIT license above applies to the GPT-SoVITS code as observed in the local checkout.
- Pretrained models, ASR models, vocoders, and other downloaded weights may have their own source terms. Do not assume the root code license covers every model file.
- User-provided reference audio and voice packs require separate authorization or consent metadata.
- Generated voice clips may inherit practical or contractual restrictions from the reference audio, voice pack, model weights, and intended use case.
- The product should describe imported voices as authorized or original voice cards, not as public-person or commercial-character cloning.

Repository policy:

- Keep runtime engines, model weights, caches, temporary files, generated WAVs, and user reference audio outside this repository.
- Commit only source code, provider adapters, docs, small config schemas, and safe sample metadata.
- If a future change vendors third-party code or redistributes model weights, add the exact upstream version, license, notices, and redistribution terms here before merging.
