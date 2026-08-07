# -*- coding: utf-8 -*-
"""
datasets.py — 학습용 데이터 묶기와 기간 나누기

핵심은 '어떻게 나누느냐'입니다. 시계열에서는 여기서 대부분의 사고가 납니다.

    [--------- 학습 ---------][purge][검증][embargo][--- 시험(예측) ---]
                                 ↑                ↑
                    정답이 겹치는 구간을 잘라냄   완충 구간

  purge   : 정답이 horizon일 뒤를 보므로, 학습 마지막 며칠의 정답은 검증 구간과 겹칩니다.
            그 며칠을 버립니다. 안 버리면 모델이 답을 살짝 엿본 셈이 됩니다.
  embargo : 겹침이 없어도 바로 옆 날짜는 서로 너무 닮아 있습니다. 며칠 비웁니다.

이 두 가지는 금융 머신러닝에서 표준으로 쓰는 안전장치입니다.
그리고 시험 구간이 끝나면 그 구간을 학습에 넣고 다시 배웁니다(워크포워드).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator, List, Optional, Tuple

import numpy as np

from .config import Config


@dataclass
class Fold:
    train: Tuple[int, int]
    valid: Tuple[int, int]
    test: Tuple[int, int]

    def sizes(self) -> str:
        return (f"학습 {self.train[1] - self.train[0]:4d}일 / "
                f"검증 {self.valid[1] - self.valid[0]:3d}일 / "
                f"시험 {self.test[1] - self.test[0]:3d}일")


def walk_forward_folds(T: int, cfg: Config, min_train: int = 250) -> List[Fold]:
    folds: List[Fold] = []
    gap = cfg.horizon + cfg.embargo          # purge + embargo
    t0 = int(T * cfg.start_frac)

    for ts in range(t0, T, cfg.test_days):
        te = min(ts + cfg.test_days, T)
        valid_end = ts - gap
        valid_start = valid_end - cfg.valid_days
        train_end = valid_start - gap
        train_start = 0 if cfg.train_days <= 0 else max(0, train_end - cfg.train_days)
        if valid_start <= 0 or train_end - train_start < min_train:
            continue
        if te - ts < 5:
            continue
        folds.append(Fold((train_start, train_end), (valid_start, valid_end), (ts, te)))
    if not folds:
        raise SystemExit("[오류] 검증 구간을 만들 수 없습니다. 기간을 늘리거나 "
                         "train_days/valid_days/test_days를 줄이세요.")
    return folds


# ---------------------------------------------------------------------------
#  날짜 단위 배치
#  퀀트 손실(IC)은 '같은 날 종목들끼리' 비교하므로, 배치를 날짜 단위로 묶습니다.
# ---------------------------------------------------------------------------
class PanelBatcher:
    def __init__(self, X: np.ndarray, y: np.ndarray, ok: np.ndarray,
                 seq_len: int = 1, min_stocks: int = 10):
        self.X, self.y, self.ok = X, y, ok
        self.seq_len = max(1, seq_len)
        self.min_stocks = min_stocks
        self.T, self.N, self.F = X.shape
        self.mu = np.zeros(self.F, dtype=np.float32)
        self.sd = np.ones(self.F, dtype=np.float32)

    def fit_scaler(self, lo: int, hi: int) -> None:
        """표준화 통계는 학습 구간에서만 구합니다(누수 방지)."""
        sub = self.X[lo:hi][self.ok[lo:hi]]
        if len(sub) > 10:
            self.mu = sub.mean(axis=0)
            sd = sub.std(axis=0)
            self.sd = np.where(sd > 1e-6, sd, 1.0).astype(np.float32)

    def usable_dates(self, lo: int, hi: int) -> np.ndarray:
        need = self.seq_len - 1
        dates = np.arange(max(lo, need), hi)
        counts = self.ok[dates].sum(axis=1)
        return dates[counts >= self.min_stocks]

    def gather(self, dates: np.ndarray):
        """
        반환
          x     (B, F) 또는 (B, L, F)   — 종목 하나가 표본 하나
          y     (B,)
          gidx  (B,)  각 표본이 몇 번째 날짜인지 (같은 날끼리 묶어 IC를 계산할 때 씀)
        """
        xs, ys, gs = [], [], []
        L = self.seq_len
        for gi, t in enumerate(dates):
            m = self.ok[t]
            if m.sum() < self.min_stocks:
                continue
            if L == 1:
                xs.append(self.X[t][m])
            else:
                win = self.X[t - L + 1:t + 1][:, m, :]        # (L, n, F)
                xs.append(np.transpose(win, (1, 0, 2)))       # (n, L, F)
            ys.append(self.y[t][m])
            gs.append(np.full(int(m.sum()), gi, dtype=np.int64))
        if not xs:
            return None
        x = np.concatenate(xs, axis=0)
        x = (x - self.mu) / self.sd
        return (x.astype(np.float32), np.concatenate(ys).astype(np.float32),
                np.concatenate(gs))

    def iter_batches(self, dates: np.ndarray, batch_dates: int, shuffle: bool = True,
                     rng: Optional[np.random.Generator] = None) -> Iterator:
        order = dates.copy()
        if shuffle:
            (rng or np.random.default_rng(0)).shuffle(order)
        for i in range(0, len(order), batch_dates):
            chunk = np.sort(order[i:i + batch_dates])
            out = self.gather(chunk)
            if out is not None:
                yield out
