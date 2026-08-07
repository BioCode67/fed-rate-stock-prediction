# -*- coding: utf-8 -*-
"""
models.py — 점수를 매기는 모델들

모두 하는 일은 같습니다. 종목 하나의 팩터를 받아 **점수 하나**를 내놓습니다.
그 점수로 날짜마다 종목을 줄 세웁니다. 점수의 절대값은 의미가 없고 순서만 씁니다.

  mlp         : 오늘 하루치 팩터만 보는 기본 신경망. 빠르고 튼튼합니다.
  gru         : 최근 며칠의 흐름을 순서대로 읽는 순환 신경망. LSTM과 같은 계열입니다.
  transformer : 최근 며칠 중 '어느 날이 중요한지'를 스스로 고르는 어텐션 모델.
  ridge/lgbm  : 신경망이 정말 나은지 확인하기 위한 비교군.

GPU(A6000 등)가 있으면 gru/transformer가 특히 빨라집니다.
"""

from __future__ import annotations

import math
from typing import Optional

import numpy as np

try:
    import torch
    import torch.nn as nn
    HAS_TORCH = True
except ImportError:                                   # torch가 없어도 ridge는 돌아갑니다
    HAS_TORCH = False
    torch = None
    nn = object


if HAS_TORCH:
    class MLPScorer(nn.Module):
        def __init__(self, n_feat: int, hidden: int = 128, layers: int = 2, dropout: float = 0.2):
            super().__init__()
            mods, d = [], n_feat
            for _ in range(layers):
                mods += [nn.Linear(d, hidden), nn.LayerNorm(hidden), nn.GELU(), nn.Dropout(dropout)]
                d = hidden
            mods.append(nn.Linear(d, 1))
            self.net = nn.Sequential(*mods)

        def forward(self, x):                          # x: (B, F)
            return self.net(x).squeeze(-1)

    class GRUScorer(nn.Module):
        def __init__(self, n_feat: int, hidden: int = 128, layers: int = 2, dropout: float = 0.2):
            super().__init__()
            self.gru = nn.GRU(n_feat, hidden, num_layers=layers, batch_first=True,
                              dropout=dropout if layers > 1 else 0.0)
            self.head = nn.Sequential(nn.LayerNorm(hidden), nn.Dropout(dropout), nn.Linear(hidden, 1))

        def forward(self, x):                          # x: (B, L, F)
            out, _ = self.gru(x)
            return self.head(out[:, -1]).squeeze(-1)   # 마지막 날의 상태로 점수를 냅니다

    class PositionalEncoding(nn.Module):
        def __init__(self, d_model: int, max_len: int = 512):
            super().__init__()
            pe = torch.zeros(max_len, d_model)
            pos = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
            div = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
            pe[:, 0::2] = torch.sin(pos * div)
            pe[:, 1::2] = torch.cos(pos * div[:pe[:, 1::2].shape[1]])
            self.register_buffer("pe", pe.unsqueeze(0))

        def forward(self, x):
            return x + self.pe[:, : x.size(1)]

    class TransformerScorer(nn.Module):
        def __init__(self, n_feat: int, hidden: int = 128, layers: int = 2, dropout: float = 0.2,
                     heads: int = 4):
            super().__init__()
            self.proj = nn.Linear(n_feat, hidden)
            self.pos = PositionalEncoding(hidden)
            enc = nn.TransformerEncoderLayer(hidden, heads, hidden * 2, dropout,
                                             batch_first=True, norm_first=True, activation="gelu")
            self.enc = nn.TransformerEncoder(enc, layers)
            self.head = nn.Sequential(nn.LayerNorm(hidden), nn.Dropout(dropout), nn.Linear(hidden, 1))

        def forward(self, x):                          # x: (B, L, F)
            h = self.enc(self.pos(self.proj(x)))
            return self.head(h[:, -1]).squeeze(-1)


def needs_sequence(model_name: str) -> bool:
    return model_name in ("gru", "transformer")


def build_torch_model(cfg, n_feat: int):
    if not HAS_TORCH:
        raise SystemExit("[오류] PyTorch가 필요합니다:  pip install torch")
    if cfg.model == "mlp":
        return MLPScorer(n_feat, cfg.hidden, cfg.layers, cfg.dropout)
    if cfg.model == "gru":
        return GRUScorer(n_feat, cfg.hidden, cfg.layers, cfg.dropout)
    if cfg.model == "transformer":
        return TransformerScorer(n_feat, cfg.hidden, cfg.layers, cfg.dropout)
    raise SystemExit(f"[오류] 모르는 신경망 모델: {cfg.model}")


# ---------------------------------------------------------------------------
#  비교군 (신경망이 정말 나은지 확인하려면 단순한 모델과 꼭 비교해야 합니다)
# ---------------------------------------------------------------------------
class RidgeScorer:
    """선형 회귀 + 규제. 아주 빠르고, 이걸 못 이기는 신경망은 의미가 없습니다."""

    name = "ridge"

    def __init__(self, alpha: float = 1.0):
        self.alpha = alpha
        self.w: Optional[np.ndarray] = None
        self.b: float = 0.0

    def fit(self, X: np.ndarray, y: np.ndarray):
        X = X.reshape(len(X), -1).astype(np.float64)
        mu, ymu = X.mean(axis=0), float(y.mean())
        Xc, yc = X - mu, y - ymu
        A = Xc.T @ Xc + self.alpha * np.eye(Xc.shape[1])
        self.w = np.linalg.solve(A, Xc.T @ yc)
        self.mu, self.b = mu, ymu
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        X = X.reshape(len(X), -1).astype(np.float64)
        return (X - self.mu) @ self.w + self.b


class LGBMScorer:
    """LightGBM. 표 형태 데이터에서 여전히 아주 강한 비교군입니다."""

    name = "lgbm"

    def __init__(self, seed: int = 42, n_estimators: int = 300, lr: float = 0.02):
        try:
            import lightgbm as lgb
        except ImportError:
            raise SystemExit("[오류] LightGBM이 필요합니다:  pip install lightgbm")
        self.lgb = lgb
        # 금융 데이터는 신호 대비 잡음이 크므로 나무를 얕고 보수적으로 둡니다.
        # (기본값 그대로 쓰면 과적합해 IC가 음수로 나오는 일이 흔합니다)
        self.params = dict(n_estimators=n_estimators, learning_rate=lr, num_leaves=15,
                           max_depth=4, subsample=0.7, subsample_freq=1, colsample_bytree=0.7,
                           min_child_samples=100, reg_lambda=1.0,
                           random_state=seed, verbose=-1, n_jobs=-1)
        self.model = None

    def fit(self, X: np.ndarray, y: np.ndarray):
        self.model = self.lgb.LGBMRegressor(**self.params)
        self.model.fit(X.reshape(len(X), -1), y)
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self.model.predict(X.reshape(len(X), -1))
