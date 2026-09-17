# Figure Selection Guide

Use this reference when several candidate paper figures or tables are available.

## Logic Figure Priority

1. **Method overview**: the paper's central pipeline or architecture.
2. **Problem framing**: a figure that explains why the method is needed.
3. **Algorithm flow**: step-by-step procedure when the paper is algorithm-heavy.
4. **Generated schematic**: use `ian-xiaohei-illustrations` when the paper has no clear logic figure or the article needs a simpler Chinese explanatory image.

The logic figure should help a reader understand the method before reading formulas.

## Evidence Figure Priority

1. **Main benchmark table**: strongest head-to-head evidence for the paper's main claim.
2. **Core ablation**: best proof that the proposed component matters.
3. **Scaling or efficiency plot**: use when the claim is about cost, data, speed, sample efficiency, or scaling.
4. **Qualitative comparison**: use only when the paper's claim is visual or when quantitative tables are weak.

The evidence figure should answer: "What result would I show if I had only one slide to convince someone?"

## Captions

Use concise captions:

- `来自论文 Figure 2，展示 Flow-OPD 的整体训练路径。`
- `来自论文 Table 1，主实验显示 OPD 相比直接 RL 更稳定。`
- `自绘示意图，用于解释 DiffusionOPD 的策略蒸馏逻辑。`

Avoid long captions; put detailed discussion in the surrounding paragraph.
