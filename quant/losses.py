# -*- coding: utf-8 -*-
"""
losses.py — 무엇을 잘하도록 학습시킬 것인가

보통의 머신러닝은 '오차를 줄이도록' 배웁니다(MSE). 그런데 퀀트에서 정말 필요한 것은
정확한 수익률 값이 아니라 **줄 세우기**입니다. 어떤 종목이 다른 종목보다 더 오를지
순서만 맞으면 돈은 벌립니다. 값 자체는 틀려도 됩니다.

그래서 IC(Information Coefficient, 예측과 실제 수익률의 상관계수)를 직접 최대화합니다.
이것이 일반 ML 코드와 퀀트 코드의 가장 큰 차이입니다.

  IC = 0.02 ~ 0.05  이면 실무에서 쓸 만한 신호로 봅니다. (정확도 51~53%에 해당)
  IC = 0.3 처럼 크게 나오면 거의 확실히 데이터 누수입니다.
"""

from __future__ import annotations

import torch


def grouped_pearson(pred: torch.Tensor, y: torch.Tensor, g: torch.Tensor,
                    n_groups: int, eps: float = 1e-8) -> torch.Tensor:
    """날짜(그룹)마다 예측과 정답의 상관계수를 구합니다. 반환 (n_groups,)"""
    ones = torch.ones_like(pred)
    cnt = torch.zeros(n_groups, device=pred.device, dtype=pred.dtype).index_add_(0, g, ones)
    cnt = cnt.clamp(min=1.0)
    mp = torch.zeros_like(cnt).index_add_(0, g, pred) / cnt
    my = torch.zeros_like(cnt).index_add_(0, g, y) / cnt
    dp, dy = pred - mp[g], y - my[g]
    cov = torch.zeros_like(cnt).index_add_(0, g, dp * dy)
    vp = torch.zeros_like(cnt).index_add_(0, g, dp * dp)
    vy = torch.zeros_like(cnt).index_add_(0, g, dy * dy)
    return cov / torch.sqrt(vp * vy + eps)


def ic_loss(pred: torch.Tensor, y: torch.Tensor, g: torch.Tensor, n_groups: int) -> torch.Tensor:
    """IC를 크게 만들고 싶으므로 부호를 뒤집어 손실로 씁니다."""
    corr = grouped_pearson(pred, y, g, n_groups)
    corr = corr[torch.isfinite(corr)]
    if corr.numel() == 0:
        return pred.sum() * 0.0
    return -corr.mean()


def mse_loss(pred: torch.Tensor, y: torch.Tensor, *_args) -> torch.Tensor:
    return torch.mean((pred - y) ** 2)


def bce_loss(pred: torch.Tensor, y: torch.Tensor, *_args) -> torch.Tensor:
    """정답을 위/아래로만 나눠 보는 방식(라벨이 -1~1 순위값이라 0 기준으로 자릅니다)."""
    target = (y > 0).float()
    return torch.nn.functional.binary_cross_entropy_with_logits(pred, target)


def get_loss(name: str):
    return {"ic": ic_loss, "mse": mse_loss, "bce": bce_loss}.get(name, ic_loss)
