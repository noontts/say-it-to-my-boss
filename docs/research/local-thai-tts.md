# Open-source Thai TTS on a Mac

Reviewed 20 November 2026.

**Start with MakHamTTS and its `newvoice_male` voice for พี่นนท์.** PyThaiNLP documents a CPU-only ONNX backend in PyThaiTTS 1.0.0 and ships both a male and a female voicepack. The publisher lists the Kokoro-82M Thai base at 325.5 MB and labels the model repository Apache-2.0. The separate training dataset is CC BY 4.0. The Python wrapper downloads the checkpoint, configuration, and voicepack on first use. [Model card](https://huggingface.co/pythainlp/MakHamTTS) · [PyThaiTTS 1.0.0](https://pypi.org/project/PyThaiTTS/1.0.0/) · [ONNX backend and asset paths](https://pythainlp.org/PyThaiTTS/_modules/pythaitts/pretrained/makham/makham_tts.html) · [Dataset card](https://huggingface.co/datasets/pythainlp/MakHamTTS-dataset)

| Candidate | Fit for the game |
| --- | --- |
| **MakHamTTS Paradee** | About 8 MB for the INT8 ONNX graph, with one fixed female Thai voice. Audition it for a client or customer role, alongside the full model’s female voice. The same model repository lists Apache-2.0. [Browser demo](https://github.wannaphong.com/MakHamTTS/webdemo/) · [Model card](https://huggingface.co/pythainlp/MakHamTTS) |
| **FastThaiG2P + Thai Kokoro** | CPU ONNX support and one bundled Thai voice, `thai_som`. The default model, voicepack, and config download is about 330 MB. An additional baseline for Thai pronunciation. [AWS release](https://github.com/awslabs/FastThaiG2P/releases/tag/v0.3.0) · [PyThaiTTS docs](https://pythainlp.org/PyThaiTTS/#fastthaig2p-components) |
| **VoxCPM2** | Apache-2.0 base model with Thai support and voice design from a text description. Try it if the fixed MakHam voice still sounds like an assistant. The community 4-bit MLX checkpoint is 2.3 GB for Apple Silicon. Benchmark it on the Mac host before choosing it for live calls. [OpenBMB model card](https://huggingface.co/openbmb/VoxCPM2) · [Apple Silicon checkpoint and CLI](https://huggingface.co/mlx-community/VoxCPM2-4bit) |
| **Wayu-Paxa-TTS-Edge** | CPU inference and 12 fixed voices, including `m_mid_warm`. The code is Apache-2.0 and the weights are CC BY-NC 4.0, which limits this option to noncommercial use. [Official inference code](https://github.com/wayu-research/wayu-tts-inference) · [Weights and terms](https://huggingface.co/wayu-ai/wayu-paxa-tts-edge) · [Research paper](https://arxiv.org/abs/2609.03502) |

Compare the same boss opening and interruption against the current VachanaTTS voice on the same speakers. Listen for the pause before the question, sentence endings, and whether the voice sounds like a person asking for an answer on a call. The model benchmarks measure speed or speech accuracy and the audition is the test for character fit. Use a stable voice per character and measure warm synthesis separately from model startup. The MakHam backend caps each generation at 510 phonemes, so test longer NPC lines before switching the live worker. [Boss scenario](../../scenarios/angry-boss.json) · [Current voice worker](../../tts/server.py) · [MakHam generation source](https://pythainlp.org/PyThaiTTS/_modules/pythaitts/pretrained/makham/makham_tts.html)

## Local audition

PyThaiTTS 1.0.0 and ONNX Runtime 1.32.0 generated the three actual scenario openings on an Apple Silicon Mac. With the models cached and Hugging Face offline mode enabled, each engine completed five timed runs after warm-up with four ONNX threads.

| Scenario | Voice | Sample duration | Median synthesis and WAV write |
| --- | --- | --- | --- |
| Team lead | MakHamTTS `newvoice_male` | 3.84 s | 675 ms |
| Project client | MakHamTTS Paradee | 4.65 s | 33 ms |
| Retail customer | MakHamTTS `newvoice_female` | 4.38 s | 733 ms |

These timings cover local synthesis and writing the WAV. First-time download, model initialization, and browser playback were outside the timed runs. The comparison also generated the same boss line through the running VachanaTTS app.
