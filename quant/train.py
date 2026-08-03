# -*- coding: utf-8 -*-
"""
train.py — 워크포워드 학습

한 번 학습하고 끝내지 않습니다. 시간을 따라가며 이렇게 반복합니다.

    [학습] → [검증으로 조기 종료] → [그 다음 구간 예측] → 구간을 넘겨 다시 학습 → …

예측은 언제나 '그 시점까지만 아는 모델'이 만든 것이므로 미래를 보지 않습니다.
시드를 바꿔 여러 번 학습한 뒤 평균내면(앙상블) 운에 덜 흔들립니다.

GPU가 있으면 자동으로 씁니다. A6000이라면 --amp 로 bf16 혼합정밀도까지 켜집니다.
"""

from __future__ import annotations

import copy
import time
from typing import Dict, List

import numpy as np

from .config import Config
from .datasets import Fold, PanelBatcher, walk_forward_folds
from .metrics import daily_ic
from .models import HAS_TORCH, LGBMScorer, RidgeScorer, build_torch_model, needs_sequence

if HAS_TORCH:
    import torch
    from .losses import get_loss, grouped_pearson


def _standardize_rows(v: np.ndarray) -> np.ndarray:
    s = v.std()
    return (v - v.mean()) / s if s > 1e-12 else v * 0.0


def _valid_ic_torch(model, batcher: PanelBatcher, dates: np.ndarray, device, batch_dates: int) -> float:
    """검증 구간의 평균 IC. 조기 종료 기준으로 씁니다(손실 대신 실제 목표를 봅니다)."""
    model.eval()
    ics = []
    with torch.no_grad():
        for i in range(0, len(dates), batch_dates):
            out = batcher.gather(np.sort(dates[i:i + batch_dates]))
            if out is None:
                continue
            x, y, g = out
            xt = torch.from_numpy(x).to(device)
            yt = torch.from_numpy(y).to(device)
            gt = torch.from_numpy(g).to(device)
            pred = model(xt).float()
            corr = grouped_pearson(pred, yt, gt, int(gt.max().item()) + 1)
            corr = corr[torch.isfinite(corr)]
            if corr.numel():
                ics.append(corr.mean().item())
    model.train()
    return float(np.mean(ics)) if ics else float("nan")


def _train_one_torch(cfg: Config, batcher: PanelBatcher, fold: Fold, seed: int, device: str,
                     log: bool = True):
    torch.manual_seed(seed)
    np.random.seed(seed)
    rng = np.random.default_rng(seed)

    model = build_torch_model(cfg, batcher.F).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=max(2, cfg.epochs))
    loss_fn = get_loss(cfg.loss)

    train_dates = batcher.usable_dates(*fold.train)
    valid_dates = batcher.usable_dates(*fold.valid)
    if len(train_dates) < 20 or len(valid_dates) < 5:
        return None, float("nan")

    use_amp = bool(cfg.amp and device.startswith("cuda"))
    best_ic, best_state, bad = -1e9, None, 0

    for ep in range(cfg.epochs):
        for x, y, g in batcher.iter_batches(train_dates, cfg.batch_dates, shuffle=True, rng=rng):
            xt = torch.from_numpy(x).to(device, non_blocking=True)
            yt = torch.from_numpy(y).to(device, non_blocking=True)
            gt = torch.from_numpy(g).to(device, non_blocking=True)
            opt.zero_grad(set_to_none=True)
            if use_amp:
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    pred = model(xt)
                    loss = loss_fn(pred.float(), yt, gt, int(gt.max().item()) + 1)
            else:
                pred = model(xt)
                loss = loss_fn(pred, yt, gt, int(gt.max().item()) + 1)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        sched.step()

        vic = _valid_ic_torch(model, batcher, valid_dates, device, cfg.batch_dates)
        if np.isfinite(vic) and vic > best_ic + 1e-5:
            best_ic, bad = vic, 0
            best_state = copy.deepcopy(model.state_dict())
        else:
            bad += 1
            if bad >= cfg.patience:
                break

    if best_state is not None:
        model.load_state_dict(best_state)
    return model, best_ic


def _predict_torch(model, batcher: PanelBatcher, dates: np.ndarray, ok: np.ndarray,
                   scores: np.ndarray, device: str) -> None:
    model.eval()
    with torch.no_grad():
        for t in dates:
            out = batcher.gather(np.array([t]))
            if out is None:
                continue
            x, _, _ = out
            pred = model(torch.from_numpy(x).to(device)).float().cpu().numpy()
            scores[t, ok[t]] = _standardize_rows(pred)   # 날짜별로 크기를 맞춰 둡니다
    model.train()


