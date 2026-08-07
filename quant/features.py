# -*- coding: utf-8 -*-
"""
features.py — 팩터(특징) 만들기

퀀트에서 '팩터'는 종목을 줄 세우는 기준입니다. 모멘텀이 좋은 종목, 덜 출렁이는 종목,
거래가 갑자기 늘어난 종목… 이런 값을 날짜마다 계산해 두고 서로 비교합니다.

여기서 지키는 두 가지 원칙이 있습니다.

1. 횡단면 정규화 (cross-sectional normalization)
   값을 그대로 쓰지 않고 '그날 종목들 사이에서 몇 등인지'로 바꿉니다(-1 ~ +1).
   그러면 시장 전체가 급등락한 날에도 값의 크기가 변하지 않아 학습이 안정적이고,
   "시장이 올랐다"가 아니라 "남들보다 잘했다"만 남습니다.

2. 미래를 절대 쓰지 않기
   모든 팩터는 t 시점까지의 값만 씁니다. 정답(라벨)만 미래를 봅니다.
   평균·표준편차 같은 통계도 과거 구간(rolling)에서만 구합니다.
"""

from __future__ import annotations

from typing import List, Tuple

import numpy as np

from .config import Config
from .data import Panel


# ---------------------------------------------------------------------------
#  작은 도우미들 (모두 (T, N) 배열을 다룹니다)
# ---------------------------------------------------------------------------
def _shift(a: np.ndarray, k: int) -> np.ndarray:
    """k일 전 값. 앞부분은 NaN."""
    out = np.full_like(a, np.nan)
    if k < a.shape[0]:
        out[k:] = a[:-k] if k > 0 else a
    return out


def _roll_mean(a: np.ndarray, w: int) -> np.ndarray:
    out = np.full_like(a, np.nan)
    csum = np.nancumsum(np.nan_to_num(a, nan=0.0), axis=0)
    cnt = np.cumsum(np.isfinite(a), axis=0)
    for t in range(w - 1, a.shape[0]):
        s = csum[t] - (csum[t - w] if t >= w else 0)
        c = cnt[t] - (cnt[t - w] if t >= w else 0)
        with np.errstate(invalid="ignore", divide="ignore"):
            out[t] = np.where(c > 0, s / np.maximum(c, 1), np.nan)
    return out


def _roll_std(a: np.ndarray, w: int) -> np.ndarray:
    m = _roll_mean(a, w)
    m2 = _roll_mean(a * a, w)
    with np.errstate(invalid="ignore"):
        var = np.maximum(m2 - m * m, 0.0)
    return np.sqrt(var)