def _run_sklearn_fold(cfg: Config, batcher: PanelBatcher, fold: Fold, ok: np.ndarray,
                      scores: np.ndarray, seed: int) -> None:
    train_dates = batcher.usable_dates(*fold.train)
    test_dates = batcher.usable_dates(*fold.test)
    tr = batcher.gather(train_dates)
    if tr is None:
        return
    x, y, _ = tr
    model = RidgeScorer(alpha=1.0) if cfg.model == "ridge" else LGBMScorer(seed=seed)
    model.fit(x, y)
    for t in test_dates:
        out = batcher.gather(np.array([t]))
        if out is None:
            continue
        pred = model.predict(out[0])
        scores[t, ok[t]] = _standardize_rows(pred)


def train_walk_forward(X: np.ndarray, y: np.ndarray, fwd: np.ndarray, ok: np.ndarray,
                       cfg: Config) -> Dict:
    T, N, F = X.shape
    seq = cfg.seq_len if needs_sequence(cfg.model) else 1
    batcher = PanelBatcher(X, y, ok, seq_len=seq)
    folds = walk_forward_folds(T, cfg)
    device = cfg.resolved_device()

    scores = np.full((T, N), np.nan, dtype=np.float64)
    fold_logs: List[Dict] = []

    print(f"\n[학습] 모델={cfg.model} 손실={cfg.loss} 장치={device} "
          f"앙상블={cfg.ensemble} 특징={F}개 시퀀스={seq}일")
    print(f"[학습] 워크포워드 {len(folds)}구간 · 예측시계 {cfg.horizon}일 · "
          f"purge+embargo {cfg.horizon + cfg.embargo}일")

    t_start = time.time()
    for fi, fold in enumerate(folds):
        batcher.fit_scaler(*fold.train)
        t0 = time.time()

        if cfg.model in ("ridge", "lgbm"):
            _run_sklearn_fold(cfg, batcher, fold, ok, scores, cfg.seed + fi)
            vic = float("nan")
        else:
            if not HAS_TORCH:
                raise SystemExit("[오류] PyTorch가 필요합니다:  pip install torch")
            test_dates = batcher.usable_dates(*fold.test)
            # 앙상블: 시드를 바꿔 여러 번 학습한 예측을 종목별로 평균냅니다.
            acc = np.zeros((len(test_dates), N))
            cnt = np.zeros((len(test_dates), N))
            vics = []
            for k in range(max(1, cfg.ensemble)):
                model, vic_k = _train_one_torch(cfg, batcher, fold, cfg.seed + 1000 * k + fi, device)
                if model is None:
                    continue
                vics.append(vic_k)
                tmp = np.full((T, N), np.nan)
                _predict_torch(model, batcher, test_dates, ok, tmp, device)
                for r, t in enumerate(test_dates):
                    m = np.isfinite(tmp[t])
                    acc[r, m] += tmp[t, m]
                    cnt[r, m] += 1.0
                del model
                if device.startswith("cuda"):
                    torch.cuda.empty_cache()
            for r, t in enumerate(test_dates):
                scores[t] = np.where(cnt[r] > 0, acc[r] / np.maximum(cnt[r], 1.0), np.nan)
            vic = float(np.nanmean(vics)) if vics else float("nan")

        # 이 구간 성적
        ts, te = fold.test
        ic_f, ric_f = daily_ic(scores[ts:te], fwd[ts:te], ok[ts:te])
        m_ic = float(np.nanmean(ic_f)) if np.isfinite(ic_f).any() else float("nan")
        fold_logs.append({
            "fold": fi, "train": fold.train, "valid": fold.valid, "test": fold.test,
            "valid_ic": vic, "test_ic": m_ic, "seconds": round(time.time() - t0, 1),
        })
        print(f"  구간 {fi + 1:2d}/{len(folds)}  {fold.sizes()}  "
              f"검증IC {vic:+.4f}  시험IC {m_ic:+.4f}  ({time.time() - t0:.1f}초)")

    print(f"[학습] 전체 {time.time() - t_start:.1f}초")
    test_lo = folds[0].test[0]
    test_hi = folds[-1].test[1]
    return {"scores": scores, "folds": fold_logs, "test_range": (test_lo, test_hi),
            "device": device, "n_features": F}