def cross_rank(a: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """
    날짜마다 종목들을 줄 세워 -1 ~ +1 로 바꿉니다.
    (가장 낮은 종목 -1, 가장 높은 종목 +1, 가운데 0)
    이상치가 있어도 순위는 흔들리지 않으므로 퀀트에서 표준으로 씁니다.
    """
    out = np.full_like(a, np.nan, dtype=np.float64)
    for t in range(a.shape[0]):
        m = valid[t] & np.isfinite(a[t])
        n = int(m.sum())
        if n < 3:
            continue
        vals = a[t, m]
        order = vals.argsort(kind="mergesort")
        ranks = np.empty(n, dtype=np.float64)
        ranks[order] = np.arange(n, dtype=np.float64)
        # 동점 처리: 같은 값이면 평균 순위
        uniq, inv, cnt = np.unique(vals, return_inverse=True, return_counts=True)
        if len(uniq) < n:
            sums = np.zeros(len(uniq))
            np.add.at(sums, inv, ranks)
            ranks = (sums / cnt)[inv]
        out[t, m] = 2.0 * ranks / (n - 1) - 1.0
    return out


def time_zscore(a: np.ndarray, w: int = 252) -> np.ndarray:
    """시계열 z점수(과거 w일 기준). 매크로처럼 모든 종목이 공유하는 값에 씁니다."""
    m, s = _roll_mean(a, w), _roll_std(a, w)
    with np.errstate(invalid="ignore", divide="ignore"):
        z = (a - m) / np.where(s > 1e-12, s, np.nan)
    return np.clip(z, -5, 5)


# ---------------------------------------------------------------------------
#  팩터 계산
# ---------------------------------------------------------------------------
def build_features(panel: Panel, cfg: Config) -> Tuple[np.ndarray, List[str], np.ndarray]:
    """
    반환
      X      (T, N, F) 팩터 (횡단면 정규화 완료, 결측은 0)
      names  팩터 이름
      valid  (T, N) 이 날 이 종목을 쓸 수 있는지
    """
    close, volume = panel.close, panel.volume
    T, N = close.shape

    with np.errstate(invalid="ignore", divide="ignore"):
        ret = close / _shift(close, 1) - 1.0

    # 유효성: 가격이 있고, 최소 60일 이상 이력이 쌓였고, 값이 멈춰 있지 않은 종목
    has_px = np.isfinite(close)
    hist = np.cumsum(has_px, axis=0)
    valid = has_px & (hist >= 60) & np.isfinite(ret)

    feats, names = [], []

    def add(arr, name, rank=True):
        feats.append(cross_rank(arr, valid) if rank else arr)
        names.append(name)

    # --- 모멘텀 계열 ---
    for w in (5, 20, 60, 120):
        with np.errstate(invalid="ignore", divide="ignore"):
            add(close / _shift(close, w) - 1.0, f"모멘텀{w}일")
    with np.errstate(invalid="ignore", divide="ignore"):
        add(_shift(close, 21) / _shift(close, 252) - 1.0, "모멘텀12-1개월")   # 고전적 팩터
    add(ret, "전일수익률")                                                   # 단기 반전

    # --- 추세/이격 ---
    ma5, ma20, ma60 = _roll_mean(close, 5), _roll_mean(close, 20), _roll_mean(close, 60)
    with np.errstate(invalid="ignore", divide="ignore"):
        add(close / ma20 - 1.0, "20일이격도")
        add(close / ma60 - 1.0, "60일이격도")
        add(ma5 / ma20 - 1.0, "단기추세")

    # --- 위험 계열 ---
    vol20, vol60 = _roll_std(ret, 20), _roll_std(ret, 60)
    add(vol20, "변동성20일")
    add(vol60, "변동성60일")
    with np.errstate(invalid="ignore", divide="ignore"):
        add(vol20 / np.where(vol60 > 1e-12, vol60, np.nan), "변동성변화")
    down = np.where(ret < 0, ret, 0.0)
    add(_roll_std(down, 60), "하락변동성")

    # 시장 대비 베타 (동일가중 시장 수익률 기준, 과거 120일)
    mkt = np.nanmean(np.where(valid, ret, np.nan), axis=1, keepdims=True)
    mkt_full = np.repeat(mkt, N, axis=1)
    cov = _roll_mean(ret * mkt_full, 120) - _roll_mean(ret, 120) * _roll_mean(mkt_full, 120)
    var_m = _roll_mean(mkt_full * mkt_full, 120) - _roll_mean(mkt_full, 120) ** 2
    with np.errstate(invalid="ignore", divide="ignore"):
        add(cov / np.where(var_m > 1e-14, var_m, np.nan), "시장베타")

    # --- 거래량 계열 ---
    if np.isfinite(volume).any():
        lv = np.log1p(np.where(np.isfinite(volume), volume, np.nan))
        add(lv - _roll_mean(lv, 20), "거래량급증")
        add(_roll_mean(lv, 20), "거래활발도")

    # --- 금리 민감도 (이 프로젝트의 주제) ---
    #     최근 120일 동안 '금리가 움직일 때 이 종목이 같이 움직인 정도'
    if panel.macro.shape[1] > 0:
        rate = panel.macro[:, 0]
        d_rate = np.concatenate([[0.0], np.diff(rate)])[:, None]
        d_rate_full = np.repeat(d_rate, N, axis=1)
        cov_r = _roll_mean(ret * d_rate_full, 120) - _roll_mean(ret, 120) * _roll_mean(d_rate_full, 120)
        var_r = _roll_mean(d_rate_full ** 2, 120) - _roll_mean(d_rate_full, 120) ** 2
        with np.errstate(invalid="ignore", divide="ignore"):
            add(cov_r / np.where(var_r > 1e-14, var_r, np.nan), "금리민감도")

    # --- 매크로 (모든 종목이 공유하는 값이라 시계열 z점수로 넣습니다) ---
    if cfg.use_macro and panel.macro.shape[1] > 0:
        for j, nm in enumerate(panel.macro_names):
            col = panel.macro[:, j]
            z_level = time_zscore(col[:, None], 252)
            d20 = col - np.concatenate([np.full(20, np.nan), col[:-20]])
            z_chg = time_zscore(d20[:, None], 252)
            feats.append(np.repeat(np.nan_to_num(z_level), N, axis=1)); names.append(f"매크로:{nm}")
            feats.append(np.repeat(np.nan_to_num(z_chg), N, axis=1)); names.append(f"매크로:{nm}변화")

    X = np.stack(feats, axis=2).astype(np.float32)
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    valid &= np.isfinite(close)
    return X, names, valid


# ---------------------------------------------------------------------------
#  정답(라벨) 만들기
# ---------------------------------------------------------------------------
def build_labels(panel: Panel, cfg: Config, valid: np.ndarray):
    """
    y_raw   (T, N)  horizon일 뒤까지의 수익률
    y       (T, N)  학습에 쓰는 값 (초과수익을 횡단면 순위로 바꾼 것)
    ok      (T, N)  정답이 있는 자리 (마지막 horizon일은 미래가 없어 False)
    """
    close = panel.close
    h = cfg.horizon
    T = close.shape[0]
    fwd = np.full_like(close, np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        fwd[:T - h] = close[h:] / close[:T - h] - 1.0

    ok = valid & np.isfinite(fwd)

    if cfg.label == "excess":
        mkt = np.nanmean(np.where(ok, fwd, np.nan), axis=1, keepdims=True)
        target = fwd - mkt          # 시장 전체가 오른 부분은 빼고 '상대 성과'만 남김
    else:
        target = fwd

    if cfg.label_transform == "rank":
        y = cross_rank(target, ok)
    elif cfg.label_transform == "zscore":
        m = np.nanmean(np.where(ok, target, np.nan), axis=1, keepdims=True)
        s = np.nanstd(np.where(ok, target, np.nan), axis=1, keepdims=True)
        y = np.clip((target - m) / np.where(s > 1e-12, s, np.nan), -4, 4)
    else:
        y = target

    y = np.nan_to_num(y, nan=0.0).astype(np.float32)
    return fwd.astype(np.float32), y, ok
